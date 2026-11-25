import {
  DomainError,
  ORDER_STATUSES,
  PAYMENT_METHODS,
  SERVICE_UNITS,
  addHoursJakartaIso,
  canTransitionStatus,
  computeLineSubtotalIdr,
  derivePaymentStatus,
  formatOrderCode,
  maskPhone,
  normalizePhone,
  nowJakartaIso,
  parsePositiveIntIdr,
  parseQtyToTenths,
  todayJakartaDate,
} from './domain.js';

export function createStore(db) {
  function getSettingsMap() {
    const rows = db.prepare('SELECT key, value FROM settings').all();
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  function getStoreMeta() {
    const m = getSettingsMap();
    return {
      storeName: m.store_name || 'Laundry Bening Harian',
      storeAddress: m.store_address || 'Jl. Sukajadi, Bandung',
      storeHours: m.store_hours || '07:00–21:00 WIB',
      storePhone: m.store_phone || '',
    };
  }

  function getAuthCredentials() {
    const m = getSettingsMap();
    return {
      pinSalt: m.pin_salt,
      pinHash: m.pin_hash,
      sessionSecret: m.session_secret,
    };
  }

  function mapServiceRow(row) {
    return {
      id: Number(row.id),
      name: row.name,
      unit: row.unit,
      priceIdr: Number(row.price_idr),
      durationHours: Number(row.duration_hours),
      isActive: Boolean(row.is_active),
    };
  }

  function listServices({ activeOnly = false } = {}) {
    const sql = activeOnly
      ? 'SELECT * FROM services WHERE is_active = 1 ORDER BY id ASC'
      : 'SELECT * FROM services ORDER BY id ASC';
    return db.prepare(sql).all().map(mapServiceRow);
  }

  function createService({ name, unit, priceIdr, durationHours }) {
    const cleanName = String(name ?? '').trim();
    if (cleanName.length < 2 || cleanName.length > 80) {
      throw new DomainError('Nama layanan wajib 2–80 karakter.');
    }
    if (!SERVICE_UNITS.includes(unit)) {
      throw new DomainError('Satuan layanan harus KG atau PCS.');
    }
    const price = parsePositiveIntIdr(priceIdr, 'Harga layanan');
    const hours = Number(durationHours);
    if (!Number.isInteger(hours) || hours < 1 || hours > 720) {
      throw new DomainError('Estimasi selesai harus 1–720 jam.');
    }

    const now = nowJakartaIso();
    try {
      const res = db
        .prepare(
          `INSERT INTO services (name, unit, price_idr, duration_hours, is_active, created_at)
           VALUES (?, ?, ?, ?, 1, ?)`
        )
        .run(cleanName, unit, price, hours, now);
      const created = db.prepare('SELECT * FROM services WHERE id = ?').get(res.lastInsertRowid);
      return mapServiceRow(created);
    } catch (err) {
      if (String(err.message).includes('UNIQUE')) {
        throw new DomainError('Nama layanan sudah terdaftar.', 409);
      }
      throw err;
    }
  }

  function updateService(id, patch = {}) {
    const existing = db.prepare('SELECT * FROM services WHERE id = ?').get(id);
    if (!existing) throw new DomainError('Layanan tidak ditemukan.', 404);

    const nextName =
      patch.name !== undefined ? String(patch.name).trim() : existing.name;
    if (nextName.length < 2 || nextName.length > 80) {
      throw new DomainError('Nama layanan wajib 2–80 karakter.');
    }
    const nextPrice =
      patch.priceIdr !== undefined
        ? parsePositiveIntIdr(patch.priceIdr, 'Harga layanan')
        : Number(existing.price_idr);
    const nextHours =
      patch.durationHours !== undefined ? Number(patch.durationHours) : Number(existing.duration_hours);
    if (!Number.isInteger(nextHours) || nextHours < 1 || nextHours > 720) {
      throw new DomainError('Estimasi selesai harus 1–720 jam.');
    }
    const nextActive =
      patch.isActive !== undefined ? (patch.isActive ? 1 : 0) : Number(existing.is_active);

    try {
      db.prepare(
        `UPDATE services SET name = ?, price_idr = ?, duration_hours = ?, is_active = ? WHERE id = ?`
      ).run(nextName, nextPrice, nextHours, nextActive, id);
      const updated = db.prepare('SELECT * FROM services WHERE id = ?').get(id);
      return mapServiceRow(updated);
    } catch (err) {
      if (String(err.message).includes('UNIQUE')) {
        throw new DomainError('Nama layanan sudah digunakan.', 409);
      }
      throw err;
    }
  }

  function hydrateOrder(row, nowIso = nowJakartaIso()) {
    const items = db
      .prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id ASC')
      .all(row.id)
      .map((it) => ({
        id: Number(it.id),
        serviceId: Number(it.service_id),
        serviceName: it.service_name_snapshot,
        unit: it.unit_snapshot,
        qtyTenths: Number(it.qty_tenths),
        qty: Number(it.qty_tenths) / 10,
        unitPriceIdr: Number(it.unit_price_idr),
        subtotalIdr: Number(it.subtotal_idr),
      }));

    const payments = db
      .prepare('SELECT * FROM payments WHERE order_id = ? ORDER BY id ASC')
      .all(row.id)
      .map((p) => ({
        id: Number(p.id),
        amountIdr: Number(p.amount_idr),
        method: p.method,
        kind: p.kind,
        paidAt: p.paid_at,
        note: p.note,
      }));

    const totalIdr = Number(row.total_idr);
    const paidIdr = payments.reduce((sum, p) => sum + p.amountIdr, 0);
    const remainingIdr = Math.max(0, totalIdr - paidIdr);
    const isTerminal = row.status === 'DIAMBIL' || row.status === 'DIBATALKAN';
    const isOverdue = !isTerminal && Date.parse(row.due_at) < Date.parse(nowIso);

    return {
      id: Number(row.id),
      orderCode: row.order_code,
      customerName: row.customer_name,
      customerPhone: row.customer_phone,
      maskedPhone: maskPhone(row.customer_phone),
      status: row.status,
      rackCode: row.rack_code,
      internalNote: row.internal_note,
      totalIdr,
      paidIdr,
      remainingIdr,
      paymentStatus: derivePaymentStatus(paidIdr, totalIdr),
      isOverdue,
      dueAt: row.due_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at,
      items,
      payments,
    };
  }

  function getOrderById(id) {
    const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
    if (!row) throw new DomainError('Order tidak ditemukan.', 404);
    return hydrateOrder(row);
  }

  function listOrders({ status = '', search = '', overdue = false, unpaid = false } = {}) {
    const rows = db.prepare('SELECT * FROM orders ORDER BY id DESC').all();
    const nowIso = nowJakartaIso();
    const q = String(search ?? '').trim().toLowerCase();

    return rows
      .map((r) => hydrateOrder(r, nowIso))
      .filter((o) => {
        if (status && ORDER_STATUSES.includes(status) && o.status !== status) return false;
        if (overdue && !o.isOverdue) return false;
        if (unpaid && (o.remainingIdr <= 0 || o.status === 'DIBATALKAN')) return false;
        if (q) {
          const hit =
            o.orderCode.toLowerCase().includes(q) ||
            o.customerName.toLowerCase().includes(q) ||
            o.customerPhone.includes(q);
          if (!hit) return false;
        }
        return true;
      });
  }

  function createOrder(input = {}) {
    const customerName = String(input.customerName ?? '').trim();
    if (customerName.length < 2 || customerName.length > 80) {
      throw new DomainError('Nama pelanggan wajib 2–80 karakter.');
    }
    const customerPhone = normalizePhone(input.customerPhone);
    const rackCode = String(input.rackCode ?? '').trim().slice(0, 20);
    const internalNote = String(input.internalNote ?? '').trim().slice(0, 300);

    if (!Array.isArray(input.items) || input.items.length === 0) {
      throw new DomainError('Minimal 1 item layanan wajib dipilih.');
    }
    if (input.items.length > 20) {
      throw new DomainError('Maksimal 20 baris item per nota.');
    }

    const resolvedItems = [];
    let maxHours = 1;
    let totalIdr = 0;

    for (const rawItem of input.items) {
      const svcId = Number(rawItem?.serviceId);
      const svc = db.prepare('SELECT * FROM services WHERE id = ?').get(svcId);
      if (!svc) {
        throw new DomainError('Layanan yang dipilih tidak ditemukan.');
      }
      if (!svc.is_active) {
        throw new DomainError(`Layanan "${svc.name}" sedang nonaktif.`);
      }
      const qtyTenths = parseQtyToTenths(rawItem.qty, svc.unit);
      const unitPriceIdr = Number(svc.price_idr);
      const subtotalIdr = computeLineSubtotalIdr(qtyTenths, unitPriceIdr);
      totalIdr += subtotalIdr;
      maxHours = Math.max(maxHours, Number(svc.duration_hours));
      resolvedItems.push({
        serviceId: Number(svc.id),
        serviceName: svc.name,
        unit: svc.unit,
        qtyTenths,
        unitPriceIdr,
        subtotalIdr,
      });
    }

    if (
      input.initialPayment !== undefined &&
      (typeof input.initialPayment !== 'object' ||
        input.initialPayment === null ||
        Array.isArray(input.initialPayment))
    ) {
      throw new DomainError('Format pembayaran awal tidak valid.');
    }
    const initPay = input.initialPayment || { kind: 'NONE' };
    const payKind = String(initPay.kind ?? 'NONE').toUpperCase();
    let paymentToInsert = null;

    if (payKind !== 'NONE') {
      const method = String(initPay.method ?? 'TUNAI').toUpperCase();
      if (!PAYMENT_METHODS.includes(method)) {
        throw new DomainError('Metode pembayaran harus TUNAI, QRIS, atau TRANSFER.');
      }
      if (payKind === 'LUNAS') {
        paymentToInsert = { amountIdr: totalIdr, method, kind: 'PELUNASAN', note: 'Lunas saat order' };
      } else if (payKind === 'DP') {
        const dpAmt = parsePositiveIntIdr(initPay.amountIdr, 'Nominal DP');
        if (dpAmt >= totalIdr) {
          throw new DomainError('Nominal DP harus lebih kecil dari total tagihan (gunakan Lunas jika penuh).');
        }
        paymentToInsert = { amountIdr: dpAmt, method, kind: 'DP', note: 'DP saat order' };
      } else {
        throw new DomainError('Jenis pembayaran awal harus NONE, DP, atau LUNAS.');
      }
    }

    const nowIso = nowJakartaIso();
    const today = todayJakartaDate();
    const dueAt = addHoursJakartaIso(nowIso, maxHours);

    db.exec('BEGIN IMMEDIATE');
    try {
      const prefix = `LND-${today.replaceAll('-', '')}-`;
      const seqRow = db
        .prepare('SELECT COALESCE(MAX(CAST(substr(order_code, 14) AS INTEGER)), 0) AS max_seq FROM orders WHERE order_code LIKE ?')
        .get(`${prefix}%`);
      const nextSeq = Number(seqRow.max_seq) + 1;
      const orderCode = formatOrderCode(today, nextSeq);

      const res = db
        .prepare(
          `INSERT INTO orders (order_code, customer_name, customer_phone, status, rack_code, internal_note, total_idr, due_at, created_at, updated_at, completed_at)
           VALUES (?, ?, ?, 'DITERIMA', ?, ?, ?, ?, ?, ?, NULL)`
        )
        .run(
          orderCode,
          customerName,
          customerPhone,
          rackCode,
          internalNote,
          totalIdr,
          dueAt,
          nowIso,
          nowIso
        );
      const orderId = Number(res.lastInsertRowid);

      const insItem = db.prepare(
        `INSERT INTO order_items (order_id, service_id, service_name_snapshot, unit_snapshot, qty_tenths, unit_price_idr, subtotal_idr)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      for (const it of resolvedItems) {
        insItem.run(orderId, it.serviceId, it.serviceName, it.unit, it.qtyTenths, it.unitPriceIdr, it.subtotalIdr);
      }

      if (paymentToInsert) {
        db.prepare(
          `INSERT INTO payments (order_id, amount_idr, method, kind, paid_at, note)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).run(orderId, paymentToInsert.amountIdr, paymentToInsert.method, paymentToInsert.kind, nowIso, paymentToInsert.note);
      }

      db.exec('COMMIT');
      return getOrderById(orderId);
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  function advanceOrderStatus(id, { status, rackCode } = {}) {
    const nextStatus = String(status ?? '').trim();
    if (!ORDER_STATUSES.includes(nextStatus)) {
      throw new DomainError('Status order tidak dikenal.');
    }

    db.exec('BEGIN IMMEDIATE');
    try {
      const order = getOrderById(id);
      if (order.status === 'DIAMBIL' || order.status === 'DIBATALKAN') {
        throw new DomainError(`Order berstatus ${order.status} tidak dapat diubah lagi.`, 409);
      }
      const nextRack = rackCode !== undefined ? String(rackCode).trim().slice(0, 20) : order.rackCode;

      if (nextStatus === order.status) {
        if (rackCode !== undefined && nextRack !== order.rackCode) {
          db.prepare('UPDATE orders SET rack_code = ?, updated_at = ? WHERE id = ?').run(
            nextRack,
            nowJakartaIso(),
            id
          );
        }
        db.exec('COMMIT');
        return getOrderById(id);
      }

      if (!canTransitionStatus(order.status, nextStatus)) {
        throw new DomainError(
          `Transisi status tidak valid dari ${order.status} ke ${nextStatus}.`,
          409
        );
      }

      if (nextStatus === 'DIAMBIL' && order.remainingIdr > 0) {
        throw new DomainError(
          `Order masih memiliki sisa tagihan Rp ${order.remainingIdr.toLocaleString('id-ID')}. Lunasi terlebih dahulu sebelum diserahkan.`,
          409
        );
      }

      const nowIso = nowJakartaIso();
      const completedAt =
        nextStatus === 'DIAMBIL' || nextStatus === 'DIBATALKAN' ? nowIso : null;

      db.prepare(
        `UPDATE orders SET status = ?, rack_code = ?, updated_at = ?, completed_at = COALESCE(?, completed_at) WHERE id = ?`
      ).run(nextStatus, nextRack, nowIso, completedAt, id);

      db.exec('COMMIT');
      return getOrderById(id);
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  function recordPayment(id, { amountIdr, method, note = '' } = {}) {
    const cleanMethod = String(method ?? '').toUpperCase();
    if (!PAYMENT_METHODS.includes(cleanMethod)) {
      throw new DomainError('Metode pembayaran harus TUNAI, QRIS, atau TRANSFER.');
    }
    const amt = parsePositiveIntIdr(amountIdr, 'Nominal pembayaran');
    const cleanNote = String(note ?? '').trim().slice(0, 120);

    db.exec('BEGIN IMMEDIATE');
    try {
      const order = getOrderById(id);
      if (order.status === 'DIBATALKAN') {
        throw new DomainError('Order yang sudah dibatalkan tidak dapat menerima pembayaran.', 409);
      }
      if (order.remainingIdr <= 0) {
        throw new DomainError('Order ini sudah lunas.', 409);
      }
      if (amt > order.remainingIdr) {
        throw new DomainError(
          `Nominal pembayaran (Rp ${amt}) melebihi sisa tagihan (Rp ${order.remainingIdr}).`,
          400
        );
      }

      const kind = amt === order.remainingIdr ? 'PELUNASAN' : 'DP';
      const nowIso = nowJakartaIso();
      db.prepare(
        `INSERT INTO payments (order_id, amount_idr, method, kind, paid_at, note)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(id, amt, cleanMethod, kind, nowIso, cleanNote);

      db.prepare('UPDATE orders SET updated_at = ? WHERE id = ?').run(nowIso, id);
      db.exec('COMMIT');
      return getOrderById(id);
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  function getCashSummary(date = todayJakartaDate()) {
    const cleanDate = String(date ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) {
      throw new DomainError('Format tanggal harus YYYY-MM-DD.');
    }

    const orders = listOrders();
    let activeCount = 0;
    let readyCount = 0;
    let overdueCount = 0;
    let unpaidCount = 0;
    let unpaidTotalIdr = 0;
    let newOrdersCount = 0;

    for (const o of orders) {
      if (o.createdAt.startsWith(cleanDate) && o.status !== 'DIBATALKAN') {
        newOrdersCount++;
      }
      if (o.status !== 'DIAMBIL' && o.status !== 'DIBATALKAN') {
        activeCount++;
        if (o.status === 'SIAP_AMBIL') readyCount++;
        if (o.isOverdue) overdueCount++;
        if (o.remainingIdr > 0) {
          unpaidCount++;
          unpaidTotalIdr += o.remainingIdr;
        }
      }
    }

    const payRows = db
      .prepare(
        `SELECT p.method, COALESCE(SUM(p.amount_idr), 0) AS total
         FROM payments p
         JOIN orders o ON o.id = p.order_id
         WHERE substr(p.paid_at, 1, 10) = ? AND o.status != 'DIBATALKAN'
         GROUP BY p.method`
      )
      .all(cleanDate);

    const cashByMethod = { TUNAI: 0, QRIS: 0, TRANSFER: 0 };
    for (const r of payRows) {
      if (r.method in cashByMethod) {
        cashByMethod[r.method] = Number(r.total);
      }
    }
    const cashTotalIdr = cashByMethod.TUNAI + cashByMethod.QRIS + cashByMethod.TRANSFER;

    return {
      date: cleanDate,
      activeCount,
      readyCount,
      overdueCount,
      unpaidCount,
      unpaidTotalIdr,
      cashTotalIdr,
      cashByMethod,
      newOrdersCount,
    };
  }

  function lookupPublicOrder(code, phone4) {
    const cleanCode = String(code ?? '').trim().toUpperCase();
    const cleanPhone4 = String(phone4 ?? '').trim();
    if (!cleanCode || !/^\d{4}$/.test(cleanPhone4)) {
      throw new DomainError('Masukkan kode nota dan tepat 4 digit terakhir nomor HP.', 400);
    }

    const row = db.prepare('SELECT * FROM orders WHERE UPPER(order_code) = ?').get(cleanCode);
    if (!row || row.customer_phone.slice(-4) !== cleanPhone4) {
      throw new DomainError('Nota tidak ditemukan atau 4 digit terakhir HP tidak cocok.', 404);
    }

    const full = hydrateOrder(row);
    const meta = getStoreMeta();
    return {
      orderCode: full.orderCode,
      customerName: full.customerName,
      maskedPhone: full.maskedPhone,
      status: full.status,
      rackCode: full.rackCode,
      totalIdr: full.totalIdr,
      paidIdr: full.paidIdr,
      remainingIdr: full.remainingIdr,
      paymentStatus: full.paymentStatus,
      isOverdue: full.isOverdue,
      dueAt: full.dueAt,
      createdAt: full.createdAt,
      updatedAt: full.updatedAt,
      completedAt: full.completedAt,
      items: full.items,
      store: {
        name: meta.storeName,
        address: meta.storeAddress,
        hours: meta.storeHours,
        phone: meta.storePhone,
      },
    };
  }

  return {
    getStoreMeta,
    getAuthCredentials,
    listServices,
    createService,
    updateService,
    listOrders,
    getOrderById,
    createOrder,
    advanceOrderStatus,
    recordPayment,
    getCashSummary,
    lookupPublicOrder,
  };
}
