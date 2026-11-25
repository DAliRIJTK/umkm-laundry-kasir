export const ORDER_STATUSES = [
  'DITERIMA',
  'DICUCI',
  'DISETRIKA',
  'SIAP_AMBIL',
  'DIAMBIL',
  'DIBATALKAN',
];

export const PAYMENT_METHODS = ['TUNAI', 'QRIS', 'TRANSFER'];
export const SERVICE_UNITS = ['KG', 'PCS'];

export const ALLOWED_TRANSITIONS = {
  DITERIMA: new Set(['DICUCI', 'DISETRIKA', 'DIBATALKAN']),
  DICUCI: new Set(['DISETRIKA', 'SIAP_AMBIL', 'DIBATALKAN']),
  DISETRIKA: new Set(['SIAP_AMBIL', 'DIBATALKAN']),
  SIAP_AMBIL: new Set(['DIAMBIL', 'DIBATALKAN']),
  DIAMBIL: new Set(),
  DIBATALKAN: new Set(),
};

export class DomainError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'DomainError';
    this.statusCode = statusCode;
  }
}

export function nowJakartaIso(date = new Date()) {
  const shifted = new Date(date.getTime() + 7 * 3600 * 1000);
  return shifted.toISOString().slice(0, 19) + '+07:00';
}

export function addHoursJakartaIso(baseIso, hours) {
  const ms = Date.parse(baseIso);
  if (Number.isNaN(ms)) {
    throw new DomainError('Format tanggal tidak valid.');
  }
  return nowJakartaIso(new Date(ms + hours * 3600 * 1000));
}

export function todayJakartaDate(date = new Date()) {
  return nowJakartaIso(date).slice(0, 10);
}

export function normalizePhone(raw) {
  const digits = String(raw ?? '').replace(/[^0-9]/g, '');
  let normalized = digits;
  if (normalized.startsWith('62')) {
    normalized = '0' + normalized.slice(2);
  }
  if (!/^0\d{8,14}$/.test(normalized)) {
    throw new DomainError('Nomor HP tidak valid. Gunakan format 08xx (9–15 digit).');
  }
  return normalized;
}

export function maskPhone(phone) {
  const clean = String(phone ?? '');
  if (clean.length <= 4) return clean;
  return '•'.repeat(clean.length - 4) + clean.slice(-4);
}

export function parseQtyToTenths(rawQty, unit) {
  if (!SERVICE_UNITS.includes(unit)) {
    throw new DomainError('Satuan layanan harus KG atau PCS.');
  }
  const str = String(rawQty ?? '').trim().replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(str)) {
    throw new DomainError('Jumlah atau berat harus berupa angka.');
  }
  const num = Number(str);
  if (!Number.isFinite(num) || num <= 0) {
    throw new DomainError('Jumlah atau berat harus lebih dari 0.');
  }
  const scaled = num * 10;
  const tenths = Math.round(scaled);
  if (Math.abs(scaled - tenths) > 1e-6) {
    throw new DomainError('Berat maksimal 1 angka di belakang koma (contoh: 2.5).');
  }
  if (unit === 'PCS' && tenths % 10 !== 0) {
    throw new DomainError('Kuantitas untuk satuan PCS harus bilangan bulat.');
  }
  if (tenths > 10_000) {
    throw new DomainError('Kuantitas per item maksimal 1000.');
  }
  return tenths;
}

export function computeLineSubtotalIdr(qtyTenths, unitPriceIdr) {
  if (!Number.isInteger(qtyTenths) || qtyTenths <= 0) {
    throw new DomainError('Kuantitas item tidak valid.');
  }
  if (!Number.isInteger(unitPriceIdr) || unitPriceIdr <= 0) {
    throw new DomainError('Harga satuan layanan tidak valid.');
  }
  const subtotal = Math.round((qtyTenths * unitPriceIdr) / 10);
  if (subtotal <= 0) {
    throw new DomainError('Subtotal item harus lebih dari Rp 0.');
  }
  return subtotal;
}

export function canTransitionStatus(currentStatus, nextStatus) {
  const allowed = ALLOWED_TRANSITIONS[currentStatus];
  return Boolean(allowed && allowed.has(nextStatus));
}

export function isTerminalStatus(status) {
  return status === 'DIAMBIL' || status === 'DIBATALKAN';
}

export function derivePaymentStatus(paidIdr, totalIdr) {
  if (paidIdr <= 0) return 'BELUM_BAYAR';
  if (paidIdr < totalIdr) return 'DP';
  return 'LUNAS';
}

export function formatOrderCode(jakartaDate, seq, suffix = '') {
  const compactDate = String(jakartaDate).replaceAll('-', '');
  const padded = String(seq).padStart(3, '0');
  return suffix ? `LND-${compactDate}-${padded}-${suffix}` : `LND-${compactDate}-${padded}`;
}

export function parsePositiveIntIdr(value, fieldLabel = 'Nominal') {
  if (
    value === null ||
    value === undefined ||
    typeof value === 'boolean' ||
    typeof value === 'object' ||
    String(value).trim() === ''
  ) {
    throw new DomainError(`${fieldLabel} harus bilangan bulat Rupiah lebih dari 0.`);
  }
  const num = Number(value);
  if (!Number.isInteger(num) || num <= 0) {
    throw new DomainError(`${fieldLabel} harus bilangan bulat Rupiah lebih dari 0.`);
  }
  if (num > 100_000_000) {
    throw new DomainError(`${fieldLabel} melebihi batas wajar transaksi.`);
  }
  return num;
}
