// Pure Vanilla ESM Public Nota Tracker (no raw innerHTML with untrusted data)

const STATUS_META = {
  DITERIMA: { label: 'Diterima', badgeClass: 'badge-diterima' },
  DICUCI: { label: 'Dicuci', badgeClass: 'badge-dicuci' },
  DISETRIKA: { label: 'Disetrika', badgeClass: 'badge-disetrika' },
  SIAP_AMBIL: { label: 'Siap Diambil', badgeClass: 'badge-siap' },
  DIAMBIL: { label: 'Sudah Diambil', badgeClass: 'badge-diambil' },
  DIBATALKAN: { label: 'Dibatalkan', badgeClass: 'badge-error' },
};

const TIMELINE_STEPS = [
  { key: 'DITERIMA', label: 'Diterima', desc: 'Cucian telah dicatat di meja kasir.' },
  { key: 'DICUCI', label: 'Dicuci', desc: 'Sedang dalam proses pencucian.' },
  { key: 'DISETRIKA', label: 'Disetrika', desc: 'Sedang disetrika dan dirapikan.' },
  { key: 'SIAP_AMBIL', label: 'Siap Diambil', desc: 'Cucian selesai dan siap diambil di toko.' },
  { key: 'DIAMBIL', label: 'Sudah Diambil', desc: 'Cucian sudah diserahkan kepada pelanggan.' },
];

const PAYMENT_STATUS_META = {
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

function formatRupiah(amount) {
  return `Rp ${idrFmt.format(Number(amount || 0))}`;
}

function formatDateTimeWib(iso) {
  if (!iso) return '-';
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  return `${dtFmt.format(new Date(ms))} WIB`;
}

function formatQty(qty, unit) {
  const num = Number(qty || 0);
  const str = Number.isInteger(num) ? String(num) : num.toFixed(1);
  return `${str} ${unit}`;
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'className') {
      node.className = v;
    } else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v);
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

const dom = {
  storeName: document.getElementById('track-store-name'),
  form: document.getElementById('track-form'),
  codeInput: document.getElementById('track-code'),
  phone4Input: document.getElementById('track-phone4'),
  submitBtn: document.getElementById('track-submit-btn'),
  errorBox: document.getElementById('track-error'),
  resultPanel: document.getElementById('track-result'),
};

function showError(message) {
  if (!message) {
    dom.errorBox.textContent = '';
    dom.errorBox.classList.add('hidden');
    return;
  }
  dom.errorBox.textContent = message;
  dom.errorBox.classList.remove('hidden');
}

function renderOrderResult(order) {
  if (order.store?.name) {
    dom.storeName.textContent = order.store.name;
    document.title = `Lacak ${order.orderCode} — ${order.store.name}`;
  }

  const statusMeta = STATUS_META[order.status] || { label: order.status, badgeClass: 'badge-diambil' };
  const payMeta = PAYMENT_STATUS_META[order.paymentStatus] || { label: order.paymentStatus, badgeClass: 'badge-warn' };

  const headerSection = el(
    'div',
    { className: 'inspector-section' },
    el(
      'div',
      { className: 'order-row-top' },
      el('span', { className: 'order-row-code' }, order.orderCode),
      el(
        'div',
        { className: 'order-row-badges' },
        el('span', { className: `badge ${statusMeta.badgeClass}` }, statusMeta.label),
        el('span', { className: `badge ${payMeta.badgeClass}` }, payMeta.label)
      )
    ),
    el(
      'div',
      { className: 'meta-grid' },
      el(
        'div',
        { className: 'meta-item' },
        el('span', { className: 'meta-label' }, 'Nama Pelanggan'),
        el('span', { className: 'meta-val' }, order.customerName)
      ),
      el(
        'div',
        { className: 'meta-item' },
        el('span', { className: 'meta-label' }, 'No. HP'),
        el('span', { className: 'meta-val mono' }, order.maskedPhone)
      ),
      el(
        'div',
        { className: 'meta-item' },
        el('span', { className: 'meta-label' }, 'Masuk Nota'),
        el('span', { className: 'meta-val tabular' }, formatDateTimeWib(order.createdAt))
      ),
      el(
        'div',
        { className: 'meta-item' },
        el('span', { className: 'meta-label' }, 'Estimasi Selesai'),
        el('span', { className: 'meta-val tabular' }, formatDateTimeWib(order.dueAt))
      )
    )
  );

  const alerts = [];
  if (order.status === 'SIAP_AMBIL') {
    const rackText = order.rackCode
      ? `Cucian Anda siap diambil. Lokasi rak: ${order.rackCode}.`
      : 'Cucian Anda sudah selesai dan siap diambil di kasir.';
    alerts.push(el('div', { className: 'banner banner-success' }, rackText));
  }
  if (order.isOverdue) {
    alerts.push(
      el(
        'div',
        { className: 'banner banner-error' },
        'Cucian melewati estimasi waktu selesai. Silakan hubungi toko untuk informasi terbaru.'
      )
    );
  }

  let timelineBlock;
  if (order.status === 'DIBATALKAN') {
    timelineBlock = el(
      'div',
      { className: 'inspector-section' },
      el('h2', { className: 'section-title' }, 'Status Cucian'),
      el(
        'div',
        { className: 'banner banner-error' },
        `Order ini dibatalkan pada ${formatDateTimeWib(order.completedAt || order.updatedAt)}.`
      )
    );
  } else {
    const currentIdx = TIMELINE_STEPS.findIndex((s) => s.key === order.status);
    const stepsEl = el(
      'ol',
      { className: 'timeline' },
      ...TIMELINE_STEPS.map((step, idx) => {
        const isDone = idx < currentIdx || (idx === currentIdx && order.status === 'DIAMBIL');
        const isCurrent = idx === currentIdx && order.status !== 'DIAMBIL';
        const stateClass = isDone ? 'done' : isCurrent ? 'current' : '';
        return el(
          'li',
          { className: `timeline-step ${stateClass}` },
          el(
            'div',
            { className: 'timeline-marker-col' },
            el('span', { className: 'timeline-dot', 'aria-hidden': 'true' }, isDone ? '✓' : String(idx + 1)),
            el('span', { className: 'timeline-line', 'aria-hidden': 'true' })
          ),
          el(
            'div',
            { className: 'timeline-content' },
            el('span', { className: 'timeline-label' }, step.label),
            el('span', { className: 'timeline-desc' }, step.desc)
          )
        );
      })
    );
    timelineBlock = el(
      'div',
      { className: 'inspector-section' },
      el('h2', { className: 'section-title' }, 'Progres Cucian'),
      stepsEl
    );
  }

  const itemsSection = el(
    'div',
    { className: 'inspector-section' },
    el('h2', { className: 'section-title' }, 'Rincian Layanan'),
    el(
      'div',
      { className: 'table-wrap' },
      el(
        'table',
        { className: 'data-table' },
        el(
          'thead',
          {},
          el('tr', {}, el('th', {}, 'Layanan'), el('th', { className: 'num' }, 'Qty'), el('th', { className: 'num' }, 'Subtotal'))
        ),
        el(
          'tbody',
          {},
          ...order.items.map((it) =>
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
    )
  );

  const paymentBox = el(
    'div',
    { className: 'inspector-section' },
    el('h2', { className: 'section-title' }, 'Ringkasan Pembayaran'),
    el(
      'div',
      { className: 'summary-rows' },
      el('div', { className: 'summary-line' }, el('span', {}, 'Total Tagihan'), el('strong', {}, formatRupiah(order.totalIdr))),
      el('div', { className: 'summary-line' }, el('span', {}, 'Sudah Dibayar'), el('span', {}, formatRupiah(order.paidIdr))),
      el('div', { className: 'summary-line strong' }, el('span', {}, 'Sisa Bayar'), el('span', {}, formatRupiah(order.remainingIdr)))
    )
  );

  const store = order.store || {};
  const footerLines = [
    el('strong', {}, store.name || 'Laundry Bening Harian'),
    store.address ? el('span', {}, store.address) : null,
    store.hours ? el('span', {}, `Jam buka: ${store.hours}`) : null,
    store.phone ? el('span', {}, `Telepon / WA: ${store.phone}`) : null,
    el('div', { style: 'margin-top: 6px;' }, el('a', { href: '/' }, 'Login Kasir')),
  ].filter(Boolean);

  const storeFooter = el('footer', { className: 'store-footer' }, ...footerLines);

  const body = el(
    'div',
    { className: 'panel-body' },
    headerSection,
    ...alerts,
    timelineBlock,
    itemsSection,
    paymentBox,
    storeFooter
  );

  dom.resultPanel.replaceChildren(body);
  dom.resultPanel.classList.remove('hidden');
}

dom.form.addEventListener('submit', async (e) => {
  e.preventDefault();
  showError('');

  const code = dom.codeInput.value.trim().toUpperCase();
  const phone4 = dom.phone4Input.value.trim();

  if (!code || !/^\d{4}$/.test(phone4)) {
    showError('Masukkan kode nota dan tepat 4 digit terakhir nomor HP.');
    dom.resultPanel.classList.add('hidden');
    return;
  }

  dom.submitBtn.disabled = true;
  try {
    const url = `/api/public/track?code=${encodeURIComponent(code)}&phone4=${encodeURIComponent(phone4)}`;
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Gagal melacak nota (${res.status}).`);
    }
    renderOrderResult(data.order);
  } catch (err) {
    dom.resultPanel.classList.add('hidden');
    showError(err.message);
  } finally {
    dom.submitBtn.disabled = false;
  }
});

async function init() {
  const params = new URLSearchParams(window.location.search);
  const codeParam = params.get('code');
  if (codeParam) {
    dom.codeInput.value = codeParam.trim().toUpperCase();
    dom.phone4Input.focus();
  }

  try {
    const res = await fetch('/api/health');
    if (res.ok) {
      const meta = await res.json();
      if (meta.storeName) {
        dom.storeName.textContent = meta.storeName;
        document.title = `Lacak Cucian — ${meta.storeName}`;
      }
    }
  } catch {
    // Keep default store header if health check fails
  }
}

init();
