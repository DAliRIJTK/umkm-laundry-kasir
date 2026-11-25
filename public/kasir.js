// Pure Vanilla ESM Kasir UI (no raw innerHTML with untrusted data)

const STATUS_META = {
  DITERIMA: { label: 'Diterima', badgeClass: 'badge-diterima' },
  DICUCI: { label: 'Dicuci', badgeClass: 'badge-dicuci' },
  DISETRIKA: { label: 'Disetrika', badgeClass: 'badge-disetrika' },
  SIAP_AMBIL: { label: 'Siap Ambil', badgeClass: 'badge-siap' },
  DIAMBIL: { label: 'Diambil', badgeClass: 'badge-diambil' },
  DIBATALKAN: { label: 'Dibatalkan', badgeClass: 'badge-error' },
};

const VALID_TRANSITIONS = {
  DITERIMA: ['DICUCI', 'DISETRIKA'],
  DICUCI: ['DISETRIKA', 'SIAP_AMBIL'],
  DISETRIKA: ['SIAP_AMBIL'],
  SIAP_AMBIL: ['DIAMBIL'],
  DIAMBIL: [],
  DIBATALKAN: [],
};

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

function todayJakartaDate() {
  const shifted = new Date(Date.now() + 7 * 3600 * 1000);
  return shifted.toISOString().slice(0, 10);
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
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

function showBanner(node, message) {
  if (!message) {
    node.textContent = '';
    node.classList.add('hidden');
    return;
  }
  node.textContent = message;
  node.classList.remove('hidden');
}

function formatQty(qty, unit) {
  const num = Number(qty || 0);
  const str = Number.isInteger(num) ? String(num) : num.toFixed(1);
  return `${str} ${unit}`;
}

function summarizeItems(items) {
  if (!Array.isArray(items) || items.length === 0) return '-';
  const first = items[0];
  const base = `${first.serviceName} (${formatQty(first.qty, first.unit)})`;
  if (items.length === 1) return base;
  return `${base}, +${items.length - 1} lainnya`;
}

function makeStatusBadge(status) {
  const meta = STATUS_META[status] || { label: status, badgeClass: 'badge-diambil' };
  return el('span', { className: `badge ${meta.badgeClass}` }, meta.label);
}

function makePaymentBadge(paymentStatus) {
  const meta = PAYMENT_STATUS_META[paymentStatus] || { label: paymentStatus, badgeClass: 'badge-warn' };
  return el('span', { className: `badge ${meta.badgeClass}` }, meta.label);
}

// Application State
const state = {
  authenticated: false,
  storeMeta: {
    storeName: 'Laundry Bening Harian',
    storeAddress: '',
    storeHours: '',
    storePhone: '',
  },
  activeTab: 'orders',
  orders: [],
  selectedOrderId: null,
  selectedOrder: null,
  filter: 'ALL',
  search: '',
  isNewOrderOpen: false,
  confirmCancelId: null,
  activeServices: [],
  allServices: [],
  newOrderRows: [],
  searchTimer: null,
  toastTimer: null,
};

// DOM References
const dom = {
  loginView: document.getElementById('login-view'),
  appView: document.getElementById('app-view'),
  loginStoreName: document.getElementById('login-store-name'),
  topbarStoreName: document.getElementById('topbar-store-name'),
  loginForm: document.getElementById('login-form'),
  pinInput: document.getElementById('pin-input'),
  loginSubmitBtn: document.getElementById('login-submit-btn'),
  loginError: document.getElementById('login-error'),
  logoutBtn: document.getElementById('logout-btn'),
  newOrderBtn: document.getElementById('new-order-btn'),
  navTabs: Array.from(document.querySelectorAll('.nav-tab')),
  tabOrders: document.getElementById('tab-orders'),
  tabServices: document.getElementById('tab-services'),
  tabSummary: document.getElementById('tab-summary'),
  kpiActive: document.getElementById('kpi-active'),
  kpiReady: document.getElementById('kpi-ready'),
  kpiOverdue: document.getElementById('kpi-overdue'),
  kpiCash: document.getElementById('kpi-cash'),
  orderSearch: document.getElementById('order-search'),
  filterChips: Array.from(document.querySelectorAll('#filter-chips .chip')),
  ordersError: document.getElementById('orders-error'),
  orderList: document.getElementById('order-list'),
  inspectorPanel: document.getElementById('inspector-panel'),
  inspectorCodeChip: document.getElementById('inspector-code-chip'),
  inspectorEmpty: document.getElementById('inspector-empty'),
  inspectorContent: document.getElementById('inspector-content'),
  newOrderPanel: document.getElementById('new-order-panel'),
  cancelNewOrderBtn: document.getElementById('cancel-new-order-btn'),
  newOrderForm: document.getElementById('new-order-form'),
  newOrderError: document.getElementById('new-order-error'),
  newCustomerName: document.getElementById('new-customer-name'),
  newCustomerPhone: document.getElementById('new-customer-phone'),
  newRackCode: document.getElementById('new-rack-code'),
  newInternalNote: document.getElementById('new-internal-note'),
  addItemRowBtn: document.getElementById('add-item-row-btn'),
  newOrderItems: document.getElementById('new-order-items'),
  newOrderTotal: document.getElementById('new-order-total'),
  newPayKind: document.getElementById('new-pay-kind'),
  newPayMethodWrap: document.getElementById('new-pay-method-wrap'),
  newPayMethod: document.getElementById('new-pay-method'),
  newPayDpWrap: document.getElementById('new-pay-dp-wrap'),
  newPayAmount: document.getElementById('new-pay-amount'),
  submitNewOrderBtn: document.getElementById('submit-new-order-btn'),
  servicesError: document.getElementById('services-error'),
  servicesTbody: document.getElementById('services-tbody'),
  newServiceForm: document.getElementById('new-service-form'),
  newServiceError: document.getElementById('new-service-error'),
  svcName: document.getElementById('svc-name'),
  svcUnit: document.getElementById('svc-unit'),
  svcDuration: document.getElementById('svc-duration'),
  svcPrice: document.getElementById('svc-price'),
  submitServiceBtn: document.getElementById('submit-service-btn'),
  rekapDate: document.getElementById('rekap-date'),
  rekapError: document.getElementById('rekap-error'),
  rekapCashTotal: document.getElementById('rekap-cash-total'),
  rekapNewOrders: document.getElementById('rekap-new-orders'),
  rekapUnpaidTotal: document.getElementById('rekap-unpaid-total'),
  rekapUnpaidCount: document.getElementById('rekap-unpaid-count'),
  rekapTunai: document.getElementById('rekap-tunai'),
  rekapQris: document.getElementById('rekap-qris'),
  rekapTransfer: document.getElementById('rekap-transfer'),
  toast: document.getElementById('toast'),
};

function showToast(message) {
  dom.toast.textContent = message;
  dom.toast.classList.remove('hidden');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => {
    dom.toast.classList.add('hidden');
  }, 2600);
}

async function apiFetch(url, options = {}) {
  const res = await fetch(url, {
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });

  let data = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }

  if (res.status === 401 && url !== '/api/auth/login') {
    setAuthenticated(false, 'Sesi kasir berakhir. Silakan masukkan PIN kembali.');
    const err = new Error(data.error || 'Sesi kasir diperlukan.');
    err.status = 401;
    throw err;
  }

  if (!res.ok) {
    const err = new Error(data.error || `Permintaan gagal (${res.status}).`);
    err.status = res.status;
    throw err;
  }

  return data;
}

function applyStoreMeta(meta) {
  if (!meta) return;
  state.storeMeta = { ...state.storeMeta, ...meta };
  const name = state.storeMeta.storeName || 'Laundry Bening Harian';
  dom.loginStoreName.textContent = name;
  dom.topbarStoreName.textContent = name;
  document.title = `Kasir — ${name}`;
}

function setAuthenticated(isAuth, loginMessage = '') {
  state.authenticated = isAuth;
  if (isAuth) {
    dom.loginView.classList.add('hidden');
    dom.appView.classList.remove('hidden');
    showBanner(dom.loginError, '');
  } else {
    dom.appView.classList.add('hidden');
    dom.loginView.classList.remove('hidden');
    dom.pinInput.value = '';
    showBanner(dom.loginError, loginMessage);
  }
}

function switchTab(tabName) {
  state.activeTab = tabName;
  for (const btn of dom.navTabs) {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  }
  dom.tabOrders.classList.toggle('hidden', tabName !== 'orders');
  dom.tabServices.classList.toggle('hidden', tabName !== 'services');
  dom.tabSummary.classList.toggle('hidden', tabName !== 'summary');

  if (tabName === 'orders') {
    refreshOrdersAndKpi();
  } else if (tabName === 'services') {
    loadServicesList();
  } else if (tabName === 'summary') {
    loadRekapSummary();
  }
}

async function loadKpiSummary() {
  try {
    const summary = await apiFetch('/api/summary');
    dom.kpiActive.textContent = String(summary.activeCount ?? 0);
    dom.kpiReady.textContent = String(summary.readyCount ?? 0);
    dom.kpiOverdue.textContent = String(summary.overdueCount ?? 0);
    dom.kpiCash.textContent = formatRupiah(summary.cashTotalIdr ?? 0);
  } catch (err) {
    if (err.status !== 401) {
      showBanner(dom.ordersError, err.message);
    }
  }
}

function buildOrdersQueryUrl() {
  const params = new URLSearchParams();
  if (state.search.trim()) {
    params.set('search', state.search.trim());
  }
  if (state.filter === 'OVERDUE') {
    params.set('overdue', '1');
  } else if (state.filter === 'UNPAID') {
    params.set('unpaid', '1');
  } else if (state.filter !== 'ALL') {
    params.set('status', state.filter);
  }
  const qs = params.toString();
  return qs ? `/api/orders?${qs}` : '/api/orders';
}

async function loadOrders() {
  showBanner(dom.ordersError, '');
  try {
    const data = await apiFetch(buildOrdersQueryUrl());
    state.orders = data.orders || [];
    renderOrderList();

    if (state.selectedOrderId) {
      const match = state.orders.find((o) => o.id === state.selectedOrderId);
      if (match) {
        state.selectedOrder = match;
        renderInspector();
      } else {
        // Keep inspector synced even if current filter excludes selected order
        await refreshSelectedOrder(state.selectedOrderId);
      }
    }
  } catch (err) {
    if (err.status !== 401) {
      showBanner(dom.ordersError, err.message);
    }
  }
}

async function refreshSelectedOrder(orderId) {
  try {
    const data = await apiFetch(`/api/orders/${orderId}`);
    state.selectedOrder = data.order;
    renderInspector();
  } catch {
    state.selectedOrder = null;
    state.selectedOrderId = null;
    renderInspector();
  }
}

async function refreshOrdersAndKpi() {
  await Promise.all([loadKpiSummary(), loadOrders()]);
}

function renderOrderList() {
  if (state.orders.length === 0) {
    dom.orderList.replaceChildren(
      el('div', { className: 'empty-state' }, 'Tidak ada nota yang cocok dengan filter saat ini.')
    );
    return;
  }

  const rows = state.orders.map((order) => {
    const isSelected = order.id === state.selectedOrderId;

    const badges = [makeStatusBadge(order.status)];
    if (order.isOverdue) {
      badges.push(el('span', { className: 'badge badge-error' }, 'Terlambat'));
    }

    let payText;
    if (order.status === 'DIBATALKAN') {
      payText = el('span', { className: 'muted-text' }, 'Dibatalkan');
    } else if (order.remainingIdr > 0) {
      const label = order.paymentStatus === 'DP' ? 'DP • Sisa ' : 'Belum Lunas • ';
      payText = el(
        'span',
        { className: 'badge badge-warn tabular' },
        `${label}${formatRupiah(order.remainingIdr)}`
      );
    } else {
      payText = el('span', { className: 'badge badge-lunas' }, 'Lunas');
    }

    return el(
      'button',
      {
        type: 'button',
        className: `order-row${isSelected ? ' selected' : ''}`,
        onClick: () => selectOrder(order.id),
      },
      el(
        'div',
        { className: 'order-row-top' },
        el('span', { className: 'order-row-code' }, order.orderCode),
        el('div', { className: 'order-row-badges' }, ...badges)
      ),
      el(
        'div',
        { className: 'order-row-mid' },
        el('span', { className: 'order-row-customer' }, order.customerName),
        payText
      ),
      el(
        'div',
        { className: 'order-row-bottom' },
        el('span', { className: 'order-row-items' }, summarizeItems(order.items)),
        el('span', { className: 'tabular' }, `Est. ${formatDateTimeWib(order.dueAt)}`)
      )
    );
  });

  dom.orderList.replaceChildren(...rows);
}

function selectOrder(orderId) {
  state.selectedOrderId = orderId;
  state.confirmCancelId = null;
  state.selectedOrder = state.orders.find((o) => o.id === orderId) || null;
  closeNewOrderDrawer();
  renderOrderList();
  renderInspector();
}

function buildWhatsAppText(order) {
  const trackUrl = `${window.location.origin}/track?code=${encodeURIComponent(order.orderCode)}`;
  const itemLines = order.items
    .map((it) => `- ${it.serviceName} (${formatQty(it.qty, it.unit)}): ${formatRupiah(it.subtotalIdr)}`)
    .join('\n');

  const lines = [
    `*${state.storeMeta.storeName}*`,
    `Nota: *${order.orderCode}*`,
    `Pelanggan: ${order.customerName}`,
    `Status: ${STATUS_META[order.status]?.label || order.status}`,
  ];
  if (order.rackCode) {
    lines.push(`Lokasi Rak: ${order.rackCode}`);
  }
  lines.push(
    '',
    'Rincian:',
    itemLines,
    '',
    `Total: ${formatRupiah(order.totalIdr)}`,
    `Sudah Bayar: ${formatRupiah(order.paidIdr)}`,
    `Sisa Bayar: ${formatRupiah(order.remainingIdr)}`,
    `Estimasi Selesai: ${formatDateTimeWib(order.dueAt)}`,
    '',
    `Cek status cucian kapan saja:`,
    trackUrl
  );
  return lines.join('\n');
}

async function copyWhatsAppMessage(order) {
  const text = buildWhatsAppText(order);
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      showToast('Pesan WhatsApp berhasil disalin.');
      return;
    }
  } catch {
    // Fall through to textarea fallback
  }

  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
    showToast('Pesan WhatsApp berhasil disalin.');
  } catch {
    showToast('Gagal menyalin otomatis. Salin link lacak secara manual.');
  } finally {
    document.body.removeChild(ta);
  }
}

function renderInspector() {
  const order = state.selectedOrder;
  if (!order) {
    dom.inspectorCodeChip.classList.add('hidden');
    dom.inspectorEmpty.classList.remove('hidden');
    dom.inspectorContent.classList.add('hidden');
    dom.inspectorContent.replaceChildren();
    return;
  }

  dom.inspectorCodeChip.textContent = order.orderCode;
  dom.inspectorCodeChip.classList.remove('hidden');
  dom.inspectorEmpty.classList.add('hidden');
  dom.inspectorContent.classList.remove('hidden');

  const inspectorAlert = el('div', { className: 'banner banner-error hidden', role: 'alert' });

  // Section 1: Header & Customer Meta
  const headerBadges = [makeStatusBadge(order.status), makePaymentBadge(order.paymentStatus)];
  if (order.isOverdue) {
    headerBadges.push(el('span', { className: 'badge badge-error' }, 'Melewati Janji'));
  }

  const metaItems = [
    el(
      'div',
      { className: 'meta-item' },
      el('span', { className: 'meta-label' }, 'Pelanggan'),
      el('span', { className: 'meta-val' }, order.customerName)
    ),
    el(
      'div',
      { className: 'meta-item' },
      el('span', { className: 'meta-label' }, 'No. HP (Kasir / Lacak)'),
      el('span', { className: 'meta-val mono' }, `${order.customerPhone} (${order.maskedPhone})`)
    ),
    el(
      'div',
      { className: 'meta-item' },
      el('span', { className: 'meta-label' }, 'Estimasi Selesai'),
      el('span', { className: 'meta-val tabular' }, formatDateTimeWib(order.dueAt))
    ),
    el(
      'div',
      { className: 'meta-item' },
      el('span', { className: 'meta-label' }, 'Masuk Nota'),
      el('span', { className: 'meta-val tabular' }, formatDateTimeWib(order.createdAt))
    ),
  ];

  if (order.internalNote) {
    metaItems.push(
      el(
        'div',
        { className: 'meta-item', style: 'grid-column: 1 / -1;' },
        el('span', { className: 'meta-label' }, 'Catatan Internal'),
        el('span', { className: 'meta-val' }, order.internalNote)
      )
    );
  }

  // Rack Update Row
  const rackInput = el('input', {
    type: 'text',
    className: 'input mono',
    maxlength: '20',
    value: order.rackCode || '',
    placeholder: 'Misal: A-02',
    'aria-label': 'Kode rak penyimpanan',
    disabled: order.status === 'DIAMBIL' || order.status === 'DIBATALKAN',
  });

  const saveRackBtn = el(
    'button',
    {
      type: 'button',
      className: 'btn',
      disabled: order.status === 'DIAMBIL' || order.status === 'DIBATALKAN',
      onClick: async () => {
        showBanner(inspectorAlert, '');
        saveRackBtn.disabled = true;
        try {
          const res = await apiFetch(`/api/orders/${order.id}/status`, {
            method: 'PATCH',
            body: JSON.stringify({ status: order.status, rackCode: rackInput.value }),
          });
          state.selectedOrder = res.order;
          showToast('Kode rak diperbarui.');
          await refreshOrdersAndKpi();
        } catch (err) {
          showBanner(inspectorAlert, err.message);
        } finally {
          saveRackBtn.disabled = false;
        }
      },
    },
    'Simpan Rak'
  );

  // Status Transition Controls
  const nextStatuses = VALID_TRANSITIONS[order.status] || [];
  const isTerminal = order.status === 'DIAMBIL' || order.status === 'DIBATALKAN';
  const unpaidBlockPickup = order.status === 'SIAP_AMBIL' && order.remainingIdr > 0;

  const statusButtons = nextStatuses.map((nextSt) => {
    const label = `Ubah ke ${STATUS_META[nextSt]?.label || nextSt}`;
    const isPickup = nextSt === 'DIAMBIL';
    return el(
      'button',
      {
        type: 'button',
        className: 'btn btn-primary',
        disabled: isPickup && unpaidBlockPickup,
        onClick: async () => {
          showBanner(inspectorAlert, '');
          try {
            const res = await apiFetch(`/api/orders/${order.id}/status`, {
              method: 'PATCH',
              body: JSON.stringify({ status: nextSt, rackCode: rackInput.value }),
            });
            state.selectedOrder = res.order;
            state.confirmCancelId = null;
            showToast(`Status diperbarui ke ${STATUS_META[nextSt]?.label || nextSt}.`);
            await refreshOrdersAndKpi();
          } catch (err) {
            showBanner(inspectorAlert, err.message);
          }
        },
      },
      label
    );
  });

  let cancelSection = null;
  if (!isTerminal) {
    if (state.confirmCancelId === order.id) {
      cancelSection = el(
        'div',
        { className: 'inline-row' },
        el('span', { className: 'secondary-text' }, 'Batalkan nota ini?'),
        el(
          'button',
          {
            type: 'button',
            className: 'btn btn-danger btn-sm',
            onClick: async () => {
              showBanner(inspectorAlert, '');
              try {
                const res = await apiFetch(`/api/orders/${order.id}/status`, {
                  method: 'PATCH',
                  body: JSON.stringify({ status: 'DIBATALKAN', rackCode: rackInput.value }),
                });
                state.selectedOrder = res.order;
                state.confirmCancelId = null;
                showToast('Nota dibatalkan.');
                await refreshOrdersAndKpi();
              } catch (err) {
                showBanner(inspectorAlert, err.message);
              }
            },
          },
          'Ya, Batalkan'
        ),
        el(
          'button',
          {
            type: 'button',
            className: 'btn btn-sm',
            onClick: () => {
              state.confirmCancelId = null;
              renderInspector();
            },
          },
          'Batal'
        )
      );
    } else {
      cancelSection = el(
        'button',
        {
          type: 'button',
          className: 'btn btn-danger',
          onClick: () => {
            state.confirmCancelId = order.id;
            renderInspector();
          },
        },
        'Batalkan'
      );
    }
  }

  // Line Items Table
  const itemRows = order.items.map((it) =>
    el(
      'tr',
      {},
      el('td', {}, it.serviceName),
      el('td', { className: 'num' }, formatQty(it.qty, it.unit)),
      el('td', { className: 'num' }, formatRupiah(it.subtotalIdr))
    )
  );

  // Payment Section
  let paymentSection = null;
  if (order.remainingIdr > 0 && order.status !== 'DIBATALKAN') {
    const payAmountInput = el('input', {
      type: 'number',
      inputmode: 'numeric',
      min: '1',
      max: String(order.remainingIdr),
      step: '500',
      className: 'input tabular',
      value: String(order.remainingIdr),
      required: true,
    });
    const payMethodSelect = el(
      'select',
      { className: 'select' },
      el('option', { value: 'TUNAI' }, 'TUNAI'),
      el('option', { value: 'QRIS' }, 'QRIS'),
      el('option', { value: 'TRANSFER' }, 'TRANSFER')
    );
    const payBtn = el(
      'button',
      {
        type: 'submit',
        className: 'btn btn-primary',
      },
      'Catat Pembayaran'
    );

    const payForm = el(
      'form',
      {
        className: 'inline-form-row',
        onSubmit: async (e) => {
          e.preventDefault();
          showBanner(inspectorAlert, '');
          const amt = Number(payAmountInput.value);
          payBtn.disabled = true;
          try {
            const res = await apiFetch(`/api/orders/${order.id}/payments`, {
              method: 'POST',
              body: JSON.stringify({
                amountIdr: amt,
                method: payMethodSelect.value,
              }),
            });
            state.selectedOrder = res.order;
            showToast('Pembayaran berhasil dicatat.');
            await refreshOrdersAndKpi();
          } catch (err) {
            showBanner(inspectorAlert, err.message);
          } finally {
            payBtn.disabled = false;
          }
        },
      },
      el('div', { className: 'field' }, el('label', { className: 'field-label' }, 'Nominal (Rp)'), payAmountInput),
      el('div', { className: 'field' }, el('label', { className: 'field-label' }, 'Metode'), payMethodSelect),
      payBtn
    );

    paymentSection = el(
      'div',
      { className: 'inspector-section' },
      el('h3', { className: 'section-title' }, 'Catat Pembayaran'),
      payForm
    );
  }

  // Payment History
  let paymentHistoryEl = null;
  if (order.payments && order.payments.length > 0) {
    paymentHistoryEl = el(
      'div',
      { className: 'inspector-section' },
      el('span', { className: 'field-label' }, 'Riwayat Pembayaran'),
      el(
        'div',
        { className: 'table-wrap' },
        el(
          'table',
          { className: 'data-table' },
          el(
            'thead',
            {},
            el('tr', {}, el('th', {}, 'Waktu'), el('th', {}, 'Metode'), el('th', { className: 'num' }, 'Nominal'))
          ),
          el(
            'tbody',
            {},
            ...order.payments.map((p) =>
              el(
                'tr',
                {},
                el('td', {}, formatDateTimeWib(p.paidAt)),
                el('td', {}, `${p.method} (${p.kind})`),
                el('td', { className: 'num' }, formatRupiah(p.amountIdr))
              )
            )
          )
        )
      )
    );
  }

  const parts = [
    inspectorAlert,
    el(
      'div',
      { className: 'inspector-section' },
      el('div', { className: 'order-row-badges' }, ...headerBadges),
      el('div', { className: 'meta-grid' }, ...metaItems)
    ),
    el(
      'div',
      { className: 'inspector-section' },
      el('span', { className: 'field-label' }, 'Rak & Proses Cucian'),
      el(
        'div',
        { className: 'inline-row' },
        el('div', { style: 'flex: 1 1 160px;' }, rackInput),
        saveRackBtn
      ),
      unpaidBlockPickup
        ? el(
            'div',
            { className: 'banner banner-warn' },
            `Sisa tagihan ${formatRupiah(order.remainingIdr)} harus dilunasi sebelum status diubah ke Diambil.`
          )
        : null,
      !isTerminal
        ? el('div', { className: 'inline-row' }, ...statusButtons, cancelSection)
        : el(
            'p',
            { className: 'muted-text' },
            order.status === 'DIAMBIL'
              ? `Diserahkan pada ${formatDateTimeWib(order.completedAt)}`
              : `Dibatalkan pada ${formatDateTimeWib(order.completedAt)}`
          )
    ),
    el(
      'div',
      { className: 'inspector-section' },
      el('span', { className: 'field-label' }, 'Rincian Layanan'),
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
          el('tbody', {}, ...itemRows)
        )
      ),
      el(
        'div',
        { className: 'summary-rows' },
        el('div', { className: 'summary-line' }, el('span', {}, 'Total Tagihan'), el('strong', {}, formatRupiah(order.totalIdr))),
        el('div', { className: 'summary-line' }, el('span', {}, 'Sudah Dibayar'), el('span', {}, formatRupiah(order.paidIdr))),
        el('div', { className: 'summary-line strong' }, el('span', {}, 'Sisa Bayar'), el('span', {}, formatRupiah(order.remainingIdr)))
      )
    ),
    paymentSection,
    paymentHistoryEl,
    el(
      'div',
      { className: 'inspector-section' },
      el(
        'div',
        { className: 'inline-row' },
        el(
          'button',
          {
            type: 'button',
            className: 'btn',
            onClick: () => copyWhatsAppMessage(order),
          },
          'Salin Pesan WhatsApp'
        ),
        el(
          'a',
          {
            href: `/track?code=${encodeURIComponent(order.orderCode)}`,
            target: '_blank',
            rel: 'noopener noreferrer',
            className: 'btn',
          },
          'Buka Halaman Lacak'
        )
      )
    ),
  ];

  dom.inspectorContent.replaceChildren(...parts.filter(Boolean));
}

// New Order Drawer Logic
async function openNewOrderDrawer() {
  switchTab('orders');
  showBanner(dom.newOrderError, '');

  try {
    const data = await apiFetch('/api/services?activeOnly=1');
    state.activeServices = data.services || [];
  } catch (err) {
    if (err.status !== 401) {
      showBanner(dom.newOrderError, err.message);
    }
  }

  state.isNewOrderOpen = true;
  dom.inspectorPanel.classList.add('hidden');
  dom.newOrderPanel.classList.remove('hidden');

  dom.newOrderForm.reset();
  dom.newPayMethodWrap.classList.add('hidden');
  dom.newPayDpWrap.classList.add('hidden');

  const firstSvc = state.activeServices[0];
  state.newOrderRows = firstSvc
    ? [{ serviceId: firstSvc.id, qty: firstSvc.unit === 'KG' ? '2.0' : '1' }]
    : [];

  renderNewOrderRows();
}

function closeNewOrderDrawer() {
  state.isNewOrderOpen = false;
  dom.newOrderPanel.classList.add('hidden');
  dom.inspectorPanel.classList.remove('hidden');
}

function computeRowSubtotal(row) {
  const svc = state.activeServices.find((s) => s.id === Number(row.serviceId));
  if (!svc) return 0;
  const num = Number(String(row.qty ?? '').replace(',', '.'));
  if (!Number.isFinite(num) || num <= 0) return 0;
  const tenths = Math.round(num * 10);
  return Math.round((tenths * svc.priceIdr) / 10);
}

function updateNewOrderTotal() {
  const total = state.newOrderRows.reduce((sum, r) => sum + computeRowSubtotal(r), 0);
  dom.newOrderTotal.textContent = formatRupiah(total);
}

function renderNewOrderRows() {
  if (state.activeServices.length === 0) {
    dom.newOrderItems.replaceChildren(
      el('div', { className: 'banner banner-warn' }, 'Belum ada layanan aktif. Aktifkan layanan terlebih dahulu di tab Layanan & Tarif.')
    );
    updateNewOrderTotal();
    return;
  }

  const rowNodes = state.newOrderRows.map((row, idx) => {
    const svc = state.activeServices.find((s) => s.id === Number(row.serviceId)) || state.activeServices[0];
    row.serviceId = svc.id;

    const selectEl = el(
      'select',
      {
        className: 'select',
        'aria-label': `Layanan baris ${idx + 1}`,
        onChange: (e) => {
          const nextId = Number(e.target.value);
          row.serviceId = nextId;
          const nextSvc = state.activeServices.find((s) => s.id === nextId);
          if (nextSvc && nextSvc.unit === 'PCS') {
            const parsed = Math.max(1, Math.round(Number(row.qty) || 1));
            row.qty = String(parsed);
          }
          renderNewOrderRows();
        },
      },
      ...state.activeServices.map((s) =>
        el(
          'option',
          { value: s.id, selected: s.id === svc.id },
          `${s.name} (${formatRupiah(s.priceIdr)}/${s.unit})`
        )
      )
    );

    const subtotalEl = el('span', { className: 'item-row-subtotal' }, formatRupiah(computeRowSubtotal(row)));

    const qtyInput = el('input', {
      type: 'number',
      inputmode: svc.unit === 'KG' ? 'decimal' : 'numeric',
      step: svc.unit === 'KG' ? '0.1' : '1',
      min: svc.unit === 'KG' ? '0.1' : '1',
      className: 'input tabular',
      value: String(row.qty),
      'aria-label': `Jumlah ${svc.unit}`,
      onInput: (e) => {
        row.qty = e.target.value;
        subtotalEl.textContent = formatRupiah(computeRowSubtotal(row));
        updateNewOrderTotal();
      },
    });

    const removeBtn = el(
      'button',
      {
        type: 'button',
        className: 'btn btn-sm',
        disabled: state.newOrderRows.length <= 1,
        'aria-label': 'Hapus baris layanan',
        onClick: () => {
          state.newOrderRows.splice(idx, 1);
          renderNewOrderRows();
        },
      },
      'Hapus'
    );

    return el('div', { className: 'item-row-line' }, selectEl, qtyInput, subtotalEl, removeBtn);
  });

  dom.newOrderItems.replaceChildren(...rowNodes);
  updateNewOrderTotal();
}

// Services Tab
async function loadServicesList() {
  showBanner(dom.servicesError, '');
  try {
    const data = await apiFetch('/api/services');
    state.allServices = data.services || [];
    renderServicesTable();
  } catch (err) {
    if (err.status !== 401) {
      showBanner(dom.servicesError, err.message);
    }
  }
}

function renderServicesTable() {
  if (state.allServices.length === 0) {
    dom.servicesTbody.replaceChildren(
      el('tr', {}, el('td', { colspan: '6', className: 'empty-state' }, 'Belum ada layanan terdaftar.'))
    );
    return;
  }

  const rows = state.allServices.map((svc) =>
    el(
      'tr',
      {},
      el('td', {}, el('strong', {}, svc.name)),
      el('td', {}, svc.unit),
      el('td', { className: 'num' }, formatRupiah(svc.priceIdr)),
      el('td', { className: 'num' }, `${svc.durationHours} jam`),
      el(
        'td',
        {},
        el('span', { className: `badge ${svc.isActive ? 'badge-siap' : 'badge-diambil'}` }, svc.isActive ? 'Aktif' : 'Nonaktif')
      ),
      el(
        'td',
        {},
        el(
          'button',
          {
            type: 'button',
            className: 'btn btn-sm',
            onClick: async () => {
              showBanner(dom.servicesError, '');
              try {
                await apiFetch(`/api/services/${svc.id}`, {
                  method: 'PATCH',
                  body: JSON.stringify({ isActive: !svc.isActive }),
                });
                showToast(svc.isActive ? 'Layanan dinonaktifkan.' : 'Layanan diaktifkan.');
                await loadServicesList();
              } catch (err) {
                showBanner(dom.servicesError, err.message);
              }
            },
          },
          svc.isActive ? 'Nonaktifkan' : 'Aktifkan'
        )
      )
    )
  );

  dom.servicesTbody.replaceChildren(...rows);
}

// Rekap Kas Tab
async function loadRekapSummary() {
  showBanner(dom.rekapError, '');
  const dateVal = dom.rekapDate.value || todayJakartaDate();
  try {
    const data = await apiFetch(`/api/summary?date=${encodeURIComponent(dateVal)}`);
    dom.rekapCashTotal.textContent = formatRupiah(data.cashTotalIdr ?? 0);
    dom.rekapNewOrders.textContent = String(data.newOrdersCount ?? 0);
    dom.rekapUnpaidTotal.textContent = formatRupiah(data.unpaidTotalIdr ?? 0);
    dom.rekapUnpaidCount.textContent = `${data.unpaidCount ?? 0} nota aktif belum lunas`;
    dom.rekapTunai.textContent = formatRupiah(data.cashByMethod?.TUNAI ?? 0);
    dom.rekapQris.textContent = formatRupiah(data.cashByMethod?.QRIS ?? 0);
    dom.rekapTransfer.textContent = formatRupiah(data.cashByMethod?.TRANSFER ?? 0);
  } catch (err) {
    if (err.status !== 401) {
      showBanner(dom.rekapError, err.message);
    }
  }
}

// Event Listeners
dom.loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  showBanner(dom.loginError, '');
  const pin = dom.pinInput.value.trim();
  if (!pin) {
    showBanner(dom.loginError, 'Masukkan PIN toko terlebih dahulu.');
    return;
  }

  dom.loginSubmitBtn.disabled = true;
  try {
    const data = await apiFetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ pin }),
    });
    applyStoreMeta(data);
    setAuthenticated(true);
    await refreshOrdersAndKpi();
  } catch (err) {
    showBanner(dom.loginError, err.message);
  } finally {
    dom.loginSubmitBtn.disabled = false;
  }
});

dom.logoutBtn.addEventListener('click', async () => {
  try {
    await apiFetch('/api/auth/logout', { method: 'POST', body: '{}' });
  } catch {
    // Ignore logout network error and reset local UI state
  }
  state.selectedOrderId = null;
  state.selectedOrder = null;
  closeNewOrderDrawer();
  setAuthenticated(false);
});

for (const tabBtn of dom.navTabs) {
  tabBtn.addEventListener('click', () => switchTab(tabBtn.dataset.tab));
}

dom.newOrderBtn.addEventListener('click', openNewOrderDrawer);
dom.cancelNewOrderBtn.addEventListener('click', closeNewOrderDrawer);

dom.orderSearch.addEventListener('input', () => {
  state.search = dom.orderSearch.value;
  clearTimeout(state.searchTimer);
  state.searchTimer = setTimeout(loadOrders, 180);
});

for (const chip of dom.filterChips) {
  chip.addEventListener('click', () => {
    state.filter = chip.dataset.filter;
    for (const c of dom.filterChips) {
      c.classList.toggle('active', c === chip);
    }
    loadOrders();
  });
}

dom.addItemRowBtn.addEventListener('click', () => {
  const firstSvc = state.activeServices[0];
  if (!firstSvc) return;
  state.newOrderRows.push({
    serviceId: firstSvc.id,
    qty: firstSvc.unit === 'KG' ? '1.0' : '1',
  });
  renderNewOrderRows();
});

dom.newPayKind.addEventListener('change', () => {
  const kind = dom.newPayKind.value;
  dom.newPayMethodWrap.classList.toggle('hidden', kind === 'NONE');
  dom.newPayDpWrap.classList.toggle('hidden', kind !== 'DP');
});

dom.newOrderForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  showBanner(dom.newOrderError, '');

  const payload = {
    customerName: dom.newCustomerName.value.trim(),
    customerPhone: dom.newCustomerPhone.value.trim(),
    rackCode: dom.newRackCode.value.trim(),
    internalNote: dom.newInternalNote.value.trim(),
    items: state.newOrderRows.map((r) => ({
      serviceId: Number(r.serviceId),
      qty: r.qty,
    })),
    initialPayment: {
      kind: dom.newPayKind.value,
      method: dom.newPayMethod.value,
      amountIdr: dom.newPayKind.value === 'DP' ? Number(dom.newPayAmount.value) : undefined,
    },
  };

  dom.submitNewOrderBtn.disabled = true;
  try {
    const res = await apiFetch('/api/orders', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    const created = res.order;
    state.selectedOrderId = created.id;
    state.selectedOrder = created;
    closeNewOrderDrawer();
    showToast(`Nota ${created.orderCode} berhasil dibuat.`);
    await refreshOrdersAndKpi();
    renderInspector();
  } catch (err) {
    showBanner(dom.newOrderError, err.message);
  } finally {
    dom.submitNewOrderBtn.disabled = false;
  }
});

dom.newServiceForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  showBanner(dom.newServiceError, '');

  const payload = {
    name: dom.svcName.value.trim(),
    unit: dom.svcUnit.value,
    priceIdr: Number(dom.svcPrice.value),
    durationHours: Number(dom.svcDuration.value),
  };

  dom.submitServiceBtn.disabled = true;
  try {
    await apiFetch('/api/services', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    dom.newServiceForm.reset();
    dom.svcDuration.value = '24';
    showToast('Layanan baru berhasil ditambahkan.');
    await loadServicesList();
  } catch (err) {
    showBanner(dom.newServiceError, err.message);
  } finally {
    dom.submitServiceBtn.disabled = false;
  }
});

dom.rekapDate.addEventListener('change', loadRekapSummary);

// Bootstrap
async function init() {
  dom.rekapDate.value = todayJakartaDate();
  try {
    const session = await apiFetch('/api/auth/session');
    applyStoreMeta(session);
    if (session.authenticated) {
      setAuthenticated(true);
      await refreshOrdersAndKpi();
    } else {
      setAuthenticated(false);
    }
  } catch (err) {
    setAuthenticated(false, err.message);
  }
}

init();
