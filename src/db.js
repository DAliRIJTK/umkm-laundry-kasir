import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { hashPin } from './auth.js';
import { addHoursJakartaIso, nowJakartaIso, todayJakartaDate } from './domain.js';

const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    unit TEXT NOT NULL CHECK (unit IN ('KG', 'PCS')),
    price_idr INTEGER NOT NULL CHECK (price_idr > 0),
    duration_hours INTEGER NOT NULL CHECK (duration_hours >= 1),
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_code TEXT NOT NULL UNIQUE,
    customer_name TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('DITERIMA', 'DICUCI', 'DISETRIKA', 'SIAP_AMBIL', 'DIAMBIL', 'DIBATALKAN')),
    rack_code TEXT NOT NULL DEFAULT '',
    internal_note TEXT NOT NULL DEFAULT '',
    total_idr INTEGER NOT NULL CHECK (total_idr > 0),
    due_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT
);

CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    service_id INTEGER NOT NULL REFERENCES services(id),
    service_name_snapshot TEXT NOT NULL,
    unit_snapshot TEXT NOT NULL CHECK (unit_snapshot IN ('KG', 'PCS')),
    qty_tenths INTEGER NOT NULL CHECK (qty_tenths > 0),
    unit_price_idr INTEGER NOT NULL CHECK (unit_price_idr > 0),
    subtotal_idr INTEGER NOT NULL CHECK (subtotal_idr > 0)
);

CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    amount_idr INTEGER NOT NULL CHECK (amount_idr > 0),
    method TEXT NOT NULL CHECK (method IN ('TUNAI', 'QRIS', 'TRANSFER')),
    kind TEXT NOT NULL CHECK (kind IN ('DP', 'PELUNASAN')),
    paid_at TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_payments_paid_at ON payments(paid_at);
`;

const DEFAULT_SERVICES = [
  ['Cuci Kering Lipat', 'KG', 6000, 48],
  ['Cuci Komplit Setrika', 'KG', 8000, 48],
  ['Ekspres 1 Hari (Komplit)', 'KG', 12000, 24],
  ['Setrika Saja', 'KG', 5500, 24],
  ['Cuci Bedcover / Selimut', 'PCS', 25000, 72],
  ['Cuci Sepatu Kanvas', 'PCS', 30000, 72],
];

export function openDatabase({ dbPath, pin, seedDemo = true } = {}) {
  const resolvedPath = dbPath || path.resolve(process.cwd(), 'data', 'laundry.db');
  if (resolvedPath !== ':memory:') {
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  }

  const db = new DatabaseSync(resolvedPath);
  db.exec(SCHEMA_SQL);

  const now = nowJakartaIso();
  const upsertSetting = db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO NOTHING`
  );

  const initialPin = pin || process.env.LAUNDRY_PIN || '123456';
  const { salt, hash } = hashPin(initialPin);
  const sessionSecret = process.env.LAUNDRY_SESSION_SECRET || crypto.randomBytes(32).toString('hex');

  upsertSetting.run('store_name', 'Laundry Bening Harian', now);
  upsertSetting.run('store_address', 'Jl. Sukajadi, Bandung', now);
  upsertSetting.run('store_hours', 'Setiap hari 07:00–21:00 WIB', now);
  upsertSetting.run('store_phone', '0812-0000-0100', now);
  upsertSetting.run('pin_salt', salt, now);
  upsertSetting.run('pin_hash', hash, now);
  upsertSetting.run('session_secret', sessionSecret, now);

  const svcCount = db.prepare('SELECT COUNT(*) AS c FROM services').get().c;
  if (svcCount === 0) {
    const insSvc = db.prepare(
      `INSERT INTO services (name, unit, price_idr, duration_hours, is_active, created_at)
       VALUES (?, ?, ?, ?, 1, ?)`
    );
    for (const [name, unit, price, hours] of DEFAULT_SERVICES) {
      insSvc.run(name, unit, price, hours, now);
    }
  }

  if (seedDemo) {
    const ordCount = db.prepare('SELECT COUNT(*) AS c FROM orders').get().c;
    if (ordCount === 0) {
      seedDemoOrders(db);
    }
  }

  return db;
}

function seedDemoOrders(db) {
  const services = db.prepare('SELECT id, name, unit, price_idr FROM services').all();
  const byName = Object.fromEntries(services.map((s) => [s.name, s]));
  const today = todayJakartaDate();
  const now = nowJakartaIso();
  const yesterday = addHoursJakartaIso(now, -28);
  const twoDaysAgo = addHoursJakartaIso(now, -52);

  const demoRows = [
    {
      code: `LND-${today.replaceAll('-', '')}-001`,
      name: 'Ibu Ratna Dewi',
      phone: '081200001122',
      status: 'DITERIMA',
      rack: '',
      note: 'Pisahkan baju putih',
      createdAt: addHoursJakartaIso(now, -2),
      dueAt: addHoursJakartaIso(now, 46),
      completedAt: null,
      items: [[byName['Cuci Komplit Setrika'], 32, 25600]],
      payments: [[10000, 'QRIS', 'DP', addHoursJakartaIso(now, -2), 'DP saat titip']],
    },
    {
      code: `LND-${today.replaceAll('-', '')}-002`,
      name: 'Bapak Hendra',
      phone: '081300008821',
      status: 'SIAP_AMBIL',
      rack: 'A-03',
      note: 'Jangan pakai pewangi menyengat',
      createdAt: addHoursJakartaIso(now, -20),
      dueAt: addHoursJakartaIso(now, 28),
      completedAt: null,
      items: [[byName['Cuci Komplit Setrika'], 35, 28000]],
      payments: [[10000, 'QRIS', 'DP', addHoursJakartaIso(now, -20), 'DP awal']],
    },
    {
      code: `LND-${today.replaceAll('-', '')}-003`,
      name: 'Kos Melati #4',
      phone: '085700004411',
      status: 'DICUCI',
      rack: '',
      note: 'Prioritas ekspres',
      createdAt: twoDaysAgo,
      dueAt: addHoursJakartaIso(now, -4), // intentionally overdue demo
      completedAt: null,
      items: [[byName['Ekspres 1 Hari (Komplit)'], 40, 48000]],
      payments: [[48000, 'TRANSFER', 'PELUNASAN', twoDaysAgo, 'Transfer BCA']],
    },
    {
      code: `LND-${today.replaceAll('-', '')}-004`,
      name: 'Mba Nadia',
      phone: '081900003344',
      status: 'DISETRIKA',
      rack: '',
      note: '',
      createdAt: yesterday,
      dueAt: addHoursJakartaIso(now, 20),
      completedAt: null,
      items: [[byName['Cuci Bedcover / Selimut'], 20, 50000]],
      payments: [[50000, 'TUNAI', 'PELUNASAN', yesterday, 'Lunas di kasir']],
    },
    {
      code: `LND-${today.replaceAll('-', '')}-005`,
      name: 'Mas Dimas',
      phone: '082100007766',
      status: 'DIAMBIL',
      rack: 'B-01',
      note: '',
      createdAt: yesterday,
      dueAt: addHoursJakartaIso(now, 12),
      completedAt: now,
      items: [[byName['Cuci Kering Lipat'], 45, 27000]],
      payments: [[27000, 'TUNAI', 'PELUNASAN', now, 'Bayar saat ambil']],
    },
  ];

  const insOrder = db.prepare(
    `INSERT INTO orders (order_code, customer_name, customer_phone, status, rack_code, internal_note, total_idr, due_at, created_at, updated_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insItem = db.prepare(
    `INSERT INTO order_items (order_id, service_id, service_name_snapshot, unit_snapshot, qty_tenths, unit_price_idr, subtotal_idr)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const insPay = db.prepare(
    `INSERT INTO payments (order_id, amount_idr, method, kind, paid_at, note)
     VALUES (?, ?, ?, ?, ?, ?)`
  );

  db.exec('BEGIN IMMEDIATE');
  try {
    for (const d of demoRows) {
      const total = d.items.reduce((acc, [, , sub]) => acc + sub, 0);
      const res = insOrder.run(
        d.code,
        d.name,
        d.phone,
        d.status,
        d.rack,
        d.note,
        total,
        d.dueAt,
        d.createdAt,
        now,
        d.completedAt
      );
      const orderId = Number(res.lastInsertRowid);
      for (const [svc, qtyTenths, sub] of d.items) {
        insItem.run(orderId, svc.id, svc.name, svc.unit, qtyTenths, svc.price_idr, sub);
      }
      for (const [amt, method, kind, paidAt, pNote] of d.payments) {
        insPay.run(orderId, amt, method, kind, paidAt, pNote);
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
