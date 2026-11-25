import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.js';

function startTestServer({ seedDemo = false } = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'laundry-edge-'));
  const dbPath = path.join(tmpDir, 'edge.db');
  const app = createApp({ dbPath, pin: '123456', seedDemo });
  return new Promise((resolve) => {
    const server = app.server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${addr.port}`,
        close: () =>
          new Promise((done) => {
            server.close(() => {
              app.close();
              fs.rmSync(tmpDir, { recursive: true, force: true });
              done();
            });
          }),
      });
    });
  });
}

async function loginCookie(baseUrl, pin = '123456') {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin }),
  });
  const setCookie = res.headers.get('set-cookie');
  return { res, cookie: setCookie ? setCookie.split(';')[0] : '' };
}

test('malformed and non-object JSON payloads return 400 instead of 500', async () => {
  const srv = await startTestServer();
  try {
    const nullLogin = await fetch(`${srv.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'null',
    });
    assert.equal(nullLogin.status, 400);

    const arrayLogin = await fetch(`${srv.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '[]',
    });
    assert.equal(arrayLogin.status, 400);

    const badJson = await fetch(`${srv.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{broken',
    });
    assert.equal(badJson.status, 400);
  } finally {
    await srv.close();
  }
});

test('rejects dirty UMKM order inputs: comma decimal handled, negative/zero/inactive/bad phone/bad DP rejected', async () => {
  const srv = await startTestServer();
  try {
    const { cookie } = await loginCookie(srv.baseUrl);
    const svcRes = await fetch(`${srv.baseUrl}/api/services`, { headers: { Cookie: cookie } });
    const { services } = await svcRes.json();
    const kgSvc = services.find((s) => s.unit === 'KG');
    const pcsSvc = services.find((s) => s.unit === 'PCS');

    // Disable PCS service
    const disableRes = await fetch(`${srv.baseUrl}/api/services/${pcsSvc.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ isActive: false }),
    });
    assert.equal(disableRes.status, 200);

    // Reject inactive service
    const inactiveOrder = await fetch(`${srv.baseUrl}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        customerName: 'Pak Budi',
        customerPhone: '08123456789',
        items: [{ serviceId: pcsSvc.id, qty: 1 }],
      }),
    });
    assert.equal(inactiveOrder.status, 400);

    // Reject fractional PCS (after re-enabling)
    await fetch(`${srv.baseUrl}/api/services/${pcsSvc.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ isActive: true }),
    });
    const fracPcs = await fetch(`${srv.baseUrl}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        customerName: 'Pak Budi',
        customerPhone: '08123456789',
        items: [{ serviceId: pcsSvc.id, qty: 1.5 }],
      }),
    });
    assert.equal(fracPcs.status, 400);

    // Reject zero/negative qty, invalid phone, negative DP, DP >= total
    for (const badBody of [
      { customerName: 'Pak Budi', customerPhone: '08123456789', items: [{ serviceId: kgSvc.id, qty: 0 }] },
      { customerName: 'Pak Budi', customerPhone: '08123456789', items: [{ serviceId: kgSvc.id, qty: -1 }] },
      { customerName: 'Pak Budi', customerPhone: '12345', items: [{ serviceId: kgSvc.id, qty: 2 }] },
      {
        customerName: 'Pak Budi',
        customerPhone: '08123456789',
        items: [{ serviceId: kgSvc.id, qty: 2 }],
        initialPayment: { kind: 'DP', method: 'TUNAI', amountIdr: -500 },
      },
      {
        customerName: 'Pak Budi',
        customerPhone: '08123456789',
        items: [{ serviceId: kgSvc.id, qty: 2 }],
        initialPayment: { kind: 'DP', method: 'TUNAI', amountIdr: kgSvc.priceIdr * 2 },
      },
      {
        customerName: 'Pak Budi',
        customerPhone: '08123456789',
        items: [{ serviceId: kgSvc.id, qty: 2 }],
        initialPayment: 'LUNAS',
      },
    ]) {
      const res = await fetch(`${srv.baseUrl}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify(badBody),
      });
      assert.equal(res.status, 400);
    }

    // Accepts Indonesian comma decimal "2,5", +62 phone normalization, and null rackCode as empty string
    const okRes = await fetch(`${srv.baseUrl}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        customerName: 'Bu Dewi',
        customerPhone: '+62 812-3333-4444',
        rackCode: null,
        items: [{ serviceId: kgSvc.id, qty: '2,5' }],
      }),
    });
    assert.equal(okRes.status, 201);
    const { order } = await okRes.json();
    assert.equal(order.customerPhone, '081233334444');
    assert.equal(order.rackCode, '');
    assert.equal(order.totalIdr, Math.round((25 * kgSvc.priceIdr) / 10));

    // Updating status with rackCode: null keeps rackCode as empty string, never literal "null"
    const rackNullRes = await fetch(`${srv.baseUrl}/api/orders/${order.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ status: 'DICUCI', rackCode: null }),
    });
    assert.equal(rackNullRes.status, 200);
    const rackNullData = await rackNullRes.json();
    assert.equal(rackNullData.order.rackCode, '');
  } finally {
    await srv.close();
  }
});

test('terminal order (DIBATALKAN/DIAMBIL) rejects payment, status jumps, and rack mutations', async () => {
  const srv = await startTestServer();
  try {
    const { cookie } = await loginCookie(srv.baseUrl);
    const svcRes = await fetch(`${srv.baseUrl}/api/services`, { headers: { Cookie: cookie } });
    const { services } = await svcRes.json();
    const kgSvc = services[0];

    const createRes = await fetch(`${srv.baseUrl}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        customerName: 'Pak Tono',
        customerPhone: '081300009999',
        items: [{ serviceId: kgSvc.id, qty: 3 }],
        initialPayment: { kind: 'DP', method: 'TUNAI', amountIdr: 5000 },
      }),
    });
    const { order } = await createRes.json();

    // Cancel order
    const cancelRes = await fetch(`${srv.baseUrl}/api/orders/${order.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ status: 'DIBATALKAN' }),
    });
    assert.equal(cancelRes.status, 200);

    // Cancelled order cannot receive payment
    const payCancelled = await fetch(`${srv.baseUrl}/api/orders/${order.id}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ amountIdr: 5000, method: 'TUNAI' }),
    });
    assert.equal(payCancelled.status, 409);

    // Cancelled order cannot mutate rackCode even with same status
    const rackCancelled = await fetch(`${srv.baseUrl}/api/orders/${order.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ status: 'DIBATALKAN', rackCode: 'Z-99' }),
    });
    assert.equal(rackCancelled.status, 409);

    // Cancelled order payments excluded from daily cash summary
    const today = order.createdAt.slice(0, 10);
    const sumRes = await fetch(`${srv.baseUrl}/api/summary?date=${today}`, {
      headers: { Cookie: cookie },
    });
    const summary = await sumRes.json();
    assert.equal(summary.cashTotalIdr, 0);
    assert.equal(summary.newOrdersCount, 0);
  } finally {
    await srv.close();
  }
});

test('demo seed includes overdue order filter, unpaid filter, and static routes enforce security headers & block path traversal', async () => {
  const srv = await startTestServer({ seedDemo: true });
  try {
    const { cookie } = await loginCookie(srv.baseUrl);

    const overdueRes = await fetch(`${srv.baseUrl}/api/orders?overdue=1`, {
      headers: { Cookie: cookie },
    });
    assert.equal(overdueRes.status, 200);
    const overdueData = await overdueRes.json();
    assert.ok(overdueData.orders.length >= 1);
    assert.ok(overdueData.orders.every((o) => o.isOverdue));

    const unpaidRes = await fetch(`${srv.baseUrl}/api/orders?unpaid=1`, {
      headers: { Cookie: cookie },
    });
    const unpaidData = await unpaidRes.json();
    assert.ok(unpaidData.orders.length >= 2);
    assert.ok(unpaidData.orders.every((o) => o.remainingIdr > 0));

    const allRes = await fetch(`${srv.baseUrl}/api/orders`, { headers: { Cookie: cookie } });
    const allData = await allRes.json();
    assert.equal(allData.orders.length, 6);
    assert.ok(allData.orders.some((o) => o.status === 'DIBATALKAN'));

    // Static routes & strict security headers (no unsafe-inline in CSP)
    for (const staticPath of ['/', '/track', '/styles.css', '/shared.js', '/kasir.js', '/track.js', '/assets/logo.svg']) {
      const res = await fetch(`${srv.baseUrl}${staticPath}`);
      assert.equal(res.status, 200, `Expected 200 for ${staticPath}`);
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(res.headers.get('x-frame-options'), 'DENY');
      assert.ok(!res.headers.get('content-security-policy')?.includes('unsafe-inline'));
    }

    // Path traversal blocked
    const travRes = await fetch(`${srv.baseUrl}/../package.json`);
    assert.ok(travRes.status === 403 || travRes.status === 404);
  } finally {
    await srv.close();
  }
});

test('login endpoint enforces 429 rate limit after 5 wrong PIN attempts', async () => {
  const srv = await startTestServer();
  try {
    for (let i = 0; i < 5; i++) {
      const res = await fetch(`${srv.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: '999999' }),
      });
      assert.equal(res.status, 401);
    }
    const blocked = await fetch(`${srv.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: '123456' }),
    });
    assert.equal(blocked.status, 429);
  } finally {
    await srv.close();
  }
});
