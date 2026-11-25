import crypto from 'node:crypto';

export const SESSION_COOKIE_NAME = 'laundry_sid';
const DEFAULT_TTL_MS = 12 * 3600 * 1000;

export function hashPin(pin, saltHex = crypto.randomBytes(16).toString('hex')) {
  const normalized = String(pin ?? '');
  if (!/^\d{4,8}$/.test(normalized)) {
    throw new Error('PIN harus terdiri dari 4 sampai 8 digit angka.');
  }
  const hash = crypto.scryptSync(normalized, saltHex, 32).toString('hex');
  return { salt: saltHex, hash };
}

export function verifyPin(pin, saltHex, expectedHashHex) {
  const normalized = String(pin ?? '');
  if (!/^\d{4,8}$/.test(normalized) || !saltHex || !expectedHashHex) {
    return false;
  }
  const actualBuf = crypto.scryptSync(normalized, saltHex, 32);
  const expectedBuf = Buffer.from(expectedHashHex, 'hex');
  if (actualBuf.length !== expectedBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(actualBuf, expectedBuf);
}

export function signSessionToken(payload, secret, nowMs = Date.now(), ttlMs = DEFAULT_TTL_MS) {
  const data = {
    ...payload,
    iat: nowMs,
    exp: nowMs + ttlMs,
  };
  const body = Buffer.from(JSON.stringify(data), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifySessionToken(token, secret, nowMs = Date.now()) {
  if (!token || typeof token !== 'string' || !secret) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  if (!body || !sig) return null;

  const expectedSig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  const sigBuf = Buffer.from(sig, 'utf8');
  const expBuf = Buffer.from(expectedSig, 'utf8');
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const decoded = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!decoded || typeof decoded.exp !== 'number' || decoded.exp <= nowMs) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

export function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    try {
      out[key] = decodeURIComponent(val);
    } catch {
      out[key] = val;
    }
  }
  return out;
}

export function createLoginRateLimiter({ maxAttempts = 5, windowMs = 10 * 60 * 1000 } = {}) {
  const attempts = new Map();

  function prune(key, nowMs) {
    const list = attempts.get(key);
    if (!list) return [];
    const fresh = list.filter((ts) => nowMs - ts < windowMs);
    if (fresh.length === 0) {
      attempts.delete(key);
    } else {
      attempts.set(key, fresh);
    }
    return fresh;
  }

  return {
    isBlocked(key, nowMs = Date.now()) {
      return prune(key, nowMs).length >= maxAttempts;
    },
    recordFailure(key, nowMs = Date.now()) {
      if (attempts.size >= 1000 && !attempts.has(key)) {
        for (const k of attempts.keys()) prune(k, nowMs);
        if (attempts.size >= 1000) {
          for (const [k, list] of attempts.entries()) {
            if (list.length < maxAttempts) {
              attempts.delete(k);
              if (attempts.size < 1000) break;
            }
          }
        }
        while (attempts.size >= 1000) {
          attempts.delete(attempts.keys().next().value);
        }
      }
      const fresh = prune(key, nowMs);
      fresh.push(nowMs);
      attempts.set(key, fresh);
    },
    recordSuccess(key) {
      attempts.delete(key);
    },
  };
}
