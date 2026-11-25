import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.js';

function startTestServer() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'laundry-test-'));
  const dbPath = path.join(tmpDir, 'test.db');
  const app = createApp({ dbPath, pin: '246810', seedDemo: false });
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

async function loginCookie(baseUrl, pin = '246810') {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin }),
  });
  const setCookie = res.headers.get('set-cookie');
  return { res, cookie: setCookie ? setCookie.split(';')[0] : '' };
}

test('staff endpoints require valid PIN session cookie', async () => {
  const srv = await startTestServer();
  try {
    const unauth = await fetch(`${srv.baseUrl}/api/orders`);
    assert.equal(unauth.status, 401);

    const bad = await fetch(`${srv.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: '000000' }),
    });
    assert.equal(bad.status, 401);

    const { res, cookie } = await loginCookie(srv.baseUrl);
    assert.equal(res.status, 200);
    assert.ok(cookie.startsWith('laundry_sid='));

    const authOrders = await fetch(`${srv.baseUrl}/api/orders`, {
      headers: { Cookie: cookie },
    });
    assert.equal(authOrders.status, 200);
  } finally {
    await srv.close();
  }
});

test('full laundry order lifecycle, payment gate before DIAMBIL, cash summary, and private public tracking', async () => {
  const srv = await startTestServer();
  try {
    const { cookie } = await loginCookie(srv.baseUrl);
    const svcRes = await fetch(`${srv.baseUrl}/api/services`, { headers: { Cookie: cookie } });
    const { services } = await svcRes.json();
    assert.ok(services.length >= 4);
    const komplit = services.find((s) => s.unit === 'KG');

    // Create order with 2.5 kg and partial DP
    const createRes = await fetch(`${srv.baseUrl}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        customerName: 'Ibu Sari',
        customerPhone: '081234567890',
        internalNote: 'Rak dekat pintu, sensitif pewangi',
        items: [{ serviceId: komplit.id, qty: 2.5 }],
        initialPayment: { kind: 'DP', method: 'QRIS', amountIdr: 10000 },
      }),
    });
    assert.equal(createRes.status, 201);
    const { order } = await createRes.json();
    assert.equal(order.totalIdr, Math.round((25 * komplit.priceIdr) / 10));
    assert.equal(order.paidIdr, 10000);
    assert.equal(order.remainingIdr, order.totalIdr - 10000);
    assert.equal(order.paymentStatus, 'DP');

    // Advance status to SIAP_AMBIL with rack code
    for (const nextStatus of ['DICUCI', 'DISETRIKA', 'SIAP_AMBIL']) {
      const stRes = await fetch(`${srv.baseUrl}/api/orders/${order.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          status: nextStatus,
          rackCode: nextStatus === 'SIAP_AMBIL' ? 'B-02' : undefined,
        }),
      });
      assert.equal(stRes.status, 200);
    }

    // Must block DIAMBIL while remainingIdr > 0
    const blockedPickup = await fetch(`${srv.baseUrl}/api/orders/${order.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ status: 'DIAMBIL' }),
    });
    assert.equal(blockedPickup.status, 409);

    // Public tracking checks phone4 and hides internalNote & full phone
    const badTrack = await fetch(
      `${srv.baseUrl}/api/public/track?code=${encodeURIComponent(order.orderCode)}&phone4=0000`
    );
    assert.equal(badTrack.status, 404);

    const okTrack = await fetch(
      `${srv.baseUrl}/api/public/track?code=${encodeURIComponent(order.orderCode)}&phone4=7890`
    );
    assert.equal(okTrack.status, 200);
    const tracked = await okTrack.json();
    assert.equal(tracked.order.rackCode, 'B-02');
    assert.equal(tracked.order.remainingIdr, order.totalIdr - 10000);
    assert.equal('internalNote' in tracked.order, false);
    assert.equal('customerPhone' in tracked.order, false);

    // Overpayment rejected
    const overPay = await fetch(`${srv.baseUrl}/api/orders/${order.id}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ amountIdr: order.totalIdr, method: 'TUNAI' }),
    });
    assert.equal(overPay.status, 400);

    // Record exact remaining payment then mark DIAMBIL
    const payRes = await fetch(`${srv.baseUrl}/api/orders/${order.id}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ amountIdr: order.remainingIdr, method: 'TUNAI' }),
    });
    assert.equal(payRes.status, 200);

    const pickupRes = await fetch(`${srv.baseUrl}/api/orders/${order.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ status: 'DIAMBIL' }),
    });
    assert.equal(pickupRes.status, 200);

    // Check daily cash summary splits QRIS and TUNAI accurately
    const today = order.createdAt.slice(0, 10);
    const sumRes = await fetch(`${srv.baseUrl}/api/summary?date=${today}`, {
      headers: { Cookie: cookie },
    });
    assert.equal(sumRes.status, 200);
    const summary = await sumRes.json();
    assert.equal(summary.cashByMethod.QRIS, 10000);
    assert.equal(summary.cashByMethod.TUNAI, order.remainingIdr);
    assert.equal(summary.cashTotalIdr, order.totalIdr);
  } finally {
    await srv.close();
  }
});
