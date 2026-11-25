// Shared formatting, DOM helpers, and UI components (zero innerHTML, zero inline style)

export const STATUS_META = {
  DITERIMA: { label: 'Diterima', badgeClass: 'badge-diterima' },
  DICUCI: { label: 'Dicuci', badgeClass: 'badge-dicuci' },
  DISETRIKA: { label: 'Disetrika', badgeClass: 'badge-disetrika' },
  SIAP_AMBIL: { label: 'Siap Ambil', badgeClass: 'badge-siap' },
  DIAMBIL: { label: 'Diambil', badgeClass: 'badge-diambil' },
  DIBATALKAN: { label: 'Dibatalkan', badgeClass: 'badge-error' },
};

export const PAYMENT_STATUS_META = {
  BELUM_BAYAR: { label: 'Belum Bayar', badgeClass: 'badge-warn' },
  DP: { label: 'DP', badgeClass: 'badge-warn' },
  LUNAS: { label: 'Lunas', badgeClass: 'badge-lunas' },
};

const idrFmt = new Intl.NumberFormat('id-ID');
const dtFmt = new Intl.DateTimeFormat('id-ID', {
  timeZone: 'Asia/Jakarta',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatRupiah(amount) {
  return `Rp ${idrFmt.format(Number(amount || 0))}`;
}

export function formatDateTimeWib(iso) {
  if (!iso) return '-';
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  return `${dtFmt.format(new Date(ms))} WIB`;
}

export function formatQty(qty, unit) {
  const num = Number(qty || 0);
  const str = Number.isInteger(num) ? String(num) : num.toFixed(1);
  return `${str} ${unit}`;
}

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false || k === 'style') continue;
    if (k === 'className') {
      node.className = v;
    } else if (k === 'dataset') {
      for (const [dk, dv] of Object.entries(v)) {
        node.dataset[dk] = dv;
      }
    } else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k === 'disabled' || k === 'required' || k === 'checked' || k === 'selected') {
      node[k] = Boolean(v);
    } else {
      node.setAttribute(k, String(v));
    }
  }
  for (const child of children) {
    if (child === undefined || child === null || child === false) continue;
    if (typeof child === 'string' || typeof child === 'number') {
      node.appendChild(document.createTextNode(String(child)));
    } else {
      node.appendChild(child);
    }
  }
  return node;
}

export function showBanner(node, message) {
  if (!node) return;
  if (!message) {
    node.textContent = '';
    node.classList.add('hidden');
    return;
  }
  node.textContent = message;
  node.classList.remove('hidden');
}

export function makeStatusBadge(status) {
  const meta = STATUS_META[status] || { label: status, badgeClass: 'badge-diambil' };
  return el('span', { className: `badge ${meta.badgeClass}` }, meta.label);
}

export function makePaymentBadge(paymentStatus) {
  const meta = PAYMENT_STATUS_META[paymentStatus] || { label: paymentStatus, badgeClass: 'badge-warn' };
  return el('span', { className: `badge ${meta.badgeClass}` }, meta.label);
}

export function renderItemsTableEl(items) {
  const list = Array.isArray(items) ? items : [];
  return el(
    'div',
    { className: 'table-wrap' },
    el(
      'table',
      { className: 'data-table' },
      el(
        'thead',
        {},
        el(
          'tr',
          {},
          el('th', {}, 'Layanan'),
          el('th', { className: 'num' }, 'Qty'),
          el('th', { className: 'num' }, 'Subtotal')
        )
      ),
      el(
        'tbody',
        {},
        ...list.map((it) =>
          el(
            'tr',
            {},
            el('td', {}, it.serviceName),
            el('td', { className: 'num' }, formatQty(it.qty, it.unit)),
            el('td', { className: 'num' }, formatRupiah(it.subtotalIdr))
          )
        )
      )
    )
  );
}

export function renderPaymentSummaryEl(order) {
  return el(
    'div',
    { className: 'summary-rows' },
    el('div', { className: 'summary-line' }, el('span', {}, 'Total Tagihan'), el('strong', {}, formatRupiah(order.totalIdr))),
    el('div', { className: 'summary-line' }, el('span', {}, 'Sudah Dibayar'), el('span', {}, formatRupiah(order.paidIdr))),
    el('div', { className: 'summary-line strong' }, el('span', {}, 'Sisa Bayar'), el('span', {}, formatRupiah(order.remainingIdr)))
  );
}
