import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SESSION_COOKIE_NAME,
  createLoginRateLimiter,
  parseCookies,
  signSessionToken,
  verifyPin,
  verifySessionToken,
} from './auth.js';
import { openDatabase } from './db.js';
import { DomainError } from './domain.js';
import { createStore } from './store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy':
    "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; script-src 'self'; connect-src 'self'",
};

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    ...SECURITY_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(body);
}

function readJsonBody(req, maxBytes = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new DomainError('Ukuran payload terlalu besar.', 413));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          reject(new DomainError('Payload JSON harus berupa objek.', 400));
          return;
        }
        resolve(parsed);
      } catch {
        reject(new DomainError('Format JSON tidak valid.', 400));
      }
    });
    req.on('error', () => reject(new DomainError('Gagal membaca request.', 400)));
  });
}

function serveStaticFile(res, urlPath) {
  const mapped =
    urlPath === '/' ? 'index.html' : urlPath === '/track' ? 'track.html' : urlPath.replace(/^\/+/, '');
  const fullPath = path.resolve(PUBLIC_DIR, mapped);
  if (!fullPath.startsWith(PUBLIC_DIR + path.sep) && fullPath !== PUBLIC_DIR) {
    sendJson(res, 403, { error: 'Akses ditolak.' });
    return;
  }
  if (!fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
    sendJson(res, 404, { error: 'Halaman tidak ditemukan.' });
    return;
  }
  const ext = path.extname(fullPath).toLowerCase();
  const mime = MIME_TYPES[ext] || 'application/octet-stream';
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'Content-Type': mime,
  });
  fs.createReadStream(fullPath).pipe(res);
}

export function createApp({ dbPath, pin, seedDemo = true } = {}) {
  const db = openDatabase({ dbPath, pin, seedDemo });
  const store = createStore(db);
  const limiter = createLoginRateLimiter({ maxAttempts: 5, windowMs: 10 * 60 * 1000 });

  function getClientIp(req) {
    return req.socket?.remoteAddress || 'unknown';
  }

  function isAuthenticated(req) {
    const cookies = parseCookies(req.headers.cookie);
    const { sessionSecret } = store.getAuthCredentials();
    return Boolean(verifySessionToken(cookies[SESSION_COOKIE_NAME], sessionSecret));
  }

  function requireAuth(req, res) {
    if (!isAuthenticated(req)) {
      sendJson(res, 401, { error: 'Sesi kasir diperlukan. Silakan masukkan PIN toko.' });
      return false;
    }
    return true;
  }

  const server = http.createServer(async (req, res) => {
    try {
      const parsed = new URL(req.url || '/', 'http://127.0.0.1');
      const pathname = parsed.pathname;
      const method = req.method || 'GET';

      if (!pathname.startsWith('/api/')) {
        if (method !== 'GET' && method !== 'HEAD') {
          sendJson(res, 405, { error: 'Method tidak diizinkan.' });
          return;
        }
        serveStaticFile(res, pathname);
        return;
      }

      if (method === 'GET' && pathname === '/api/health') {
        sendJson(res, 200, { ok: true, ...store.getStoreMeta() });
        return;
      }

      if (method === 'GET' && pathname === '/api/auth/session') {
        sendJson(res, 200, { authenticated: isAuthenticated(req), ...store.getStoreMeta() });
        return;
      }

      if (method === 'POST' && pathname === '/api/auth/login') {
        const ip = getClientIp(req);
        if (limiter.isBlocked(ip)) {
          sendJson(res, 429, {
            error: 'Terlalu banyak percobaan PIN salah. Tunggu 10 menit lalu coba lagi.',
          });
          return;
        }
        const body = await readJsonBody(req);
        const { pinSalt, pinHash, sessionSecret } = store.getAuthCredentials();
        if (!verifyPin(body.pin, pinSalt, pinHash)) {
          limiter.recordFailure(ip);
          sendJson(res, 401, { error: 'PIN toko salah.' });
          return;
        }
        limiter.recordSuccess(ip);
        const token = signSessionToken({ role: 'kasir' }, sessionSecret);
        sendJson(
          res,
          200,
          { ok: true, ...store.getStoreMeta() },
          {
            'Set-Cookie': `${SESSION_COOKIE_NAME}=${encodeURIComponent(
              token
            )}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200`,
          }
        );
        return;
      }

      if (method === 'POST' && pathname === '/api/auth/logout') {
        sendJson(
          res,
          200,
          { ok: true },
          {
            'Set-Cookie': `${SESSION_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
          }
        );
        return;
      }

      if (method === 'GET' && pathname === '/api/public/track') {
        const code = parsed.searchParams.get('code') || '';
        const phone4 = parsed.searchParams.get('phone4') || '';
        const order = store.lookupPublicOrder(code, phone4);
        sendJson(res, 200, { order });
        return;
      }

      // Protected Staff Routes
      if (!requireAuth(req, res)) return;

      if (method === 'GET' && pathname === '/api/services') {
        const activeOnly = parsed.searchParams.get('activeOnly') === '1';
        sendJson(res, 200, { services: store.listServices({ activeOnly }) });
        return;
      }

      if (method === 'POST' && pathname === '/api/services') {
        const body = await readJsonBody(req);
        const service = store.createService(body);
        sendJson(res, 201, { service });
        return;
      }

      const svcMatch = pathname.match(/^\/api\/services\/(\d+)$/);
      if (method === 'PATCH' && svcMatch) {
        const body = await readJsonBody(req);
        const service = store.updateService(Number(svcMatch[1]), body);
        sendJson(res, 200, { service });
        return;
      }

      if (method === 'GET' && pathname === '/api/orders') {
        const orders = store.listOrders({
          status: parsed.searchParams.get('status') || '',
          search: parsed.searchParams.get('search') || '',
          overdue: parsed.searchParams.get('overdue') === '1',
          unpaid: parsed.searchParams.get('unpaid') === '1',
        });
        sendJson(res, 200, { orders });
        return;
      }

      if (method === 'POST' && pathname === '/api/orders') {
        const body = await readJsonBody(req);
        const order = store.createOrder(body);
        sendJson(res, 201, { order });
        return;
      }

      const ordMatch = pathname.match(/^\/api\/orders\/(\d+)$/);
      if (method === 'GET' && ordMatch) {
        const order = store.getOrderById(Number(ordMatch[1]));
        sendJson(res, 200, { order });
        return;
      }

      const statusMatch = pathname.match(/^\/api\/orders\/(\d+)\/status$/);
      if (method === 'PATCH' && statusMatch) {
        const body = await readJsonBody(req);
        const order = store.advanceOrderStatus(Number(statusMatch[1]), body);
        sendJson(res, 200, { order });
        return;
      }

      const payMatch = pathname.match(/^\/api\/orders\/(\d+)\/payments$/);
      if (method === 'POST' && payMatch) {
        const body = await readJsonBody(req);
        const order = store.recordPayment(Number(payMatch[1]), body);
        sendJson(res, 200, { order });
        return;
      }

      if (method === 'GET' && pathname === '/api/summary') {
        const date = parsed.searchParams.get('date') || undefined;
        sendJson(res, 200, store.getCashSummary(date));
        return;
      }

      sendJson(res, 404, { error: 'Endpoint API tidak ditemukan.' });
    } catch (err) {
      if (err instanceof DomainError) {
        sendJson(res, err.statusCode, { error: err.message });
        return;
      }
      console.error('Unhandled server error:', err);
      sendJson(res, 500, { error: 'Terjadi kesalahan internal server.' });
    }
  });

  return {
    server,
    db,
    store,
    close() {
      db.close();
    },
  };
}

const isEntrypoint = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntrypoint) {
  const port = Number(process.env.PORT || 3080);
  const host = process.env.HOST || '127.0.0.1';
  const app = createApp();
  app.server.listen(port, host, () => {
    console.log(`UMKM Laundry Kasir berjalan di http://${host}:${port}`);
  });
}
