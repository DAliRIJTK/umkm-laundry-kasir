// Pure Vanilla ESM Public Nota Tracker (no raw innerHTML with untrusted data)
import {
  el,
  formatDateTimeWib,
  makePaymentBadge,
  makeStatusBadge,
  renderItemsTableEl,
  renderPaymentSummaryEl,
  showBanner,
} from '/shared.js';

const TIMELINE_STEPS = [
  { key: 'DITERIMA', label: 'Diterima', desc: 'Cucian telah dicatat di meja kasir.' },
  { key: 'DICUCI', label: 'Dicuci', desc: 'Sedang dalam proses pencucian.' },
  { key: 'DISETRIKA', label: 'Disetrika', desc: 'Sedang disetrika dan dirapikan.' },
  { key: 'SIAP_AMBIL', label: 'Siap Diambil', desc: 'Cucian selesai dan siap diambil di toko.' },
  { key: 'DIAMBIL', label: 'Sudah Diambil', desc: 'Cucian sudah diserahkan kepada pelanggan.' },
];

const dom = {
  storeName: document.getElementById('track-store-name'),
  form: document.getElementById('track-form'),
  codeInput: document.getElementById('track-code'),
  phone4Input: document.getElementById('track-phone4'),
  submitBtn: document.getElementById('track-submit-btn'),
  errorBox: document.getElementById('track-error'),
  resultPanel: document.getElementById('track-result'),
};

function renderOrderResult(order) {
  if (order.store?.name) {
    dom.storeName.textContent = order.store.name;
    document.title = `Lacak ${order.orderCode} — ${order.store.name}`;
  }

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
        makeStatusBadge(order.status),
        makePaymentBadge(order.paymentStatus)
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
    renderItemsTableEl(order.items)
  );

  const paymentBox = el(
    'div',
    { className: 'inspector-section' },
    el('h2', { className: 'section-title' }, 'Ringkasan Pembayaran'),
    renderPaymentSummaryEl(order)
  );

  const store = order.store || {};
  const footerLines = [
    el('strong', {}, store.name || 'Laundry Bening Harian'),
    store.address ? el('span', {}, store.address) : null,
    store.hours ? el('span', {}, `Jam buka: ${store.hours}`) : null,
    store.phone ? el('span', {}, `Telepon / WA: ${store.phone}`) : null,
    el('div', { className: 'footer-link-row' }, el('a', { href: '/' }, 'Login Kasir')),
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
  showBanner(dom.errorBox, '');

  const code = dom.codeInput.value.trim().toUpperCase();
  const phone4 = dom.phone4Input.value.trim();

  if (!code || !/^\d{4}$/.test(phone4)) {
    showBanner(dom.errorBox, 'Masukkan kode nota dan tepat 4 digit terakhir nomor HP.');
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
    showBanner(dom.errorBox, err.message);
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
