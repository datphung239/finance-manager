const API_URL = "https://script.google.com/macros/s/AKfycbwvVhOuRtGTNi9fR5IIEOtRPMkmtLZHW9n2r0YzkcnU5MGFpyEGYgJ6HxjmkoHdaR8L/exec";
const CLIENT_ID = "457034906414-kk5rglsgac2krun66bprec56v0i3c2n2.apps.googleusercontent.com";

// The two public endpoint identifiers are prepended by the build script.
let googleToken = null;
let currentStatementsData = [];
let recognitionInstance = null;
let isProcessingVoice = false;
let merchantMapData = {};
let cashMerchantMapData = {};
let chartTrendsInstance = null;
let chartPaymentInstance = null;
let chartTargetInstance = null;
let chartDailyInstance = null;
let chartBusinessResultInstance = null;
let chartBusinessRevenueExpenseInstance = null;
let activeEmail = '';
let authEpoch = 0;
let dataEpoch = 0;
let cardFilterSeq = 0;
let cashFilterSeq = 0;
let bootstrapPromise = null;
let initialDataPromise = null;
let authInitialized = false;
let pendingCashChartData = null;
let chartLibrariesPromise = null;
let modalLibraryPromise = null;
let recommendationSeq = 0;
let recentCardData = [];
let recentCashData = [];
const memoryCache = new Map();
const inFlight = new Map();
const requestControllers = new Set();
const deletingRows = new Set();
const CACHE_TTL = 30000;
const CACHE_MAX_AGE = 24 * 60 * 60 * 1000;
const endpointHash = Array.from(API_URL).reduce((n, c) => ((n << 5) - n + c.charCodeAt(0)) | 0, 0);
window.fmPerformance = {requests: []};

function storageGet(key) { try { return localStorage.getItem(key); } catch (_) { return null; } }
function storageSet(key, value) { try { localStorage.setItem(key, value); } catch (_) {} }
function storageRemove(key) { try { localStorage.removeItem(key); } catch (_) {} }
function cachePrefix() { return `fm:v2:${endpointHash}:${activeEmail}:`; }
function pendingMutationKey() { return cachePrefix() + 'pendingMutation'; }
function savePendingMutation(item) {
  if (!activeEmail || !item) return;
  storageSet(pendingMutationKey(), JSON.stringify({...item, savedAt: Date.now()}));
}
function readPendingMutation() {
  try {
    const item = JSON.parse(storageGet(pendingMutationKey()) || 'null');
    if (!item || !item.requestId || !item.type || !Number.isFinite(item.savedAt)) return null;
    if (Date.now() - item.savedAt > 48 * 60 * 60 * 1000) { storageRemove(pendingMutationKey()); return null; }
    return item;
  } catch (_) { return null; }
}
function clearPendingMutation(requestId) {
  const item = readPendingMutation();
  if (!requestId || !item || item.requestId === requestId) storageRemove(pendingMutationKey());
}
function cacheRead(name, validator = null) {
  if (!activeEmail) return null;
  const key = cachePrefix() + name;
  try {
    const item = memoryCache.get(key) || JSON.parse(storageGet(key) || 'null');
    if (!item || !Number.isFinite(item.savedAt) || Date.now() - item.savedAt > CACHE_MAX_AGE) return null;
    if (validator && !validator(item.data)) {
      cacheRemove(name);
      return null;
    }
    return item;
  } catch (_) { return null; }
}
function cacheWrite(name, data, savedAt = Date.now()) {
  if (!activeEmail) return;
  const key = cachePrefix() + name;
  const item = {savedAt, data};
  memoryCache.set(key, item);
  storageSet(key, JSON.stringify(item));
}
function cacheRemove(name) {
  const key = cachePrefix() + name;
  memoryCache.delete(key);
  storageRemove(key);
}
function clearAppCache() {
  ['initial', 'cardView', 'cashDashboard', 'cardTransactions', 'cashTransactions'].forEach(cacheRemove);
  ['app_init_data', 'app_dash_data', 'app_cash_dash_data', 'app_tx_spending', 'app_tx_cash'].forEach(storageRemove);
}
function invalidateFinancialCaches() {
  dataEpoch++;
  ['cardView', 'cashDashboard', 'cardTransactions', 'cashTransactions'].forEach(cacheRemove);
  pendingCashChartData = null;
  storageSet(cachePrefix() + 'invalidation', makeRequestId());
}
function setSyncStatus(text, state = 'loading') {
  const el = document.getElementById('syncStatus');
  if (!el) return;
  el.textContent = text;
  el.dataset.state = state;
}
function cachedStatus(savedAt) {
  return 'Bản đã lưu lúc ' + new Date(savedAt).toLocaleString('vi-VN') + ' · Đang cập nhật…';
}
function freshStatus(savedAt = Date.now()) {
  setSyncStatus('Dữ liệu tải lúc ' + new Date(savedAt).toLocaleTimeString('vi-VN'), 'ready');
}
function currentCashMode() { return !document.getElementById('cashAppContainer').classList.contains('hidden'); }
function cashDashboardVisible() { return currentCashMode() && document.getElementById('cashDashboardBlock').style.display !== 'none'; }
function escapeHTML(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c])); }
function inlineArg(value) { return escapeHTML(JSON.stringify(value)); }

function setTodayDefaultDates() {
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  ['date','cashDate'].forEach(id => { const el = document.getElementById(id); if (el) el.value = today; });
}
function decodeToken(token) {
  const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(part), c => c.charCodeAt(0))));
}
function initAuth() {
  if (authInitialized || !window.google?.accounts?.id) return;
  authInitialized = true;
  google.accounts.id.initialize({client_id: CLIENT_ID, callback: handleCredentialResponse});
  if (!googleToken) showLoginPrompt();
  else google.accounts.id.cancel();
}
function waitForGoogleSdk(attempt = 0) {
  if (window.google?.accounts?.id) { initAuth(); return; }
  if (attempt < 60) setTimeout(() => waitForGoogleSdk(attempt + 1), 250);
  else if (!googleToken) {
    document.getElementById('google-btn-container').textContent = 'Chưa tải được đăng nhập Google. Vui lòng tải lại trang.';
  }
}
function showLoginPrompt() {
  updateUI('', false);
  if (!window.google?.accounts?.id) return;
  google.accounts.id.renderButton(document.getElementById('google-btn-container'), {theme:'outline',size:'large'});
  google.accounts.id.prompt();
}
async function handleCredentialResponse(response) {
  try {
    googleToken = response.credential;
    const payload = decodeToken(googleToken);
    storageSet('google_id_token', googleToken);
    await verifyAndProceed(payload.email);
  } catch (_) { logout(); }
}
async function verifyAndProceed(email) {
  activeEmail = String(email || '').toLowerCase();
  authEpoch++;
  const epoch = authEpoch;
  updateUI(email, true);
  // Bootstrap performs authorization and returns the first screen in ONE request.
  const result = await fetchInitialAppDataServer();
  // Cash flow is the fastest useful landing screen; the Card flow remains
  // available from the mode switch above it.
  if (googleToken && epoch === authEpoch) switchMainMode('cash');
  // A response can be lost after Apps Script commits the write. Reconcile a
  // durable request id after a reload so pressing F5 cannot create a duplicate.
  recoverPendingMutation();
  return result;
}
function updateUI(email, isLoggedIn) {
  document.getElementById('user-email').textContent = email;
  document.getElementById('google-btn-container').classList.toggle('hidden', isLoggedIn);
  document.getElementById('user-info').classList.toggle('hidden', !isLoggedIn);
  document.getElementById('app-container').classList.toggle('hidden', !isLoggedIn);
  if (isLoggedIn && window.google?.accounts?.id) google.accounts.id.cancel();
}
function logout() {
  authEpoch++;
  dataEpoch++;
  clearAppCache();
  googleToken = null;
  activeEmail = '';
  storageRemove('google_id_token');
  requestControllers.forEach(controller => controller.abort());
  inFlight.clear();
  bootstrapPromise = null;
  initialDataPromise = null;
  currentStatementsData = [];
  recentCardData = [];
  recentCashData = [];
  pendingCashChartData = null;
  resetVoiceUI();
  document.getElementById('dashContent').style.display = 'none';
  document.getElementById('cashDashContent').style.display = 'none';
  document.getElementById('txList').replaceChildren();
  document.getElementById('txListCash').replaceChildren();
  showLoginPrompt();
}

function isTransientRequestError(error) {
  if (!error || error.retryable === false) return false;
  if (error.name === 'AbortError' || error.name === 'TypeError') return true;
  const status = Number(error.status || String(error.message || '').match(/^HTTP (\d+)/)?.[1]);
  return status === 404 || status === 408 || status === 425 || status === 429 || status >= 500;
}

function retryDelay(attempt) { return 250 * Math.pow(2, Math.max(0, attempt - 1)); }

function sendRequest(action, payload = {}, options = {}) {
  if (!googleToken) return Promise.resolve(null);
  const epoch = authEpoch;
  const token = googleToken;
  const mutation = ['mutateTransaction','submitData','deleteTransaction'].includes(action);
  const key = `${epoch}:${dataEpoch}:${action}:${JSON.stringify(payload)}`;
  if (!mutation && inFlight.has(key)) return inFlight.get(key);
  const task = (async () => {
    const started = performance.now();
    let serverMs;
    let lastError = null;
    const maxRetries = Number.isInteger(options.retries) ? options.retries : (mutation ? 2 : 1);
    const timeoutMs = options.timeoutMs || (mutation ? 20000 : 15000);
    try {
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        let controller = null;
        let timeout = null;
        try {
          controller = new AbortController();
          requestControllers.add(controller);
          timeout = setTimeout(() => controller.abort(), timeoutMs);
          const response = await fetch(API_URL, {method:'POST', signal:controller.signal,
            cache:'no-store', redirect:'follow',
            body:JSON.stringify({action, ...payload, token})});
          if (!response || !response.ok) {
            const error = new Error(`HTTP ${response?.status || 0}`);
            error.status = Number(response?.status || 0);
            throw error;
          }
          const result = await response.json();
          serverMs = result?.meta?.serverMs;
          if (epoch !== authEpoch || token !== googleToken) return null;
          if (!result || result.success !== true) {
            const message = String(result?.message || result?.error || 'Yêu cầu thất bại.');
            if (result?.code === 'AUTH' || message === 'EXPIRED_TOKEN' || /không có quyền|Token không đúng định dạng|Thiếu Token/.test(message)) {
              logout();
              alert(message === 'EXPIRED_TOKEN' ? 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.' : message);
              return null;
            }
            const error = new Error(message);
            error.retryable = false;
            throw error;
          }
          return result.data !== undefined ? result.data : result.message;
        } catch (error) {
          lastError = error;
          if (epoch !== authEpoch) return null;
          if (!isTransientRequestError(error) || attempt >= maxRetries) throw error;
          setSyncStatus(`Đang thử kết nối lại… (${attempt + 1}/${maxRetries})`, 'loading');
          await new Promise(resolve => setTimeout(resolve, retryDelay(attempt + 1)));
          if (epoch !== authEpoch || token !== googleToken) return null;
        } finally {
          if (timeout) clearTimeout(timeout);
          if (controller) requestControllers.delete(controller);
        }
      }
      throw lastError || new Error('Không nhận được phản hồi từ máy chủ.');
    } catch (err) {
      if (epoch !== authEpoch) return null;
      const message = err.name === 'AbortError'
        ? (mutation ? 'Chưa nhận được xác nhận lưu/xóa sau khi thử lại. Hãy bấm Lưu lại; hệ thống sẽ kiểm tra request cũ để tránh ghi trùng.' : 'Máy chủ phản hồi quá lâu. Bạn có thể bấm Làm mới để thử lại.')
        : 'Lỗi: ' + (err.message || 'Không nhận được phản hồi từ máy chủ.');
      setSyncStatus(message, 'error');
      if (options.errorTarget === 'cash' || currentCashMode()) showAlertCash(message, 'danger');
      else showAlert(message, 'danger');
      return null;
    } finally {
      window.fmPerformance.requests.push({action, durationMs:Math.round(performance.now()-started), serverMs});
      if (window.fmPerformance.requests.length > 100) window.fmPerformance.requests.shift();
    }
  })();
  if (!mutation) {
    inFlight.set(key, task);
    task.finally(() => { if (inFlight.get(key) === task) inFlight.delete(key); });
  }
  return task;
}

async function reconcileMutation(requestId, errorTarget) {
  if (!requestId || !googleToken) return null;
  const status = await sendRequest('getMutationStatus', {requestId}, {retries: 1, errorTarget});
  if (status && status.found && status.type) {
    return {message: status.message || 'Đã lưu giao dịch thành công!', type: status.type,
      transactions: null, refreshError: 'reconciled', updatedAt: status.updatedAt || Date.now()};
  }
  return null;
}

async function recoverPendingMutation() {
  const pending = readPendingMutation();
  if (!pending || !googleToken) return;
  const result = await reconcileMutation(pending.requestId, pending.type === 'cash_spending' ? 'cash' : undefined);
  if (result) {
    clearPendingMutation(pending.requestId);
    acceptMutation(result);
    if (pending.type === 'cash_spending') showAlertCash('Đã xác nhận giao dịch trước đó đã lưu thành công.', 'success');
    else showAlert('Đã xác nhận giao dịch trước đó đã lưu thành công.', 'success');
    return;
  }
  setSyncStatus('Có giao dịch trước đó chưa nhận xác nhận. Hãy kiểm tra lịch sử trước khi lưu lại.', 'error');
}

function renderCategoryReport(reportData) {
  const body = document.getElementById('categoryReportTable');
  const rows = Array.isArray(reportData) ? reportData : [];
  if (!rows.length) { body.innerHTML = '<tr><td colspan="2" class="text-center text-muted">Không có dữ liệu.</td></tr>'; return; }
  body.innerHTML = rows.map((row, idx) => {
    const isTotal = ['TỔNG','CÒN LẠI','ĐÃ THANH TOÁN','TRỪ VÀO SAO KÊ'].some(k => String(row.label).toUpperCase().includes(k));
    const cls = idx === 0 ? 'table-primary fw-bold' : isTotal ? 'summary-row' : '';
    return `<tr class="${cls}"><td>${escapeHTML(row.label)}</td><td class="text-end">${escapeHTML(typeof row.amount === 'number' ? formatVND(row.amount) : row.amount)}</td></tr>`;
  }).join('');
}
function renderCardView(view) {
  if (!isCardViewShape(view)) return false;
  renderDashboard(view.dashboard);
  renderCategoryReport(view.categoryReport);
  document.getElementById('dashContent').style.display = 'block';
  return true;
}

function isInitialDataShape(data) {
  return !!data && typeof data === 'object' &&
    Array.isArray(data.cards) && Array.isArray(data.categories) &&
    Array.isArray(data.merchants) && Array.isArray(data.cashCategories) &&
    Array.isArray(data.cashCPCategories) && Array.isArray(data.cashMerchants);
}

function isCardViewShape(view) {
  const dashboard = view && view.dashboard;
  return !!view && typeof view === 'object' && !!dashboard &&
    typeof dashboard === 'object' && !!dashboard.kpi &&
    typeof dashboard.kpi === 'object' && Array.isArray(dashboard.statements) &&
    !!dashboard.filters && typeof dashboard.filters === 'object' &&
    Array.isArray(view.categoryReport);
}

function isCashDashboardShape(data) {
  return !!data && typeof data === 'object' && !!data.period &&
    !!data.paymentData && Array.isArray(data.monthTrends) &&
    !!data.ratioTableData && !!data.frequencyData && !!data.dailyData &&
    !!data.targetData && !!data.businessData &&
    Array.isArray(data.businessData.result) &&
    Array.isArray(data.businessData.revenueExpense);
}

function isBootstrapShape(data) {
  return !!data && isInitialDataShape(data.initialData) && isCardViewShape(data.cardView) &&
    (data.cashDashboard === undefined || isCashDashboardShape(data.cashDashboard));
}

function isTransactionListShape(list) {
  return Array.isArray(list) && list.every(item => item && typeof item === 'object');
}

function fetchInitialDataOnly(force = true) {
  const cached = cacheRead('initial', isInitialDataShape);
  if (cached) {
    applyInitialData(cached.data);
    return Promise.resolve(cached.data);
  }
  if (initialDataPromise) return initialDataPromise;
  const epoch = authEpoch;
  const task = (async () => {
    const data = await sendRequest('getInitialData', {force: force === true}, {retries: 2});
    if (epoch !== authEpoch) return null;
    if (!isInitialDataShape(data)) {
      cacheRemove('initial');
      return null;
    }
    cacheWrite('initial', data);
    applyInitialData(data);
    return data;
  })();
  initialDataPromise = task;
  task.finally(() => { if (initialDataPromise === task) initialDataPromise = null; });
  return task;
}

function ensureInitialData(force = false) {
  const cached = cacheRead('initial', isInitialDataShape);
  if (cached) {
    applyInitialData(cached.data);
    return Promise.resolve(cached.data);
  }
  return fetchInitialDataOnly(force);
}

function fetchInitialAppDataServer() {
  if (bootstrapPromise) return bootstrapPromise;
  const initial = cacheRead('initial', isInitialDataShape);
  if (initial) applyInitialData(initial.data);
  const cached = cacheRead('cardView', isCardViewShape);
  if (cached && renderCardView(cached.data)) setSyncStatus(cachedStatus(cached.savedAt));
  else setSyncStatus('Đang tải dữ liệu…');
  document.getElementById('loadingDash').style.display = cached ? 'none' : 'block';
  const cachedCash = cacheRead('cashDashboard', isCashDashboardShape);
  if (cachedCash) {
    document.getElementById('cashDashContent').style.display = 'block';
    document.getElementById('loadingCashDash').style.display = 'none';
    renderCashDashboard(cachedCash.data);
  }
  const epoch = authEpoch, revision = dataEpoch, filterSeq = cardFilterSeq;
  const task = (async () => {
    let data = await sendRequest('getBootstrap', {force:true}, {retries: 2});
    if (epoch !== authEpoch) return;
    document.getElementById('loadingDash').style.display = 'none';
    if (!isBootstrapShape(data)) {
      // A temporary Apps Script 404 must not leave the card select empty until F5.
      const initialData = await fetchInitialDataOnly(true);
      const cachedView = cacheRead('cardView', isCardViewShape);
      const cardView = cachedView?.data || await sendRequest('getCardView', {force:true}, {retries: 2});
      const cachedCash = cacheRead('cashDashboard', isCashDashboardShape);
      const cashDashboard = cachedCash?.data || await sendRequest('getCashDashboardData', {force:true}, {retries: 2});
      if (isInitialDataShape(initialData)) {
        cacheWrite('initial', initialData);
        applyInitialData(initialData);
      }
      if (isCardViewShape(cardView)) {
        data = {
          initialData: initialData || (isInitialDataShape(data?.initialData) ? data.initialData : null),
          cardView,
          cashDashboard: isCashDashboardShape(cashDashboard) ? cashDashboard : undefined
        };
      } else {
        setSyncStatus('Không tải được dữ liệu thẻ. Hãy bấm lại tab hoặc Làm mới.', 'error');
        return;
      }
    }
    if (isInitialDataShape(data.initialData)) {
      cacheWrite('initial', data.initialData);
      applyInitialData(data.initialData);
    }
    if (isCashDashboardShape(data.cashDashboard)) {
      cacheWrite('cashDashboard', data.cashDashboard, data.cashDashboard.updatedAt);
    }
    if (revision !== dataEpoch) {
      setTimeout(() => { if (googleToken && !currentCashMode() && document.getElementById('dashboardBlock').style.display !== 'none') loadDashboard(true); }, 0);
      return;
    }
    if (filterSeq === cardFilterSeq) {
      cacheWrite('cardView', data.cardView, data.cardView.updatedAt);
      if (renderCardView(data.cardView)) freshStatus(data.cardView.updatedAt);
    }
  })();
  bootstrapPromise = task;
  task.finally(() => { if (bootstrapPromise === task) bootstrapPromise = null; });
  return task;
}

document.addEventListener('DOMContentLoaded', () => {
  setTodayDefaultDates();
  const token = storageGet('google_id_token');
  if (token) {
    try {
      const payload = decodeToken(token);
      if (payload.exp * 1000 > Date.now() && payload.email) {
        googleToken = token;
        verifyAndProceed(payload.email);
      } else storageRemove('google_id_token');
    } catch (_) { storageRemove('google_id_token'); }
  }
  waitForGoogleSdk();
});

let lastHiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) lastHiddenAt = Date.now();
  else if (googleToken && !bootstrapPromise && lastHiddenAt && Date.now()-lastHiddenAt > CACHE_TTL) refreshVisibleScreen();
});
window.addEventListener('online', () => { if (googleToken && !bootstrapPromise) refreshVisibleScreen(); });
window.addEventListener('storage', event => {
  if (!googleToken || event.key !== cachePrefix() + 'invalidation') return;
  dataEpoch++;
  ['cardView', 'cashDashboard', 'cardTransactions', 'cashTransactions'].forEach(name => memoryCache.delete(cachePrefix() + name));
  pendingCashChartData = null;
  if (!document.hidden) refreshVisibleScreen();
});

function refreshVisibleScreen() {
  if (currentCashMode()) {
    return cashDashboardVisible() ? loadCashDashboard(true) : loadRecentCashTransactions(true);
  }
  return document.getElementById('dashboardBlock').style.display !== 'none' ? loadDashboard(true) : loadRecentTransactions(true);
}


function applyInitialData(data) {
  if (!isInitialDataShape(data)) return false;
  const ids = ['card', 'cardTarget', 'dashFilterCard', 'dashFilterCategory'];
  const values = ids.map(id => document.getElementById(id)?.value);
  applyInitialDataContent(data);
  ids.forEach((id, index) => {
    const select = document.getElementById(id);
    if (select && Array.from(select.options).some(option => option.value === values[index])) select.value = values[index];
  });
  return true;
}

function applyInitialDataContent(data) {
  if (!isInitialDataShape(data)) return false;
  // Populate dropdowns cho Thẻ
  populateDropdown('card', data.cards, '-- Chọn thẻ --');
  populateDropdown('dashFilterCard', data.cards, '-- Tất cả Thẻ --');
  populateDropdown('dashFilterCategory', data.categories, '-- Tất cả Danh Mục --');
  // RENDER LINH HOẠT ĐỐI TƯỢNG CHI TIÊU CHO CARD
  const cardTargetSelect = document.getElementById('cardTarget');
  if (cardTargetSelect) {
    const selectedTarget = cardTargetSelect.value;
    const targets = ['', 'Bạn Bè', 'Gia Đình', 'Người Yêu', ...data.cashCPCategories]
      .map(value => String(value ?? '').trim())
      .filter((value, index, all) => all.indexOf(value) === index);
    const targetSignature = targets.join('\u001f');
    if (cardTargetSelect.dataset.optionsSignature !== targetSignature) {
      cardTargetSelect.innerHTML = targets.map((value, index) => {
        const label = index === 0 ? 'Bản thân (Mặc định)' : value;
        return `<option value="${escapeHTML(value)}">${escapeHTML(label)}</option>`;
      }).join('');
      cardTargetSelect.dataset.optionsSignature = targetSignature;
    }
    if (targets.includes(selectedTarget)) cardTargetSelect.value = selectedTarget;
  }
  // 1. Datalist Danh mục & Merchant cho Thẻ Tín Dụng (CARDS MANAGEMENT)
  const catOpt = document.getElementById('categoryOptions');
  if (catOpt) setDatalistOptions(catOpt, data.categories);

  const merchOpt = document.getElementById('merchantOptions');
  if (merchOpt) setDatalistOptions(merchOpt, data.merchants);

  if (data.merchantCategoryMap) {
    merchantMapData = data.merchantCategoryMap;
  }

  // 2. Datalist Danh mục & Merchant cho Dòng Tiền Mặt / Bank (CASH MANAGEMENT)
  const cashCatOpt = document.getElementById('cashCategoryOptions');
  if (cashCatOpt) setDatalistOptions(cashCatOpt, data.cashCategories);

  const cashMerchOpt = document.getElementById('cashMerchantOptions');
  if (cashMerchOpt) setDatalistOptions(cashMerchOpt, data.cashMerchants);

  if (data.cashMerchantCategoryMap) {
    cashMerchantMapData = data.cashMerchantCategoryMap;
  }
  return true;
}

function populateDropdown(elemId, list, defaultText) {
  const sel = document.getElementById(elemId);
  if (!sel) return;
  const values = Array.isArray(list) ? list.map(value => String(value ?? '').trim()).filter(Boolean)
    .filter((value, index, all) => all.indexOf(value) === index) : [];
  const signature = defaultText + '\u001f' + values.join('\u001f');
  const selected = sel.value;
  if (sel.dataset.optionsSignature !== signature) {
    sel.innerHTML = `<option value="">${escapeHTML(defaultText)}</option>` +
      values.map(value => `<option value="${escapeHTML(value)}">${escapeHTML(value)}</option>`).join('');
    sel.dataset.optionsSignature = signature;
  }
  if (values.includes(selected)) sel.value = selected;
}

function setDatalistOptions(elem, list) {
  if (!elem) return;
  const values = Array.isArray(list) ? list.map(value => String(value ?? '').trim()).filter(Boolean)
    .filter((value, index, all) => all.indexOf(value) === index) : [];
  const signature = values.join('\u001f');
  if (elem.dataset.optionsSignature === signature) return;
  elem.innerHTML = values.map(value => `<option value="${escapeHTML(value)}">`).join('');
  elem.dataset.optionsSignature = signature;
}

function autoMatchCategoryFromMerchant(val, type = 'card') {
  if (!val) return;
  const cleanVal = val.trim().toLowerCase();
  const map = (type === 'cash') ? cashMerchantMapData : merchantMapData;
  const catFieldId = (type === 'cash') ? 'cashCategory' : 'categoryInput';

  for (const [merch, cat] of Object.entries(map)) {
    if (merch.toLowerCase() === cleanVal || cleanVal.includes(merch.toLowerCase())) {
      document.getElementById(catFieldId).value = cat;
      if (type === 'cash') validateDTAmount();
      else handleCategoryChange();
      break;
    }
  }
}

function switchMainMode(mode) {
  const isCard = mode === 'card';
  document.getElementById('btnModeCard').className = isCard ? 'btn btn-primary fw-bold btn-main-mode active' : 'btn btn-outline-primary fw-bold btn-main-mode';
  document.getElementById('btnModeCash').className = !isCard ? 'btn btn-success fw-bold btn-main-mode active' : 'btn btn-outline-success fw-bold btn-main-mode';
  document.getElementById('cardAppContainer').classList.toggle('hidden', !isCard);
  document.getElementById('cashAppContainer').classList.toggle('hidden', isCard);
  if (!isCard) {
    if (document.getElementById('tab-cash-dash').classList.contains('active')) loadCashDashboard();
    else loadRecentCashTransactions();
  } else {
    ensureInitialData();
    if (document.getElementById('dashboardBlock').style.display !== 'none') loadDashboard();
    else loadRecentTransactions();
  }
}

function switchCashTab(type) {
  const isDash = (type === 'dash');
  document.getElementById('tab-cash-dash').classList.toggle('active', isDash);
  document.getElementById('tab-cash-input').classList.toggle('active', !isDash);

  document.getElementById('cashDashboardBlock').style.display = isDash ? 'block' : 'none';
  document.getElementById('cashInputBlock').style.display = !isDash ? 'block' : 'none';

  if (isDash) {
    loadCashDashboard(false);
  } else {
    setTodayDefaultDates();
    loadRecentCashTransactions(false);
  }
}

function switchForm(type) {
  document.querySelectorAll('#mainTab .nav-link').forEach(btn => btn.classList.remove('active'));
  const activeTab = document.getElementById(`tab-${type}`);
  if (activeTab) activeTab.classList.add('active');

  document.getElementById('dashboardBlock').style.display = (type === 'dashboard') ? 'block' : 'none';
  document.getElementById('inputFormFields').style.display = (type === 'spending') ? 'block' : 'none';

  if (type === 'dashboard') loadDashboard();
  if (type === 'spending') {
    document.getElementById('entryType').value = 'spending';
    resetVoiceUI();
    ensureInitialData();
    loadRecentTransactions(false);
  }
}

function quickPay(cardName, remainingAmount) {
  switchForm('spending');
  const cardSelect = document.getElementById('card');
  if (cardSelect) cardSelect.value = cardName;
  const catInput = document.getElementById('categoryInput');
  if (catInput) catInput.value = "TTT_Trực Tuyến";
  const amountInput = document.getElementById('amount');
  if (amountInput) {
    const amt = (remainingAmount && remainingAmount > 0) ? -Math.abs(remainingAmount) : '';
    amountInput.value = amt;
  }
  setTodayDefaultDates();
  handleCategoryChange();
  showAlert(`Đã điền tự động thanh toán thẻ "${cardName}"!`, 'info');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function handleCategoryChange() {
  const catVal = document.getElementById('categoryInput').value.trim();
  const amtInput = document.getElementById('amount');
  const help = document.getElementById('cardCategoryHelp');
  let rawVal = amtInput.value.replace(/[^0-9-]/g, '');

  if (catVal.toUpperCase().startsWith("TTT_")) {
    if (rawVal && !rawVal.startsWith("-")) {
      amtInput.value = "-" + rawVal.replace(/-/g, '');
    }
    help.className = "form-text small text-danger fw-bold";
    help.innerText = "✓ Thanh toán thẻ (TTT_) -> Số tiền BẮT BỘC ÂM (-)";
  } else {
    if (rawVal.startsWith("-")) {
      amtInput.value = rawVal.replace(/-/g, '');
    }
    help.className = "form-text small text-muted";
    help.innerText = "Chi tiêu thẻ -> Số Tiền DƯƠNG (+)";
  }
}
function validateDTAmount() {
  const catInput = document.getElementById('cashCategory').value.trim();
  const amtInput = document.getElementById('cashAmount');
  const targetSelect = document.getElementById('cashTarget');
  const help = document.getElementById('amountHelp');

  let val = amtInput.value.replace(/[^0-9-]/g, '');
  const catUpper = catInput.toUpperCase();
  const isDT = catUpper.startsWith("DT-");
  const isCP = catUpper.startsWith("CP-");

  // 1. Doanh Thu Kinh Doanh (bắt đầu bằng DT-)
  if (isDT) {
    if (val && !val.startsWith("-")) {
      amtInput.value = "-" + val;
    }
    targetSelect.value = "Kinh doanh"; // 👈 Đổi thành chữ d thường
    
    help.className = "form-text small text-success fw-bold";
    help.innerText = "✓ Doanh Thu Kinh Doanh -> Tự động ghi ÂM (-) & Đối tượng: Kinh doanh";
  } 
  // 2. Chi Phí Kinh Doanh (bắt đầu bằng CP-)
  else if (isCP) {
    if (val.startsWith("-")) {
      amtInput.value = val.replace("-", "");
    }
    targetSelect.value = "Kinh doanh"; // 👈 Đổi thành chữ d thường

    help.className = "form-text small text-primary fw-bold";
    help.innerText = "✓ Chi Phí Kinh Doanh -> Số DƯƠNG (+) & Đối tượng: Kinh doanh";
  } 
  // 3. Chi tiêu sinh hoạt cá nhân thông thường
  else {
    if (val.startsWith("-")) {
      amtInput.value = val.replace("-", "");
    }
    targetSelect.disabled = false;
    // Kiểm tra và reset nếu trước đó đang là Kinh doanh
    if (targetSelect.value === "Kinh doanh" || targetSelect.value === "Kinh Doanh") {
      targetSelect.value = "";
    }
    help.className = "form-text small text-danger";
    help.innerText = "Chi tiêu sinh hoạt -> Tự động ghi DƯƠNG (+)";
  }
}
async function handleCashFormSubmit(event, form) {
  event.preventDefault();
  const btn = document.getElementById('btnSubmitCash');
  if (btn.disabled) return;
  const formObject = Object.fromEntries(new FormData(form).entries());
  if (/^(CP-|DT-)/i.test(String(formObject.category || '').trim())) formObject.target = 'Kinh doanh';
  const payloadKey = JSON.stringify(formObject);
  if (form.dataset.pendingPayload !== payloadKey) {
    form.dataset.pendingPayload = payloadKey;
    form.dataset.requestId = makeRequestId();
  }
  savePendingMutation({requestId:form.dataset.requestId, type:'cash_spending', operation:'save', formObject});
  btn.disabled = true;
  btn.innerText = 'Đang lưu…';
  try {
    let result = await sendRequest('mutateTransaction', {operation:'save', formObject, requestId:form.dataset.requestId, includeTransactions:false}, {errorTarget:'cash'});
    if (!result) result = await reconcileMutation(form.dataset.requestId, 'cash');
    if (!result) return;
    clearPendingMutation(form.dataset.requestId);
    acceptMutation(result);
    showAlertCash(result.message, 'success');
    form.reset();
    delete form.dataset.pendingPayload;
    delete form.dataset.requestId;
    setTodayDefaultDates();
    validateDTAmount();
  } finally { btn.disabled = false; btn.innerText = 'Lưu Giao Dịch Cash'; }
}

function loadRecentCashTransactions(forceFetch = false) { return loadRecentFor('cash_spending', forceFetch); }

function renderRecentCashListUI(list) {
  const txList = document.getElementById('txListCash');
  if (!txList) return;
  if (!Array.isArray(list)) {
    txList.innerHTML = '<p class="text-center text-danger m-0 py-2 small">Không tải được lịch sử giao dịch. Hãy bấm Làm mới.</p>';
    return;
  }
  if (list.length === 0) {
    txList.innerHTML = '<p class="text-center text-muted m-0 py-2 small">Chưa có giao dịch Cash.</p>';
    return;
  }

  txList.innerHTML = '<div class="list-group list-group-flush">' + list.map(item => {
    const amt = Number(item.amount || 0);
    const isInc = amt < 0;
    const dateFormatted = formatDate(item.date);
    const amtFormatted = Math.abs(amt).toLocaleString('vi-VN');
    const methodBadge = `<span class="badge ${item.method === 'Chuyển Khoản' ? 'bg-success' : 'bg-secondary'}">${item.method || 'Tiền Mặt'}</span>`;
    const merchBadge = item.merchant ? `<span class="badge bg-light text-dark border ms-1">${escapeHTML(item.merchant)}</span>` : '';
    const targetBadge = (item.target && item.target !== 'Bản thân' && item.target.trim()) ? `<span class="badge bg-light text-dark border ms-1">${escapeHTML(item.target)}</span>` : '';

    return `
      <div class="tx-item d-flex justify-content-between align-items-center py-2 border-bottom">
        <div>
          <div class="fw-bold small">${dateFormatted} - ${methodBadge}</div>
          <div class="text-dark small">${escapeHTML(item.category || 'Chưa phân loại')} ${merchBadge} ${targetBadge}</div>
          <div class="${isInc ? 'text-success' : 'text-danger'} fw-bold small">${isInc ? '+' : '-'}${amtFormatted} đ</div>
        </div>
        <button class="btn btn-outline-danger btn-sm py-0 px-2" type="button" onclick="confirmDeleteCash(${item.rowIndex}, ${inlineArg(dateFormatted)}, ${inlineArg(item.category)}, ${inlineArg(amtFormatted)})"><i class="bi bi-trash"></i></button>
      </div>`;
  }).join('') + '</div>';
}

function confirmDeleteCash(rowIndex, date, category, amount) {
  return deleteRowFromUI('cash_spending', rowIndex, `- Ngày: ${date}\n- Danh mục: ${category}\n- Số tiền: ${amount} đ`);
}

function showAlertCash(msg, type) {
  const alert = document.getElementById('alertMsgCash');
  if (!alert) return;
  alert.className = `alert alert-${type} py-2 px-3 small fw-bold shadow-sm border mb-3`;
  alert.innerHTML = (type === 'danger') ? `<i class="bi bi-exclamation-triangle-fill me-1"></i> ${escapeHTML(msg)}` : `<i class="bi bi-check-circle-fill me-1"></i> ${escapeHTML(msg)}`;
  alert.style.display = 'block';
  setTimeout(() => { alert.style.display = 'none'; }, 3000);
}

async function loadCashDashboard(fetchServer = false) {
  const cached = cacheRead('cashDashboard', isCashDashboardShape);
  if (cached) {
    document.getElementById('cashDashContent').style.display = 'block';
    renderCashDashboard(cached.data);
    if (!fetchServer && Date.now()-cached.savedAt < CACHE_TTL) {
      document.getElementById('loadingCashDash').style.display = 'none';
      freshStatus(cached.savedAt);
      return;
    }
    setSyncStatus(cachedStatus(cached.savedAt));
  } else setSyncStatus('Đang tải dashboard dòng tiền…');
  document.getElementById('loadingCashDash').style.display = cached ? 'none' : 'block';
  // Download charts while Sheets is responding, only after this screen is opened.
  ensureCashCharts().catch(() => {});
  const epoch = authEpoch, revision = dataEpoch, seq = cashFilterSeq;
  const data = await sendRequest('getCashDashboardData', {force:fetchServer}, {errorTarget:'cash'});
  if (epoch !== authEpoch || revision !== dataEpoch || seq !== cashFilterSeq) return;
  document.getElementById('loadingCashDash').style.display = 'none';
  if (!isCashDashboardShape(data)) {
    cacheRemove('cashDashboard');
    setSyncStatus('Phản hồi dashboard dòng tiền không hợp lệ. Hãy bấm Làm mới.', 'error');
    return;
  }
  cacheWrite('cashDashboard', data, data.updatedAt);
  document.getElementById('cashDashContent').style.display = 'block';
  renderCashDashboard(data);
  freshStatus(data.updatedAt);
}

function renderCashDashboard(d) {
// 1. Hiển thị 2.2: Tiền Mặt & Tài Khoản Hiện Có
  if (d.cashBalances) {
    document.getElementById('kpiCashBalance').innerText = formatVND(d.cashBalances.cash);
    document.getElementById('kpiBankBalance').innerText = formatVND(d.cashBalances.bank);
    document.getElementById('kpiTotalBalance').innerText = formatVND(d.cashBalances.total);
  }

  // 🟢 2. Hiển thị Danh Mục Đầu Tư & Biến Động Giá Trị
  const investBody = document.getElementById('investmentTableBody');
  if (investBody && Array.isArray(d.investmentData)) {
    let totalCap = 0;
    let totalVal = 0;
  
    investBody.innerHTML = d.investmentData.map(item => {
      totalCap += item.capital || 0;
      totalVal += item.currentValue || 0;
  
      const isPositive = (item.changePct || 0) > 0;
      const isZero = (item.changePct || 0) === 0;
      const badgeCls = isZero ? 'bg-secondary-subtle text-secondary' : isPositive ? 'bg-success-subtle text-success' : 'bg-danger-subtle text-danger';
  
      return `
        <tr>
          <td class="fw-bold text-dark nowrap-text px-1">${escapeHTML(item.name)}</td>
          <td class="text-end text-muted nowrap-text px-1">${item.capital ? formatVND(item.capital) : '-'}</td>
          <td class="text-end fw-semibold nowrap-text px-1">${item.currentValue ? formatVND(item.currentValue) : '-'}</td>
          <td class="text-end nowrap-text px-1">
            <span class="badge ${badgeCls}" style="font-size: 0.68rem;">${escapeHTML(item.changeStr)}</span>
          </td>
        </tr>`;
    }).join('');
  
    // Tính tổng hiệu suất toàn bộ danh mục
    const totalDiff = totalVal - totalCap;
    const totalPct = totalCap > 0 ? (totalDiff / totalCap) * 100 : 0;
    const totalGainEl = document.getElementById('kpiInvestTotalGain');
    if (totalGainEl) {
      totalGainEl.innerText = (totalPct >= 0 ? '+' : '') + totalPct.toFixed(2) + '%';
      totalGainEl.className = `badge ${totalPct >= 0 ? 'bg-success-subtle text-success border-success-subtle' : 'bg-danger-subtle text-danger border-danger-subtle'} border flex-shrink-0`;
    }
  }
  document.getElementById('cashTotalRev').innerText = formatVND(d.period.totalRevenue);
  document.getElementById('cashTotalExp').innerText = formatVND(d.period.totalExpense);

  const filterStart = document.getElementById('cashFilterStart');
  const filterEnd = document.getElementById('cashFilterEnd');
  if (filterStart && d.period.startDate) filterStart.value = convertDisplayToInputDate(d.period.startDate);
  if (filterEnd && d.period.endDate) filterEnd.value = convertDisplayToInputDate(d.period.endDate);

  const payMonthInput = document.getElementById('cashPaymentMonth');
  if (payMonthInput && d.paymentData.filterMonth) payMonthInput.value = convertDisplayToInputDate(d.paymentData.filterMonth);

  const ratioMonthInput = document.getElementById('cashRatioMonth');
  if (ratioMonthInput && d.ratioTableData.filterMonth) ratioMonthInput.value = convertDisplayToInputDate(d.ratioTableData.filterMonth);

  const businessMonthInput = document.getElementById('cashBusinessMonth');
  if (businessMonthInput && d.businessData?.filterMonth) businessMonthInput.value = convertDisplayToInputDate(d.businessData.filterMonth);

  document.getElementById('thRatioM1').innerText = d.ratioTableData.months[0] || '-';
  document.getElementById('thRatioM2').innerText = d.ratioTableData.months[1] || '-';
  document.getElementById('thRatioM3').innerText = d.ratioTableData.months[2] || '-';

  document.getElementById('tdRevM1').innerText = formatVND(d.ratioTableData.revenue[0]);
  document.getElementById('tdRevM2').innerText = formatVND(d.ratioTableData.revenue[1]);
  document.getElementById('tdRevM3').innerText = formatVND(d.ratioTableData.revenue[2]);

  document.getElementById('tdExpM1').innerText = formatVND(d.ratioTableData.expense[0]);
  document.getElementById('tdExpM2').innerText = formatVND(d.ratioTableData.expense[1]);
  document.getElementById('tdExpM3').innerText = formatVND(d.ratioTableData.expense[2]);

  document.getElementById('tdPctM1').innerText = d.ratioTableData.ratio[0];
  document.getElementById('tdPctM2').innerText = d.ratioTableData.ratio[1];
  document.getElementById('tdPctM3').innerText = d.ratioTableData.ratio[2];

  document.getElementById('cashTxCount').innerText = d.frequencyData.txCount + " lần";
  document.getElementById('cashAvgAmt').innerText = formatVND(d.frequencyData.avgAmt);
  document.getElementById('cashMaxAmt').innerText = formatVND(d.frequencyData.maxAmt);

  const catTbody = document.getElementById('tableCatChanges');
  catTbody.innerHTML = '';
  if (d.catChanges && d.catChanges.length > 0) {
    catTbody.innerHTML = d.catChanges.map(c => {
      const isInc = c.diff > 0;
      const colorClass = isInc ? 'text-danger' : (c.diff < 0 ? 'text-success' : 'text-muted');
      const sign = isInc ? '+' : '';
      return `
        <tr>
          <td class="fw-bold nowrap-text">${escapeHTML(c.category)}</td>
          <td class="text-end nowrap-text">${formatVND(c.thisMonth)}</td>
          <td class="text-end text-muted nowrap-text">${formatVND(c.lastMonth)}</td>
          <td class="text-end fw-bold ${colorClass} nowrap-text">${sign}${formatVND(c.diff)}</td>
          <td class="text-end fw-bold ${colorClass} nowrap-text">${c.percent}</td>
        </tr>`;
    }).join('');
  } else {
    catTbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-2">Không có dữ liệu danh mục.</td></tr>';
  }

  pendingCashChartData = d;
  drawCashChartsWhenReady();
}

function renderCashCharts(d) {
  const businessData = d.businessData || {result: [], revenueExpense: [], filterMonth: ''};
  const businessResult = Array.isArray(businessData.result) ? businessData.result : [];
  const businessRevenueExpense = Array.isArray(businessData.revenueExpense) ? businessData.revenueExpense : [];

  chartBusinessResultInstance = upsertChart('chartBusinessResult', chartBusinessResultInstance, {
    type: 'bar',
    plugins: [ChartDataLabels],
    data: {
      labels: businessResult.map(row => row.category),
      datasets: [
        {
          label: 'Tháng này',
          data: businessResult.map(row => Number(row.thisMonth) || 0),
          backgroundColor: '#198754', borderColor: '#198754', borderRadius: 5, barPercentage: 0.78
        },
        {
          label: 'Tháng trước',
          data: businessResult.map(row => Number(row.lastMonth) || 0),
          backgroundColor: '#6c757d', borderColor: '#6c757d', borderRadius: 5, barPercentage: 0.78
        }
      ]
    },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      layout: {padding: {top: 8, right: 12, left: 4, bottom: 4}},
      scales: {
        x: {beginAtZero: true, grid: {color: 'rgba(0,0,0,.08)'}, ticks: {callback: value => formatCompactVND(value)}},
        y: {grid: {display: false}, ticks: {autoSkip: false, font: {size: 10}}}
      },
      plugins: {
        legend: {position: 'top', labels: {boxWidth: 12, font: {size: 10}}},
        tooltip: {callbacks: {label: context => `${context.dataset.label}: ${formatVND(context.parsed.x)}`}},
        datalabels: {
          display: context => Math.abs(Number(context.dataset.data[context.dataIndex]) || 0) > 0,
          color: context => Number(context.dataset.data[context.dataIndex]) < 0 ? '#b02a37' : '#146c43',
          anchor: context => Number(context.dataset.data[context.dataIndex]) < 0 ? 'start' : 'end',
          align: context => Number(context.dataset.data[context.dataIndex]) < 0 ? 'left' : 'right',
          clamp: true, font: {size: 9, weight: 'bold'}, formatter: value => formatCompactVND(value)
        }
      }
    }
  });

  chartBusinessRevenueExpenseInstance = upsertChart('chartBusinessRevenueExpense', chartBusinessRevenueExpenseInstance, {
    type: 'bar',
    plugins: [ChartDataLabels],
    data: {
      labels: businessRevenueExpense.map(row => row.category),
      datasets: [
        {
          label: 'Doanh thu',
          data: businessRevenueExpense.map(row => Number(row.revenue) || 0),
          backgroundColor: '#20c997', borderColor: '#20c997', borderRadius: 5, barPercentage: 0.78
        },
        {
          label: 'Chi phí',
          data: businessRevenueExpense.map(row => Number(row.expense) || 0),
          backgroundColor: '#dc3545', borderColor: '#dc3545', borderRadius: 5, barPercentage: 0.78
        }
      ]
    },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      layout: {padding: {top: 8, right: 12, left: 4, bottom: 4}},
      scales: {
        x: {beginAtZero: true, grid: {color: 'rgba(0,0,0,.08)'}, ticks: {callback: value => formatCompactVND(value)}},
        y: {grid: {display: false}, ticks: {autoSkip: false, font: {size: 10}}}
      },
      plugins: {
        legend: {position: 'top', labels: {boxWidth: 12, font: {size: 10}}},
        tooltip: {callbacks: {label: context => `${context.dataset.label}: ${formatVND(context.parsed.x)}`}},
        datalabels: {
          display: context => Number(context.dataset.data[context.dataIndex]) > 0,
          color: context => context.datasetIndex === 1 ? '#b02a37' : '#146c43',
          anchor: 'end', align: 'right', clamp: true,
          font: {size: 9, weight: 'bold'}, formatter: value => formatCompactVND(value)
        }
      }
    }
  });

  const ctxTrends = document.getElementById('chartMonthTrends').getContext('2d');
  const maxAmount = Math.max(...d.monthTrends.map(m => m.amount), 0);
  const customYMax = maxAmount + 4000000; 

  chartTrendsInstance = upsertChart('chartMonthTrends', chartTrendsInstance, {
    plugins: [ChartDataLabels],
    data: {
      labels: d.monthTrends.map(m => m.month),
      datasets: [
        {
          type: 'line',
          label: '% Tăng/Giảm',
          data: d.monthTrends.map(m => m.changePct),
          borderColor: '#dc3545',
          backgroundColor: '#dc3545',
          pointRadius: 4,
          borderWidth: 2,
          tension: 0.1,
          yAxisID: 'y1',
          order: 1,
          datalabels: {
            display: true, align: 'top', anchor: 'center', color: '#dc3545', offset: 4, font: { weight: 'bold', size: 9 },
            formatter: (val, ctx) => {
              const rawStr = d.monthTrends[ctx.dataIndex]?.changeStr;
              return rawStr ? rawStr : (val > 0 ? '+' : '') + val.toFixed(1) + '%';
            }
          }
        },
        {
          type: 'bar',
          label: 'Số Tiền Chi (VNĐ)',
          data: d.monthTrends.map(m => m.amount),
          backgroundColor: '#198754',
          borderRadius: 6,
          yAxisID: 'y',
          order: 2,
          datalabels: {
            display: (ctx) => ctx.dataIndex === d.monthTrends.length - 1,
            align: 'top', anchor: 'end', color: '#198754', font: { weight: 'bold', size: 9 },
            formatter: (val) => formatVND(val)
          }
        }
      ]
    },
    options: {
      responsive: true,
      layout: { padding: { top: 20, right: 10, left: 5 } },
      scales: {
        y: { type: 'linear', display: true, position: 'left', max: customYMax, title: { display: true, text: 'Số tiền (VNĐ)', font: { size: 9 } } },
        y1: { type: 'linear', display: true, position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: '% Tăng giảm', font: { size: 9 } }, ticks: { callback: value => value + '%' } }
      }
    }
  });

  const ctxPayment = document.getElementById('chartPaymentMethods').getContext('2d');
  const totalPaymentAmt = d.paymentData.list.reduce((sum, item) => sum + item.amount, 0);

  chartPaymentInstance = upsertChart('chartPaymentMethods', chartPaymentInstance, {
    type: 'doughnut',
    data: {
      labels: d.paymentData.list.map(p => {
        const pct = totalPaymentAmt > 0 ? ((p.amount / totalPaymentAmt) * 100).toFixed(1) : 0;
        return `${p.method} (${pct}%)`;
      }),
      datasets: [{ data: d.paymentData.list.map(p => p.amount), backgroundColor: ['#198754', '#6c757d', '#6f42c1'] }]
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } } }
  });

  const ctxTarget = document.getElementById('chartTargetData').getContext('2d');
  chartTargetInstance = upsertChart('chartTargetData', chartTargetInstance, {
    type: 'bar',
    data: {
      labels: d.targetData.list.map(t => t.target),
      datasets: [
        { label: d.targetData.months[0] || 'Tháng này', data: d.targetData.list.map(t => t.m1Amt), backgroundColor: '#198754', borderRadius: 4 },
        { label: d.targetData.months[1] || 'Tháng trước', data: d.targetData.list.map(t => t.m2Amt), backgroundColor: '#20c997', borderRadius: 4 },
        { label: d.targetData.months[2] || 'Tháng cũ', data: d.targetData.list.map(t => t.m3Amt), backgroundColor: '#0dcaf0', borderRadius: 4 }
      ]
    },
    options: { responsive: true, plugins: { legend: { position: 'top', labels: { boxWidth: 12, font: { size: 10 } } } } }
  });

  const ctxDaily = document.getElementById('chartDailyList').getContext('2d');
  const dailyList = d.dailyData.list || [];
  const validDailyAmts = dailyList.map(i => i.amount).filter(a => a > 0);
  const avgDailyAmt = validDailyAmts.length > 0 ? Math.round(validDailyAmts.reduce((sum, v) => sum + v, 0) / validDailyAmts.length) : 0;
  const avgFormatted = avgDailyAmt.toLocaleString('vi-VN') + ' đ';
  const shortDateLabels = dailyList.map(i => {
    if (!i.date) return '';
    const parts = i.date.split('/');
    return parts.length >= 2 ? `${parts[0].padStart(2,'0')}/${parts[1].padStart(2,'0')}` : i.date;
  });

  chartDailyInstance = upsertChart('chartDailyList', chartDailyInstance, {
    data: {
      labels: shortDateLabels,
      datasets: [
        { type: 'line', label: `TB tháng: ${avgFormatted}`, data: dailyList.map(() => avgDailyAmt), borderColor: '#fd7e14', borderWidth: 2, borderDash: [5, 5], pointRadius: 0, fill: false, order: 1 },
        { type: 'line', label: 'Số tiền chi', data: dailyList.map(i => i.amount), borderColor: '#198754', backgroundColor: 'rgba(25, 135, 84, 0.1)', fill: true, tension: 0.3, order: 2 }
      ]
    },
    options: { responsive: true, plugins: { legend: { display: true, position: 'top', labels: { boxWidth: 15, font: { size: 10, weight: 'bold' } } } } }
  });
}

function applyCashFilters() {
  cashFilterSeq++;
  cacheRemove('cashDashboard');
  document.getElementById('loadingCashDash').style.display = 'block';
  setSyncStatus('Đang cập nhật bộ lọc dòng tiền…');
  queueCashFilters({
    startDate:document.getElementById('cashFilterStart').value,
    endDate:document.getElementById('cashFilterEnd').value,
    paymentMonth:document.getElementById('cashPaymentMonth').value,
    ratioMonth:document.getElementById('cashRatioMonth').value,
    ...currentBusinessFilter()
  });
}

function currentBusinessFilter() {
  const value = document.getElementById('cashBusinessMonth')?.value;
  return value ? {businessMonth: value} : {};
}

function applyBusinessMonthFilter() {
  cashFilterSeq++;
  cacheRemove('cashDashboard');
  document.getElementById('loadingCashDash').style.display = 'block';
  setSyncStatus('Đang cập nhật báo cáo kinh doanh…');
  queueCashFilters({
    startDate:document.getElementById('cashFilterStart').value,
    endDate:document.getElementById('cashFilterEnd').value,
    paymentMonth:document.getElementById('cashPaymentMonth').value,
    ratioMonth:document.getElementById('cashRatioMonth').value,
    ...currentBusinessFilter()
  });
}

function convertDisplayToInputDate(dStr) {
  if (!dStr) return '';
  const parts = dStr.split('/');
  return parts.length === 3 ? `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}` : dStr;
}

function loadRecentTransactions(forceFetch = false) { return loadRecentFor('spending', forceFetch); }

function renderTxList(list) {
  const txList = document.getElementById('txList');
  if (!txList) return;
  if (!Array.isArray(list)) {
    txList.innerHTML = '<p class="text-center text-danger m-0 py-2 small">Không tải được lịch sử giao dịch. Hãy bấm Làm mới.</p>';
    return;
  }
  if (list.length === 0) {
    txList.innerHTML = '<p class="text-center text-muted m-0 py-2 small">Chưa có giao dịch thẻ.</p>';
    return;
  }

  txList.innerHTML = '<div class="list-group list-group-flush">' + list.map(item => {
    const amt = Number(item.amount || 0);
    const isPay = amt < 0;
    const dateFormatted = formatDate(item.date);
    const amtFormatted = Math.abs(amt).toLocaleString('vi-VN');
    const merchBadge = item.merchant ? `<span class="badge bg-light text-dark border ms-1">${escapeHTML(item.merchant)}</span>` : '';
    const targetBadge = (item.target && item.target.trim()) ? `<span class="badge bg-info-subtle text-info border border-info ms-1">${escapeHTML(item.target)}</span>` : '';

    return `
      <div class="tx-item d-flex justify-content-between align-items-center py-2 border-bottom">
        <div>
          <div class="fw-bold small">${dateFormatted} - <span class="text-primary">${escapeHTML(item.card)}</span></div>
          <div class="text-dark small">${escapeHTML(item.category || 'Chưa phân loại')} ${merchBadge} ${targetBadge}</div>
          <div class="${isPay ? 'text-success fw-bold' : 'amount-text'} small">${isPay ? '-' : ''}${amtFormatted} đ</div>
        </div>
        <button class="btn btn-outline-danger btn-sm py-0 px-2" type="button" onclick="confirmDelete('spending', ${item.rowIndex}, ${inlineArg(dateFormatted)}, ${inlineArg(item.card)}, ${inlineArg(amtFormatted)})"><i class="bi bi-trash"></i></button>
      </div>`;
  }).join('') + '</div>';
}

function confirmDelete(type, rowIndex, date, card, amount) {
  return deleteRowFromUI('spending', rowIndex, `- Ngày: ${date}\n- Thẻ: ${card}\n- Số tiền: ${amount} đ`);
}

async function fetchRecommendation() {
  const kwInput = document.getElementById('recommendInput');
  if (!kwInput) return;
  const kw = kwInput.value.trim();
  if (!kw) return;

  if (document.activeElement) document.activeElement.blur();

  const recModalEl = document.getElementById('recommendModal');
  if (!recModalEl) return;
  const epoch = authEpoch, sequence = ++recommendationSeq;
  try { await ensureBootstrapModal(); }
  catch (error) { setSyncStatus(error.message, 'error'); return; }
  if (epoch !== authEpoch || sequence !== recommendationSeq) return;
  const recModal = bootstrap.Modal.getOrCreateInstance(recModalEl);

  document.getElementById('loadingRecModal').style.display = 'block';
  document.getElementById('cardRecommendList').innerHTML = '';
  document.getElementById('resMainCat').innerText = 'Đang tra cứu...';
  document.getElementById('resSubCat').innerText = 'Đang tra cứu...';

  recModal.show();

  const data = await sendRequest("getCardRecommendation", { keyword: kw });
  if (epoch !== authEpoch || sequence !== recommendationSeq) return;
  document.getElementById('loadingRecModal').style.display = 'none';

  if (data) {
    document.getElementById('resMainCat').innerText = data.category?.main || "Chưa xác định";
    document.getElementById('resSubCat').innerText = data.category?.sub || "Chưa xác định";

    const listContainer = document.getElementById('cardRecommendList');
    listContainer.innerHTML = '';

    if (!data.cards || data.cards.length === 0) {
      listContainer.innerHTML = '<p class="text-center text-muted py-3 small m-0">Không tìm thấy thẻ có ưu đãi phù hợp.</p>';
      return;
    }

    listContainer.innerHTML = data.cards.map(item => {
      return `
        <div class="recommend-card mb-2 p-2 border-start border-4 border-primary bg-light rounded shadow-sm">
          <div class="d-flex justify-content-between align-items-center mb-1">
            <span class="fw-bold text-dark small">${escapeHTML(item.cardName)}</span>
            <span class="rate-badge">${escapeHTML(item.rate)}</span>
          </div>
          <div class="text-muted small" style="font-size: 0.75rem;">
            <div>• <strong>Kiểu áp dụng:</strong> ${escapeHTML(item.applyType)}</div>
            <div>• <strong>Hoàn max/danh mục:</strong> ${escapeHTML(item.maxCat)} | <strong>Max/kỳ:</strong> ${escapeHTML(item.maxCycle)}</div>
            ${item.minSpend ? `<div>• <strong>Chi tối thiểu:</strong> ${escapeHTML(item.minSpend)}</div>` : ''}
          </div>
        </div>`;
    }).join('');
  }
}    

async function loadDashboard(fetchServer = false) {
  if (bootstrapPromise) return bootstrapPromise;
  const cached = cacheRead('cardView', isCardViewShape);
  if (cached) {
    renderCardView(cached.data);
    if (!fetchServer && Date.now()-cached.savedAt < CACHE_TTL) {
      document.getElementById('loadingDash').style.display = 'none';
      freshStatus(cached.savedAt);
      return;
    }
    setSyncStatus(cachedStatus(cached.savedAt));
  } else setSyncStatus('Đang tải dashboard thẻ…');
  document.getElementById('loadingDash').style.display = cached ? 'none' : 'block';
  const epoch = authEpoch, revision = dataEpoch, seq = cardFilterSeq;
  const result = await sendRequest(fetchServer ? 'getBootstrap' : 'getCardView',
    fetchServer ? {force:true, refreshInitial:true} : {}, {retries: 2});
  if (epoch !== authEpoch || revision !== dataEpoch || seq !== cardFilterSeq) return;
  document.getElementById('loadingDash').style.display = 'none';
  if (!result) return;
  const view = fetchServer ? result.cardView : result;
  if (result.initialData && isInitialDataShape(result.initialData)) {
    cacheWrite('initial', result.initialData);
    applyInitialData(result.initialData);
  }
  if (result.cashDashboard && isCashDashboardShape(result.cashDashboard)) {
    cacheWrite('cashDashboard', result.cashDashboard, result.cashDashboard.updatedAt);
  }
  if (!isCardViewShape(view)) {
    cacheRemove('cardView');
    setSyncStatus('Phản hồi dashboard không hợp lệ. Hãy bấm Làm mới.', 'error');
    return;
  }
  cacheWrite('cardView', view, view.updatedAt);
  renderCardView(view);
  freshStatus(view.updatedAt);
}

function renderDashboard(data) {
  document.getElementById('kpiNotDue').innerText = formatVND(data.kpi.notDue);
  document.getElementById('kpiComingDue').innerText = formatVND(data.kpi.comingDue);
  document.getElementById('kpiUnstatement').innerText = formatVND(data.kpi.unstatement);

  if (data.statements) {
    currentStatementsData = data.statements;
    filterStatementList();
  }
  if (data.filters) {
    document.getElementById('dashFilterCard').value = data.filters.card;
    document.getElementById('dashFilterCategory').value = data.filters.category;
    document.getElementById('dashFilterStatus').value = data.filters.status;
  }
}

function filterStatementList() {
  const selectedStatus = document.getElementById('stmtFilterStatus').value;
  const stmtList = document.getElementById('stmtList');
  stmtList.innerHTML = '';

  if (!currentStatementsData || currentStatementsData.length === 0) {
    stmtList.innerHTML = '<p class="text-center text-muted m-0 py-2">Không có dữ liệu sao kê.</p>'; return;
  }

  const filtered = currentStatementsData.filter(st => {
    if (!st.card || st.card === "Thẻ" || st.card === "THẺ") return false;
    return !selectedStatus || st.status === selectedStatus;
  });

  if (filtered.length === 0) {
    stmtList.innerHTML = '<p class="text-center text-muted m-0 py-2">Không có thẻ nào thuộc trạng thái này.</p>'; return;
  }

  stmtList.innerHTML = filtered.map(st => {
    let statusBadge = '';
    if (st.status === 'UPDATING') statusBadge = `<span class="badge bg-warning text-dark stmt-badge"><div class="spinner-border spinner-border-sm me-1" style="width:0.6rem;height:0.6rem;"></div> Đang cập nhật...</span>`;
    else if (st.status === 'Chưa TT') statusBadge = `<span class="badge bg-danger stmt-badge btn-pay-now" onclick="quickPay(${inlineArg(st.card)}, ${Number(st.remainingAmount) || 0})" title="Bấm để trả ngay"><i class="bi bi-credit-card"></i> Chưa TT</span>`;
    else if (st.status === 'Đã TT') statusBadge = `<span class="badge bg-success stmt-badge">Đã TT</span>`;
    else statusBadge = `<span class="badge bg-secondary stmt-badge">${escapeHTML(st.status)}</span>`;

    return `
      <div class="list-group-item px-1 py-2 ${st.status === 'Chưa TT' ? 'highlight-row' : ''}">
        <div class="d-flex justify-content-between align-items-center">
          <div class="card-title-box"><span class="card-name-text" title="${escapeHTML(st.card)}">${escapeHTML(st.card)}</span>${statusBadge}</div>
          <span class="amount-text">${formatVND(st.remainingAmount)}</span>
        </div>
        <div class="text-muted text-truncate" style="font-size: 0.75rem;">
          Kỳ ${escapeHTML(st.cycle)} (${escapeHTML(st.fromDate)} - ${escapeHTML(st.toDate)}) | Hạn: <span class="fw-bold text-dark">${escapeHTML(st.dueDate)}</span>
        </div>
      </div>`;
  }).join('');
}

function applyCategoryFilter() {
  cardFilterSeq++;
  cacheRemove('cardView');
  document.getElementById('loadingReport').style.display = 'block';
  setSyncStatus('Đang lọc chi tiêu thẻ…');
  queueCardFilters({card:document.getElementById('dashFilterCard').value,
    category:document.getElementById('dashFilterCategory').value,
    status:document.getElementById('dashFilterStatus').value});
}

function cleanAmountInput(input) {
  const catVal = document.getElementById('categoryInput').value.trim();
  let raw = input.value.replace(/[^0-9]/g, '');
  if (!raw) { input.value = ''; return; }
  if (catVal.toUpperCase().startsWith("TTT_")) {
    input.value = '-' + raw;
  } else {
    input.value = raw;
  }
}
const formatVND = (val) => typeof val === 'number' ? val.toLocaleString('vi-VN') + ' đ' : val;
function formatCompactVND(value) {
  const number = Number(value) || 0;
  const abs = Math.abs(number);
  if (abs >= 1e9) return `${(number / 1e9).toFixed(abs >= 1e10 ? 0 : 1)} tỷ`;
  if (abs >= 1e6) return `${(number / 1e6).toFixed(abs >= 1e7 ? 0 : 1)} tr`;
  if (abs >= 1e3) return `${(number / 1e3).toFixed(abs >= 1e5 ? 0 : 1)}k`;
  return number.toLocaleString('vi-VN');
}

async function handleFormSubmit(event, form) {
  event.preventDefault();
  const btn = document.getElementById('btnSubmit');
  if (btn.disabled) return;
  const formObject = Object.fromEntries(new FormData(form).entries());
  const payloadKey = JSON.stringify(formObject);
  if (form.dataset.pendingPayload !== payloadKey) {
    form.dataset.pendingPayload = payloadKey;
    form.dataset.requestId = makeRequestId();
  }
  savePendingMutation({requestId:form.dataset.requestId, type:'spending', operation:'save', formObject});
  btn.disabled = true;
  btn.innerText = 'Đang lưu…';
  try {
    let result = await sendRequest('mutateTransaction', {operation:'save', formObject, requestId:form.dataset.requestId, includeTransactions:false});
    if (!result) result = await reconcileMutation(form.dataset.requestId);
    if (!result) return;
    clearPendingMutation(form.dataset.requestId);
    acceptMutation(result);
    showAlert(result.message, 'success');
    form.reset();
    delete form.dataset.pendingPayload;
    delete form.dataset.requestId;
    setTodayDefaultDates();
    handleCategoryChange();
  } finally { btn.disabled = false; btn.innerText = 'Lưu Giao Dịch SPENDING_PAYMENTS'; }
}

function showAlert(msg, type) {
  const alert = document.getElementById('alertMsg');
  if (!alert) return;

  alert.className = `alert alert-${type} mb-3 py-2 px-3 small fw-bold shadow-sm border`;
  alert.innerHTML = (type === 'danger' || type === 'warning') 
    ? `<i class="bi bi-exclamation-triangle-fill me-1"></i> ${escapeHTML(msg)}`
    : `<i class="bi bi-check-circle-fill me-1"></i> ${escapeHTML(msg)}`;
  alert.style.display = 'block';

  if (window.alertTimer) clearTimeout(window.alertTimer);
  window.alertTimer = setTimeout(() => { alert.style.display = 'none'; }, 3000);
}

let silenceTimer = null;

/* KÍCH HOẠT MIC LẮNG NGHE GIỌNG NÓI */
function startVoiceRecognition(forcedMode = null) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) { alert("Trình duyệt không hỗ trợ nhận diện giọng nói!"); return; }

  if (isProcessingVoice) return;

  if (recognitionInstance) {
    resetVoiceUI();
    return;
  }

  const recognition = new SpeechRecognition();
  recognitionInstance = recognition;
  recognition.lang = 'vi-VN';
  recognition.interimResults = true;
  recognition.continuous = false;

  const currentMode = forcedMode ? forcedMode : (document.getElementById('entryType').value || 'spending');
  const isCashMode = (currentMode === 'cash_spending');
  const isRec = (currentMode === 'recommend');

  let btnVoice, micIcon, statusText, liveBox, liveText;

  if (isCashMode) {
    btnVoice = document.getElementById('btnVoiceCash');
    micIcon = document.getElementById('micIconCash');
    statusText = document.getElementById('voiceStatusTextCash');
    liveBox = document.getElementById('liveSpeechBoxCash');
    liveText = document.getElementById('liveSpeechTextCash');
  } else if (isRec) {
    btnVoice = document.getElementById('btnVoiceRec');
    micIcon = document.getElementById('micIconRec');
    liveBox = document.getElementById('liveSpeechBoxRec');
    liveText = document.getElementById('liveSpeechTextRec');
  } else {
    btnVoice = document.getElementById('btnVoice');
    micIcon = document.getElementById('micIcon');
    statusText = document.getElementById('voiceStatusText');
    liveBox = document.getElementById('liveSpeechBox');
    liveText = document.getElementById('liveSpeechText');
  }

  if (isRec) {
    btnVoice.className = "btn btn-mic-listening py-0 px-2 text-dark";
    micIcon.className = "bi bi-soundwave mic-pulse-icon";
  } else {
    btnVoice.className = "btn btn-mic-listening rounded-circle p-3 shadow mb-2 d-flex align-items-center justify-content-center";
    micIcon.className = "bi bi-soundwave fs-3 mic-pulse-icon text-dark";
    if (statusText) statusText.innerHTML = `<span class="fw-bold" style="color:#d97706;">🎙️ Đang nghe giọng nói...</span>`;
  }

  liveBox.classList.remove('hidden');
  liveText.innerText = "Đang lắng nghe...";

  let lastText = '';

  recognition.onresult = (event) => {
    let interimTranscript = '';
    let finalTranscript = '';

    for (let i = event.resultIndex; i < event.results.length; i++) {
      if (event.results[i].isFinal) finalTranscript += event.results[i][0].transcript;
      else interimTranscript += event.results[i][0].transcript;
    }

    const displayText = finalTranscript || interimTranscript;
    if (displayText) {
      lastText = displayText;
      liveText.innerText = displayText;
    }

    if (silenceTimer) clearTimeout(silenceTimer);
    silenceTimer = setTimeout(() => {
      if (recognitionInstance && !isProcessingVoice) {
        isProcessingVoice = true;
        try { recognition.stop(); } catch(e){}
        processParsedVoiceText(lastText || liveText.innerText, currentMode);
      }
    }, 1200);

    if (event.results[0].isFinal && !isProcessingVoice) {
      if (silenceTimer) clearTimeout(silenceTimer);
      isProcessingVoice = true;
      try { recognition.stop(); } catch(e){}
      processParsedVoiceText(finalTranscript || displayText, currentMode);
    }
  };

  recognition.onspeechend = () => {
    if (silenceTimer) clearTimeout(silenceTimer);
    if (!isProcessingVoice) {
      const textToProcess = lastText || liveText.innerText;
      if (textToProcess && textToProcess !== "Đang lắng nghe...") {
        isProcessingVoice = true;
        processParsedVoiceText(textToProcess, currentMode);
      } else resetVoiceUI();
    }
  };

  recognition.onerror = (event) => {
    if (silenceTimer) clearTimeout(silenceTimer);
    resetVoiceUI();
    if (event.error !== 'no-speech') alert("Không nhận diện được giọng nói, vui lòng thử lại!");
  };

  try { recognition.start(); } catch(err) { resetVoiceUI(); }
}

/* XỬ LÝ AI BÓC TÁCH GIỌNG NÓI */
async function processParsedVoiceText(transcript, mode) {
  if (!transcript || transcript === "Đang lắng nghe...") { resetVoiceUI(); return; }

  const isCashMode = (mode === 'cash_spending');
  const isRec = (mode === 'recommend');

  const aiAnimationBlueHTML = `
    <div class="d-inline-flex align-items-center gap-1 me-1 wave-blue">
      <i class="bi bi-stars ai-sparkle-icon sparkle-blue"></i>
      <div class="ai-wave-container mx-1">
        <div class="ai-wave-bar"></div><div class="ai-wave-bar"></div><div class="ai-wave-bar"></div><div class="ai-wave-bar"></div><div class="ai-wave-bar"></div>
      </div>
    </div>`;

  const aiAnimationGreenHTML = `
    <div class="d-inline-flex align-items-center gap-1 me-1 wave-green">
      <i class="bi bi-stars ai-sparkle-icon sparkle-green"></i>
      <div class="ai-wave-container mx-1">
        <div class="ai-wave-bar"></div><div class="ai-wave-bar"></div><div class="ai-wave-bar"></div><div class="ai-wave-bar"></div><div class="ai-wave-bar"></div>
      </div>
    </div>`;

  if (isRec) {
    const btnVoiceRec = document.getElementById('btnVoiceRec');
    const micIconRec = document.getElementById('micIconRec');
    const liveBoxRec = document.getElementById('liveSpeechBoxRec');
    const liveTextRec = document.getElementById('liveSpeechTextRec');

    if (btnVoiceRec) btnVoiceRec.className = "btn btn-primary py-0 px-2";
    if (micIconRec) micIconRec.className = "bi bi-stars ai-sparkle-icon sparkle-blue";
    if (liveBoxRec && liveTextRec) {
      liveBoxRec.classList.remove('hidden');
      liveTextRec.innerText = transcript;
    }
  } else if (isCashMode) {
    const btnVoiceCash = document.getElementById('btnVoiceCash');
    const micIconCash = document.getElementById('micIconCash');
    const liveBoxCash = document.getElementById('liveSpeechBoxCash');
    const liveTextCash = document.getElementById('liveSpeechTextCash');
    const statusTextCash = document.getElementById('voiceStatusTextCash');

    if (btnVoiceCash) btnVoiceCash.className = "btn btn-success rounded-circle p-3 shadow mb-2 text-white d-flex align-items-center justify-content-center";
    if (micIconCash) micIconCash.className = "bi bi-stars fs-3 ai-sparkle-icon sparkle-green text-white";
    if (liveBoxCash && liveTextCash) {
      liveBoxCash.classList.remove('hidden');
      liveTextCash.innerText = transcript;
    }
    if (statusTextCash) statusTextCash.innerHTML = `${aiAnimationGreenHTML} <span class="text-success fw-bold">AI đang suy nghĩ...</span>`;
  } else {
    const btnVoice = document.getElementById('btnVoice');
    const micIcon = document.getElementById('micIcon');
    const liveBox = document.getElementById('liveSpeechBox');
    const liveText = document.getElementById('liveSpeechText');
    const statusText = document.getElementById('voiceStatusText');

    if (btnVoice) btnVoice.className = "btn btn-primary rounded-circle p-3 shadow mb-2 text-white d-flex align-items-center justify-content-center";
    if (micIcon) micIcon.className = "bi bi-stars fs-3 ai-sparkle-icon sparkle-blue text-white";
    if (liveBox && liveText) {
      liveBox.classList.remove('hidden');
      liveText.innerText = transcript;
    }
    if (statusText) statusText.innerHTML = `${aiAnimationBlueHTML} <span class="text-primary fw-bold">AI đang suy nghĩ...</span>`;
  }

  if (isRec) {
    const keywordClean = transcript.replace(/(hôm nay|mua|sắm|ở|tại|bằng|dùng|thẻ|cho|tôi|tìm)/gi, '').trim();
    const finalKw = keywordClean || transcript.trim();
    document.getElementById('recommendInput').value = finalKw;
    resetVoiceUI();
    fetchRecommendation();
    return;
  }

  try {
    const res = await sendRequest("parseVoiceInput", { text: transcript, mode });

    if (isCashMode) {
      if (res && res.success) {
        document.getElementById('cashAmount').value = res.amount;
        document.getElementById('cashCategory').value = res.category || "";
        document.getElementById('cashMerchantInput').value = res.merchant || "";

        const targetSelect = document.getElementById('cashTarget');
        targetSelect.value = ""; 
        validateDTAmount();

        if (res.amount > 0 && res.target) {
          targetSelect.value = res.target;
        }

        if (res.method === "Chuyển Khoản") document.getElementById('mBank').checked = true;
else document.getElementById('mCash').checked = true; // Mặc định về Tiền Mặt nếu không phải Chuyển Khoản

        showAlertCash(`AI đã điền: "${res.merchant ? res.merchant + ' - ' : ''}${res.category}" (${res.amount.toLocaleString('vi-VN')} đ)`, "success");
      } else {
        showAlertCash(`⚠️ ${(res && res.message) || 'Không bóc tách được dữ liệu!'}`, "danger");
      }
      return;
    }

    if (!res || res.success === false) {
      showAlert(`⚠️ ${(res && res.message) || 'Không thể bóc tách dữ liệu!'}`, "danger");
      return;
    }

    document.getElementById('card').value = res.card || "";
    document.getElementById('amount').value = res.amount || "";
    document.getElementById('merchantInput').value = res.merchant || "";
    document.getElementById('categoryInput').value = res.category || "";

    const cardTargetSelect = document.getElementById('cardTarget');
    if (cardTargetSelect) {
      cardTargetSelect.value = res.target || "";
    }
    handleCategoryChange();
    showAlert(`AI đã tự động phân tích: Thẻ "${res.card}" | Merchant "${res.merchant}" | DM "${res.category}"`, "success");

  } catch (err) {
    alert("Lỗi xử lý kết nối giọng nói!");
  } finally {
    resetVoiceUI();
  }
}

function resetVoiceUI() {
  isProcessingVoice = false;
  if (typeof silenceTimer !== 'undefined' && silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; }

  if (recognitionInstance) {
    try { 
      recognitionInstance.onresult = null;
      recognitionInstance.onerror = null;
      recognitionInstance.onspeechend = null;
      recognitionInstance.abort(); 
    } catch(e){}
    recognitionInstance = null;
  }

  const btnVoice = document.getElementById('btnVoice');
  const micIcon = document.getElementById('micIcon');
  const statusText = document.getElementById('voiceStatusText');
  const liveBox = document.getElementById('liveSpeechBox');

  if (btnVoice) btnVoice.className = "btn btn-primary rounded-circle p-3 shadow-sm d-flex align-items-center justify-content-center";
  if (micIcon) micIcon.className = "bi bi-mic-fill fs-4";
  if (statusText) statusText.innerText = "Bấm nút để nói thông tin giao dịch / thanh toán";
  if (liveBox) liveBox.classList.add('hidden');

  const btnVoiceCash = document.getElementById('btnVoiceCash');
  const micIconCash = document.getElementById('micIconCash');
  const statusTextCash = document.getElementById('voiceStatusTextCash');
  const liveBoxCash = document.getElementById('liveSpeechBoxCash');

  if (btnVoiceCash) btnVoiceCash.className = "btn btn-success rounded-circle p-3 shadow-sm d-flex align-items-center justify-content-center";
  if (micIconCash) micIconCash.className = "bi bi-mic-fill fs-4";
  if (statusTextCash) statusTextCash.innerText = "Bấm nút để nói thông tin Thu / Chi";
  if (liveBoxCash) liveBoxCash.classList.add('hidden');

  const btnVoiceRec = document.getElementById('btnVoiceRec');
  const micIconRec = document.getElementById('micIconRec');
  const liveBoxRec = document.getElementById('liveSpeechBoxRec');

  if (btnVoiceRec) btnVoiceRec.className = "btn btn-outline-primary py-0 px-2";
  if (micIconRec) micIconRec.className = "bi bi-mic-fill";
  if (liveBoxRec) liveBoxRec.classList.add('hidden');
}

const formatDate = (str) => {
  if (!str) return '';
  const clean = str.toString().replace("'", "").trim();
  const p = clean.includes('/') ? clean.split('/') : clean.split('-');
  if (p.length !== 3) return clean;
  if (clean.includes('-')) return `${p[2].padStart(2,'0')}/${p[1].padStart(2,'0')}/${p[0]}`;
  return `${p[0].padStart(2,'0')}/${p[1].padStart(2,'0')}/${p[2]}`;
};

function makeRequestId() { return window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`; }

async function loadRecentFor(type, force) {
  const cash = type === 'cash_spending';
  const key = cash ? 'cashTransactions' : 'cardTransactions';
  const spinner = document.getElementById(cash ? 'loadingTxCash' : 'loadingTx');
  const render = list => {
    if (cash) { recentCashData = list; renderRecentCashListUI(list); }
    else { recentCardData = list; renderTxList(list); }
  };
  const cached = cacheRead(key, isTransactionListShape);
  if (cached) {
    render(cached.data);
    if (!force && Date.now()-cached.savedAt < CACHE_TTL) { spinner.style.display = 'none'; freshStatus(cached.savedAt); return; }
    setSyncStatus(cachedStatus(cached.savedAt));
  } else setSyncStatus('Đang tải lịch sử giao dịch…');
  spinner.style.display = cached ? 'none' : 'block';
  const epoch = authEpoch, revision = dataEpoch;
  let list = await sendRequest('getRecentTransactions', {type, force:force === true});
  if (epoch !== authEpoch || revision !== dataEpoch) return;
  spinner.style.display = 'none';
  if (!isTransactionListShape(list)) {
    // Do not let an error envelope or a redirect body reach renderTxList().
    cacheRemove(key);
    list = await sendRequest('getRecentTransactions', {type, force:true, repair:makeRequestId()}, {retries: 1});
  }
  if (epoch !== authEpoch || revision !== dataEpoch) return;
  if (!isTransactionListShape(list)) {
    setSyncStatus('Không tải được lịch sử giao dịch. Hãy bấm Làm mới.', 'error');
    return;
  }
  cacheWrite(key, list);
  render(list);
  freshStatus();
}

function acceptMutation(result) {
  if (!result || typeof result !== 'object' || !result.type) {
    setSyncStatus('Đã ghi thay đổi nhưng phản hồi không đầy đủ. Hãy bấm Làm mới.', 'error');
    return;
  }
  invalidateFinancialCaches();
  const cash = result.type === 'cash_spending';
  if (isTransactionListShape(result.transactions)) {
    cacheWrite(cash ? 'cashTransactions' : 'cardTransactions', result.transactions);
    if (cash) { recentCashData = result.transactions; renderRecentCashListUI(result.transactions); }
    else { recentCardData = result.transactions; renderTxList(result.transactions); }
  }
  document.getElementById('loadingTx').style.display = 'none';
  document.getElementById('loadingTxCash').style.display = 'none';
  if (result.refreshError) setSyncStatus('Đã lưu thay đổi; chưa tải lại được lịch sử. Hãy bấm Làm mới.', 'error');
  else setSyncStatus('Đã lưu thay đổi · Dashboard sẽ cập nhật khi mở.', 'ready');
  // A user may have switched screens while the write was pending.
  if (cashDashboardVisible()) loadCashDashboard(true);
  else if (!currentCashMode() && document.getElementById('dashboardBlock').style.display !== 'none') loadDashboard(true);
  else if (cash) loadRecentCashTransactions(true);
  else loadRecentTransactions(true);
}

async function deleteRowFromUI(type, rowIndex, detail) {
  const key = type + ':' + rowIndex;
  if (deletingRows.has(key)) return;
  const list = type === 'cash_spending' ? recentCashData : recentCardData;
  const item = list.find(row => row.rowIndex === rowIndex);
  if (!item) { await loadRecentFor(type, true); return; }
  if (!confirm('Bạn có chắc muốn XÓA giao dịch này?\n\n' + detail)) return;
  deletingRows.add(key);
  const spinner = document.getElementById(type === 'cash_spending' ? 'loadingTxCash' : 'loadingTx');
  spinner.style.display = 'block';
  const requestId = makeRequestId();
  savePendingMutation({requestId, type, operation:'delete', rowIndex, fingerprint:item.fingerprint});
  try {
    const result = await sendRequest('mutateTransaction', {operation:'delete', type, rowIndex,
      fingerprint:item.fingerprint, requestId, includeTransactions:false});
    const confirmed = result || await reconcileMutation(requestId, type === 'cash_spending' ? 'cash' : undefined);
    if (confirmed) {
      clearPendingMutation(requestId);
      acceptMutation(confirmed);
      (type === 'cash_spending' ? showAlertCash : showAlert)(confirmed.message, 'success');
    }
  } finally { deletingRows.delete(key); spinner.style.display = 'none'; }
}

// Debounce quick input, then serialize writes so an older filter cannot win.
function coalescedFilter(action, onResult, spinnerId) {
  let timer, pending = null, running = false, version = 0;
  async function flush() {
    if (running || !pending) return;
    running = true;
    const job = pending;
    pending = null;
    try {
      if (job.epoch !== authEpoch) return;
      const result = await sendRequest(action, {filterObj:job.filters});
      if (job.epoch === authEpoch && job.version === version && job.revision === dataEpoch) {
        document.getElementById(spinnerId).style.display = 'none';
        if (result) { onResult(result); freshStatus(result.updatedAt); }
      }
    } finally {
      running = false;
      if (pending) { clearTimeout(timer); timer = setTimeout(flush, 250); }
    }
  }
  return filters => {
    pending = {filters, epoch:authEpoch, revision:dataEpoch, version:++version};
    clearTimeout(timer);
    timer = setTimeout(flush, 250);
  };
}
const queueCardFilters = coalescedFilter('updateCardFilters', view => {
  cacheWrite('cardView', view, view.updatedAt);
  renderCardView(view);
}, 'loadingReport');
const queueCashFilters = coalescedFilter('updateCashDashboardFilters', data => {
  cacheWrite('cashDashboard', data, data.updatedAt);
  document.getElementById('cashDashContent').style.display = 'block';
  renderCashDashboard(data);
}, 'loadingCashDash');

function loadExternalScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const timeout = setTimeout(() => { script.remove(); reject(new Error('Tải thư viện biểu đồ quá lâu.')); }, 20000);
    script.src = src;
    script.async = true;
    script.onload = () => { clearTimeout(timeout); resolve(); };
    script.onerror = () => { clearTimeout(timeout); script.remove(); reject(new Error('Không tải được thư viện biểu đồ.')); };
    document.head.appendChild(script);
  });
}
function ensureCashCharts() {
  if (window.Chart && window.ChartDataLabels) return Promise.resolve();
  if (!chartLibrariesPromise) {
    chartLibrariesPromise = (async () => {
      if (!window.Chart) await loadExternalScript('https://cdn.jsdelivr.net/npm/chart.js@4.4.8/dist/chart.umd.min.js');
      if (!window.ChartDataLabels) await loadExternalScript('https://cdn.jsdelivr.net/npm/chartjs-plugin-datalabels@2.2.0');
    })().catch(error => { chartLibrariesPromise = null; throw error; });
  }
  return chartLibrariesPromise;
}
function ensureBootstrapModal() {
  if (window.bootstrap?.Modal) return Promise.resolve();
  if (!modalLibraryPromise) {
    modalLibraryPromise = loadExternalScript('https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js')
      .catch(error => { modalLibraryPromise = null; throw error; });
  }
  return modalLibraryPromise;
}
async function drawCashChartsWhenReady() {
  if (!cashDashboardVisible() || !pendingCashChartData) return;
  const epoch = authEpoch;
  try {
    await ensureCashCharts();
    if (epoch !== authEpoch || !cashDashboardVisible() || !pendingCashChartData) return;
    const data = pendingCashChartData;
    requestAnimationFrame(() => {
      if (epoch === authEpoch && cashDashboardVisible() && pendingCashChartData === data) renderCashCharts(data);
    });
  } catch (error) {
    if (epoch === authEpoch) setSyncStatus(error.message + ' Số liệu và bảng vẫn dùng được; bấm Làm mới để thử lại.', 'error');
  }
}
function upsertChart(id, existing, config) {
  const signature = JSON.stringify(config.data);
  if (existing) {
    if (existing.fmSignature === signature) return existing;
    existing.data = config.data;
    existing.options = {...config.options, animation:false};
    existing.update('none');
    existing.fmSignature = signature;
    return existing;
  }
  config.options = {...config.options, animation:false};
  const chart = new Chart(document.getElementById(id).getContext('2d'), config);
  chart.fmSignature = signature;
  return chart;
}
