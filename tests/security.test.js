import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.js';
import { createLoginRateLimiter } from '../src/auth.js';

function startTestServer({ dbPath, pin, seedDemo = false } = {}) {
  const tmpDir = dbPath ? null : fs.mkdtempSync(path.join(os.tmpdir(), 'laundry-sec-'));
  const resolvedDb = dbPath || path.join(tmpDir, 'sec.db');
  const app = createApp({ dbPath: resolvedDb, pin, seedDemo });
  return new Promise((resolve) => {
    const server = app.server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${addr.port}`,
        dbPath: resolvedDb,
        close: () =>
          new Promise((done) => {
            server.close(() => {
              app.close();
              if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
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

test('SEC-01: public track endpoint rate-limits brute force and generated order codes carry random suffix', async () => {
  const srv = await startTestServer({ pin: '246810' });
  try {
    const { cookie } = await loginCookie(srv.baseUrl, '246810');
    const svcRes = await fetch(`${srv.baseUrl}/api/services`, { headers: { Cookie: cookie } });
    const { services } = await svcRes.json();

    const ordRes = await fetch(`${srv.baseUrl}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        customerName: 'Ibu Nina',
        customerPhone: '081200004321',
        items: [{ serviceId: services[0].id, qty: 2 }],
      }),
    });
    const { order } = await ordRes.json();
    assert.match(order.orderCode, /^LND-\d{8}-\d{3}-[0-9A-F]{4}$/);

    for (let i = 0; i < 15; i++) {
      const r = await fetch(
        `${srv.baseUrl}/api/public/track?code=${encodeURIComponent(order.orderCode)}&phone4=0000`
      );
      assert.equal(r.status, 404);
    }

    const blocked = await fetch(
      `${srv.baseUrl}/api/public/track?code=${encodeURIComponent(order.orderCode)}&phone4=4321`
    );
    assert.equal(blocked.status, 429);
  } finally {
    await srv.close();
  }
});

test('SEC-02: mutation endpoints enforce application/json Content-Type and reject cross-site Origin/Sec-Fetch-Site', async () => {
  const srv = await startTestServer({ pin: '246810' });
  try {
    const { cookie } = await loginCookie(srv.baseUrl, '246810');

    const badType = await fetch(`${srv.baseUrl}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain', Cookie: cookie },
      body: '{}',
    });
    assert.equal(badType.status, 415);

    const crossSite = await fetch(`${srv.baseUrl}/api/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Sec-Fetch-Site': 'cross-site',
        Cookie: cookie,
      },
      body: '{}',
    });
    assert.equal(crossSite.status, 403);

    const badOrigin = await fetch(`${srv.baseUrl}/api/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://evil.example:9999',
        Cookie: cookie,
      },
      body: '{}',
    });
    assert.equal(badOrigin.status, 403);
  } finally {
    await srv.close();
  }
});

test('SEC-03 & SEC-04: custom PIN overrides existing DB PIN, hides demo hint, and logout revokes captured cookies', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'laundry-pin-'));
  const dbPath = path.join(tmpDir, 'pin.db');
  const srv1 = await startTestServer({ dbPath });
  try {
    const sess1 = await (await fetch(`${srv1.baseUrl}/api/auth/session`)).json();
    assert.equal(sess1.isDemoPin, true);

    const { cookie } = await loginCookie(srv1.baseUrl, '123456');
    assert.ok(cookie);

    // Logout revokes cookie server-side
    const logoutRes = await fetch(`${srv1.baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: '{}',
    });
    assert.equal(logoutRes.status, 200);

    const replayAfterLogout = await fetch(`${srv1.baseUrl}/api/orders`, {
      headers: { Cookie: cookie },
    });
    assert.equal(replayAfterLogout.status, 401);
  } finally {
    await srv1.close();
  }

  // Reopen same DB with explicit PIN -> overrides old hash and disables isDemoPin
  const srv2 = await startTestServer({ dbPath, pin: '789012' });
  try {
    const sess2 = await (await fetch(`${srv2.baseUrl}/api/auth/session`)).json();
    assert.equal(sess2.isDemoPin, false);

    const oldPin = await fetch(`${srv2.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: '123456' }),
    });
    assert.equal(oldPin.status, 401);

    const newPin = await loginCookie(srv2.baseUrl, '789012');
    assert.equal(newPin.res.status, 200);
  } finally {
    await srv2.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('SEC-05: rate limiter evicts oldest key at cap instead of wiping active lockouts, and CSP sets frame-ancestors none', async () => {
  const limiter = createLoginRateLimiter({ maxAttempts: 5, windowMs: 60_000 });
  const now = 10_000;
  for (let i = 0; i < 5; i++) limiter.recordFailure('victim-ip', now);
  assert.equal(limiter.isBlocked('victim-ip', now + 100), true);

  for (let i = 0; i < 1050; i++) {
    limiter.recordFailure(`noise-${i}`, now + 200);
  }
  assert.equal(limiter.isBlocked('victim-ip', now + 300), true);
  assert.equal(limiter.isBlocked('noise-1049', now + 300), false);

  const srv = await startTestServer({ pin: '246810' });
  try {
    const res = await fetch(`${srv.baseUrl}/`);
    const csp = res.headers.get('content-security-policy') || '';
    assert.ok(csp.includes("frame-ancestors 'none'"));
    assert.ok(csp.includes("base-uri 'self'"));
    assert.ok(csp.includes("form-action 'self'"));
  } finally {
    await srv.close();
  }
});
