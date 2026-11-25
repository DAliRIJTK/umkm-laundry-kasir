import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePhone,
  maskPhone,
  parseQtyToTenths,
  computeLineSubtotalIdr,
  canTransitionStatus,
  derivePaymentStatus,
  formatOrderCode,
} from '../src/domain.js';

test('normalizePhone normalizes Indonesian prefixes and rejects invalid numbers', () => {
  assert.equal(normalizePhone('+62 812-3456-7890'), '081234567890');
  assert.equal(normalizePhone('6285712345678'), '085712345678');
  assert.equal(normalizePhone('0813 0000 8821'), '081300008821');
  assert.throws(() => normalizePhone('123'), /Nomor HP/);
  assert.throws(() => normalizePhone('abc-def'), /Nomor HP/);
});

test('maskPhone reveals only last 4 digits', () => {
  assert.equal(maskPhone('081300008821'), '••••••••8821');
  assert.equal(maskPhone('081234'), '••1234');
});

test('parseQtyToTenths handles decimal kg without float drift and rejects fractional pcs', () => {
  assert.equal(parseQtyToTenths(2.5, 'KG'), 25);
  assert.equal(parseQtyToTenths('3.2', 'KG'), 32);
  assert.equal(parseQtyToTenths(2, 'PCS'), 20);
  assert.throws(() => parseQtyToTenths(1.5, 'PCS'), /satuan PCS/i);
  assert.throws(() => parseQtyToTenths(0, 'KG'), /lebih dari 0/i);
  assert.throws(() => parseQtyToTenths(-2, 'KG'), /lebih dari 0/i);
  assert.throws(() => parseQtyToTenths(2.55, 'KG'), /1 angka di belakang koma/i);
});

test('computeLineSubtotalIdr computes exact integer Rupiah for decimal kg', () => {
  assert.equal(computeLineSubtotalIdr(25, 7000), 17500);
  assert.equal(computeLineSubtotalIdr(32, 8000), 25600);
  assert.equal(computeLineSubtotalIdr(10, 25000), 25000);
});

test('canTransitionStatus enforces allowed laundry workflow', () => {
  assert.equal(canTransitionStatus('DITERIMA', 'DICUCI'), true);
  assert.equal(canTransitionStatus('DITERIMA', 'DISETRIKA'), true);
  assert.equal(canTransitionStatus('DICUCI', 'SIAP_AMBIL'), true);
  assert.equal(canTransitionStatus('SIAP_AMBIL', 'DIAMBIL'), true);
  assert.equal(canTransitionStatus('SIAP_AMBIL', 'DIBATALKAN'), true);
  assert.equal(canTransitionStatus('DIAMBIL', 'DICUCI'), false);
  assert.equal(canTransitionStatus('DIBATALKAN', 'DITERIMA'), false);
  assert.equal(canTransitionStatus('DITERIMA', 'DIAMBIL'), false);
});

test('derivePaymentStatus computes BELUM_BAYAR, DP, and LUNAS', () => {
  assert.equal(derivePaymentStatus(0, 28000), 'BELUM_BAYAR');
  assert.equal(derivePaymentStatus(10000, 28000), 'DP');
  assert.equal(derivePaymentStatus(28000, 28000), 'LUNAS');
});

test('formatOrderCode builds deterministic daily code', () => {
  assert.equal(formatOrderCode('2026-11-25', 7), 'LND-20261125-007');
});
