import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hashPin,
  verifyPin,
  signSessionToken,
  verifySessionToken,
  createLoginRateLimiter,
} from '../src/auth.js';

test('hashPin and verifyPin use salted scrypt and constant-time verify', () => {
  const { salt, hash } = hashPin('123456');
  assert.ok(salt.length >= 16);
  assert.ok(hash.length >= 32);
  assert.equal(verifyPin('123456', salt, hash), true);
  assert.equal(verifyPin('654321', salt, hash), false);
  assert.equal(verifyPin('12345', salt, hash), false);
});

test('signSessionToken and verifySessionToken reject tampering and expiry', () => {
  const secret = 'test-secret-key-at-least-32-bytes-long!!';
  const now = 1_700_000_000_000;
  const token = signSessionToken({ role: 'kasir' }, secret, now, 60_000);
  const valid = verifySessionToken(token, secret, now + 10_000);
  assert.equal(valid?.role, 'kasir');

  const tampered = token.slice(0, -2) + (token.endsWith('aa') ? 'bb' : 'aa');
  assert.equal(verifySessionToken(tampered, secret, now + 10_000), null);
  assert.equal(verifySessionToken(token, secret, now + 120_000), null);
});

test('login rate limiter blocks after 5 failed attempts and resets on success', () => {
  const limiter = createLoginRateLimiter({ maxAttempts: 5, windowMs: 60_000 });
  let t = 1000;
  for (let i = 0; i < 5; i++) {
    assert.equal(limiter.isBlocked('127.0.0.1', t), false);
    limiter.recordFailure('127.0.0.1', t);
  }
  assert.equal(limiter.isBlocked('127.0.0.1', t + 1000), true);
  assert.equal(limiter.isBlocked('127.0.0.1', t + 65_000), false);

  limiter.recordFailure('10.0.0.1', t);
  limiter.recordSuccess('10.0.0.1');
  assert.equal(limiter.isBlocked('10.0.0.1', t), false);
});
