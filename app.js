const API_URL = "https://script.google.com/macros/s/AKfycbyUMT-Rq85WCqBVwLsfNu4XMEITG97lOrdS7VjXi6J-NOtWih021nolsVzQFozI0k4Rdw/exec";
const CLIENT_ID = "457034906414-kk5rglsgac2krun66bprec56v0i3c2n2.apps.googleusercontent.com";

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

function setTodayDefaultDates() {
  const today = new Date().toISOString().substring(0, 10);
  const cardDateInput = document.getElementById('date');
  if (cardDateInput) cardDateInput.value = today;

  const cashDateInput = document.getElementById('cashDate');
  if (cashDateInput) cashDateInput.value = today;
}

document.addEventListener('DOMContentLoaded', () => {
  setTodayDefaultDates();
});

window.onload = () => {
  const checkSdk = setInterval(() => {
    if (window.google?.accounts) {
      clearInterval(checkSdk);
      initAuth();
    }
  }, 50);
};

function initAuth() {
  google.accounts.id.initialize({ client_id: CLIENT_ID, callback: handleCredentialResponse });
  const savedToken = localStorage.getItem("google_id_token");
  if (savedToken) {
    try {
      const payload = JSON.parse(atob(savedToken.split('.')[1]));
      if (payload.exp * 1000 > Date.now()) {
        googleToken = savedToken;
        verifyAndProceed(payload.email);
        return;
      }
    } catch (e) {}
  }
  showLoginPrompt();
}

function showLoginPrompt() {
  updateUI("", false);
  google.accounts.id.renderButton(document.getElementById("google-btn-container"), { theme: "outline", size: "large" });
  google.accounts.id.prompt();
}

async function handleCredentialResponse(response) {
  googleToken = response.credential;
  const payload = JSON.parse(atob(googleToken.split('.')[1]));
  localStorage.setItem("google_id_token", googleToken);
  await verifyAndProceed(payload.email);
}

async function verifyAndProceed(email) {
  updateUI(email, true);
  clearAppCache();

  document.getElementById('loadingDash').style.display = 'block';
  document.getElementById('dashContent').style.display = 'none';

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      body: JSON.stringify({ action: "verifyAuth", token: googleToken })
    });
    const data = await res.json();
    if (!data.success) {
      alert(`Lỗi truy cập: ${data.message || 'Tài khoản không có quyền!'}`);
      logout(); return;
    }
    await fetchInitialAppDataServer();
  } catch (err) {
    alert("Lỗi xác thực quyền với Server!");
    logout();
  }
}

function updateUI(email, isLoggedIn) {
  document.getElementById("user-email").textContent = email;
  document.getElementById("google-btn-container").classList.toggle("hidden", isLoggedIn);
  document.getElementById("user-info").classList.toggle("hidden", !isLoggedIn);
  document.getElementById("app-container").classList.toggle("hidden", !isLoggedIn);
  if (isLoggedIn && window.google?.accounts?.id) google.accounts.id.cancel();
}

function logout() {
  googleToken = null;
  localStorage.removeItem("google_id_token");
  clearAppCache();
  showLoginPrompt();
}

function clearAppCache() {
  ["app_init_data", "app_dash_data", "app_cash_dash_data", "app_tx_spending", "app_tx_cash"].forEach(k => localStorage.removeItem(k));
}

async function sendRequest(action, payload = {}) {
  if (!googleToken) { alert("Vui lòng đăng nhập Google!"); return null; }
  try {
    const response = await fetch(API_URL, {
      method: "POST",
      body: JSON.stringify({ action, token: googleToken, ...payload })
    });
    const resData = await response.json();
    if (!resData.success && (resData.message === 'EXPIRED_TOKEN' || resData.message.includes("không hợp lệ") || resData.message.includes("không có quyền"))) {
      alert(resData.message); logout(); return null;
    }
    if (!resData.success) {
      showAlert("Lỗi: " + (resData.message || resData.error), "danger"); return null;
    }
    return resData.data !== undefined ? resData.data : resData.message;
  } catch (err) {
    showAlert("Lỗi kết nối Server: " + err.toString(), "danger"); return null;
  }
}
async function fetchInitialAppDataServer() {
  // Xóa Cache dữ liệu cũ để luôn cập nhật danh mục mới nhất từ Sheet
  localStorage.removeItem("app_init_data");

  const data = await sendRequest("getInitialData");
  if (data) {
    localStorage.setItem("app_init_data", JSON.stringify(data));
    applyInitialData(data);
  }

  await loadDashboard(true);
  await loadCashDashboard(true);

  sendRequest("getRecentTransactions", { type: 'spending' }).then(list => list && localStorage.setItem("app_tx_spending", JSON.stringify(list)));
  sendRequest("getRecentTransactions", { type: 'cash_spending' }).then(list => list && localStorage.setItem("app_tx_cash", JSON.stringify(list)));
}

function applyInitialData(data) {
  populateDropdown('card', data.cards || [], '-- Chọn thẻ --');
  populateDropdown('dashFilterCard', data.cards || [], '-- Tất cả Thẻ --');
  populateDropdown('dashFilterCategory', data.categories || [], '-- Tất cả Danh Mục --');

  // 1. Datalist Danh mục & Merchant cho Thẻ Tín Dụng (CARDS MANAGEMENT)
  const catOpt = document.getElementById('categoryOptions');
  if (catOpt && data.categories) {
    catOpt.innerHTML = '';
    data.categories.forEach(item => { catOpt.innerHTML += `<option value="${item}">`; });
  }

  const merchOpt = document.getElementById('merchantOptions');
  if (merchOpt && data.merchants) {
    merchOpt.innerHTML = '';
    data.merchants.forEach(item => { merchOpt.innerHTML += `<option value="${item}">`; });
  }

  if (data.merchantCategoryMap) {
    merchantMapData = data.merchantCategoryMap;
  }

  // 2. Datalist Danh mục & Merchant cho Dòng Tiền Mặt / Bank (CASH MANAGEMENT)
  const cashCatOpt = document.getElementById('cashCategoryOptions');
  if (cashCatOpt && data.cashCategories) {
    cashCatOpt.innerHTML = '';
    // Đảm bảo chỉ lặp danh mục thuộc CASH MANAGEMENT B2:B
    data.cashCategories.forEach(item => { cashCatOpt.innerHTML += `<option value="${item}">`; });
  }

  const cashMerchOpt = document.getElementById('cashMerchantOptions');
  if (cashMerchOpt && data.cashMerchants) {
    cashMerchOpt.innerHTML = '';
    cashMerchOpt.innerHTML = '';
    data.cashMerchants.forEach(item => { cashMerchOpt.innerHTML += `<option value="${item}">`; });
  }

  if (data.cashMerchantCategoryMap) {
    cashMerchantMapData = data.cashMerchantCategoryMap;
  }
}

function populateDropdown(elemId, list, defaultText) {
  const sel = document.getElementById(elemId);
  if (!sel) return;
  sel.innerHTML = `<option value="">${defaultText}</option>`;
  list.forEach(c => sel.innerHTML += `<option value="${c}">${c}</option>`);
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
  const isCard = (mode === 'card');
  document.getElementById('btnModeCard').className = isCard ? 'btn btn-primary fw-bold btn-main-mode active' : 'btn btn-outline-primary fw-bold btn-main-mode';
  document.getElementById('btnModeCash').className = !isCard ? 'btn btn-success fw-bold btn-main-mode active' : 'btn btn-outline-success fw-bold btn-main-mode';

  document.getElementById('cardAppContainer').classList.toggle('hidden', !isCard);
  document.getElementById('cashAppContainer').classList.toggle('hidden', isCard);

  if (!isCard) {
    const isDashActive = document.getElementById('tab-cash-dash').classList.contains('active');
    if (isDashActive) loadCashDashboard(false);
    else loadRecentCashTransactions(false);
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

  if (type === 'spending') {
    document.getElementById('entryType').value = 'spending';
    resetVoiceUI();
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

  // 1. Nếu là Doanh Thu Kinh Doanh (bắt đầu bằng DT-)
  if (isDT) {
    if (val && !val.startsWith("-")) {
      amtInput.value = "-" + val; // Tự động đổi thành số ÂM (-)
    }
    targetSelect.value = "Kinh Doanh"; // Gán Đối Tượng là Kinh Doanh
    targetSelect.disabled = true;       // Khóa không cho sửa
    help.className = "form-text small text-success fw-bold";
    help.innerText = "✓ Doanh Thu Kinh Doanh -> Tự động ghi ÂM (-) & Đối tượng: Kinh Doanh";
  } 
  // 2. Nếu là Chi Phí Kinh Doanh (bắt đầu bằng CP-)
  else if (isCP) {
    if (val.startsWith("-")) {
      amtInput.value = val.replace("-", ""); // CP giữ số DƯƠNG (+)
    }
    targetSelect.value = "Kinh Doanh"; // Gán Đối Tượng là Kinh Doanh
    targetSelect.disabled = true;       // Khóa không cho sửa
    help.className = "form-text small text-primary fw-bold";
    help.innerText = "✓ Chi Phí Kinh Doanh -> Số DƯƠNG (+) & Đối tượng: Kinh Doanh";
  } 
  // 3. Chi tiêu sinh hoạt cá nhân thông thường
  else {
    if (val.startsWith("-")) {
      amtInput.value = val.replace("-", ""); // Giữ số DƯƠNG (+)
    }
    // Mở khóa lựa chọn đối tượng & nếu đang là Kinh Doanh thì reset về mặc định
    targetSelect.disabled = false;
    if (targetSelect.value === "Kinh Doanh") {
      targetSelect.value = "";
    }
    help.className = "form-text small text-danger";
    help.innerText = "Chi tiêu sinh hoạt -> Tự động ghi DƯƠNG (+)";
  }
}
async function handleCashFormSubmit(form) {
  event.preventDefault();
  const btn = document.getElementById('btnSubmitCash');
  btn.disabled = true; btn.innerText = 'Đang lưu...';

  const formObject = Object.fromEntries(new FormData(form).entries());
  const msg = await sendRequest("submitData", { formObject });
  btn.disabled = false; btn.innerText = 'Lưu Giao Dịch Cash';

  if (msg) {
    showAlertCash(msg, 'success');
    form.reset();
    setTodayDefaultDates();
    document.getElementById('mCash').checked = true;
    document.getElementById('cashTarget').disabled = false;
    loadRecentCashTransactions(true);
    await loadCashDashboard(true);
  }
}

function loadRecentCashTransactions(forceFetch = false) {
  const cacheKey = "app_tx_cash";
  const cached = localStorage.getItem(cacheKey);
  if (cached && !forceFetch) {
    try {
      renderRecentCashListUI(JSON.parse(cached));
      return;
    } catch (e) {}
  }
  document.getElementById('loadingTxCash').style.display = 'block';
  sendRequest("getRecentTransactions", { type: 'cash_spending' }).then(list => {
    document.getElementById('loadingTxCash').style.display = 'none';
    if (list) {
      localStorage.setItem(cacheKey, JSON.stringify(list));
      renderRecentCashListUI(list);
    }
  });
}

function renderRecentCashListUI(list) {
  const txList = document.getElementById('txListCash');
  if (!txList) return;
  if (!list || list.length === 0) {
    txList.innerHTML = '<p class="text-center text-muted m-0 py-2 small">Chưa có giao dịch Cash.</p>';
    return;
  }

  txList.innerHTML = '<div class="list-group list-group-flush">' + list.map(item => {
    const amt = Number(item.amount || 0);
    const isInc = amt < 0;
    const dateFormatted = formatDate(item.date);
    const amtFormatted = Math.abs(amt).toLocaleString('vi-VN');
    const methodBadge = `<span class="badge ${item.method === 'Chuyển Khoản' ? 'bg-success' : (item.method === 'Ví Điện Tử' ? 'bg-purple' : 'bg-secondary')}">${item.method || 'Tiền Mặt'}</span>`;
    const merchBadge = item.merchant ? `<span class="badge bg-light text-dark border ms-1">${item.merchant}</span>` : '';
    const targetBadge = (item.target && item.target !== 'Bản thân' && item.target.trim()) ? `<span class="badge bg-light text-dark border ms-1">${item.target}</span>` : '';

    return `
      <div class="tx-item d-flex justify-content-between align-items-center py-2 border-bottom">
        <div>
          <div class="fw-bold small">${dateFormatted} - ${methodBadge}</div>
          <div class="text-dark small">${item.category || 'Chưa phân loại'} ${merchBadge} ${targetBadge}</div>
          <div class="${isInc ? 'text-success' : 'text-danger'} fw-bold small">${isInc ? '+' : '-'}${amtFormatted} đ</div>
        </div>
        <button class="btn btn-outline-danger btn-sm py-0 px-2" type="button" onclick="confirmDeleteCash(${item.rowIndex}, '${dateFormatted}', '${item.category}', '${amtFormatted}')"><i class="bi bi-trash"></i></button>
      </div>`;
  }).join('') + '</div>';
}

async function confirmDeleteCash(rowIndex, date, category, amount) {
  if (confirm(`Bạn có chắc muốn XÓA giao dịch này?\n\n- Ngày: ${date}\n- Danh mục: ${category}\n- Số tiền: ${amount} đ`)) {
    document.getElementById('loadingTxCash').style.display = 'block';
    const msg = await sendRequest("deleteTransaction", { type: 'cash_spending', rowIndex });
    if (msg) {
      showAlertCash(msg, 'success');
      loadRecentCashTransactions(true);
      await loadCashDashboard(true);
    } else {
      document.getElementById('loadingTxCash').style.display = 'none';
    }
  }
}

function showAlertCash(msg, type) {
  const alert = document.getElementById('alertMsgCash');
  if (!alert) return;
  alert.className = `alert alert-${type} py-2 px-3 small fw-bold shadow-sm border mb-3`;
  alert.innerHTML = (type === 'danger') ? `<i class="bi bi-exclamation-triangle-fill me-1"></i> ${msg}` : `<i class="bi bi-check-circle-fill me-1"></i> ${msg}`;
  alert.style.display = 'block';
  setTimeout(() => { alert.style.display = 'none'; }, 3000);
}

async function loadCashDashboard(fetchServer = false) {
  const cacheKey = "app_cash_dash_data";
  const cached = localStorage.getItem(cacheKey);
  if (cached && !fetchServer) {
    try {
      const parsedData = JSON.parse(cached);
      document.getElementById('loadingCashDash').style.display = 'none';
      document.getElementById('cashDashContent').style.display = 'block';
      renderCashDashboard(parsedData);
      return;
    } catch (e) {}
  }
  document.getElementById('loadingCashDash').style.display = 'block';
  document.getElementById('cashDashContent').style.display = 'none';
  const data = await sendRequest("getCashDashboardData");
  document.getElementById('loadingCashDash').style.display = 'none';
  if (data) {
    localStorage.setItem(cacheKey, JSON.stringify(data));
    document.getElementById('cashDashContent').style.display = 'block';
    renderCashDashboard(data);
  }
}

function renderCashDashboard(d) {
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

  if (chartTrendsInstance) chartTrendsInstance.destroy();
  const ctxTrends = document.getElementById('chartMonthTrends').getContext('2d');
  const maxAmount = Math.max(...d.monthTrends.map(m => m.amount), 0);
  const customYMax = maxAmount + 4000000; 

  chartTrendsInstance = new Chart(ctxTrends, {
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

  if (chartPaymentInstance) chartPaymentInstance.destroy();
  const ctxPayment = document.getElementById('chartPaymentMethods').getContext('2d');
  const totalPaymentAmt = d.paymentData.list.reduce((sum, item) => sum + item.amount, 0);

  chartPaymentInstance = new Chart(ctxPayment, {
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

  if (chartTargetInstance) chartTargetInstance.destroy();
  const ctxTarget = document.getElementById('chartTargetData').getContext('2d');
  chartTargetInstance = new Chart(ctxTarget, {
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

  const catTbody = document.getElementById('tableCatChanges');
  catTbody.innerHTML = '';
  if (d.catChanges && d.catChanges.length > 0) {
    d.catChanges.forEach(c => {
      const isInc = c.diff > 0;
      const colorClass = isInc ? 'text-danger' : (c.diff < 0 ? 'text-success' : 'text-muted');
      const sign = isInc ? '+' : '';
      catTbody.innerHTML += `
        <tr>
          <td class="fw-bold nowrap-text">${c.category}</td>
          <td class="text-end nowrap-text">${formatVND(c.thisMonth)}</td>
          <td class="text-end text-muted nowrap-text">${formatVND(c.lastMonth)}</td>
          <td class="text-end fw-bold ${colorClass} nowrap-text">${sign}${formatVND(c.diff)}</td>
          <td class="text-end fw-bold ${colorClass} nowrap-text">${c.percent}</td>
        </tr>`;
    });
  } else {
    catTbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-2">Không có dữ liệu danh mục.</td></tr>';
  }

  if (chartDailyInstance) chartDailyInstance.destroy();
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

  chartDailyInstance = new Chart(ctxDaily, {
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

async function applyCashFilters() {
  const filterObj = {
    startDate: document.getElementById('cashFilterStart').value,
    endDate: document.getElementById('cashFilterEnd').value,
    paymentMonth: document.getElementById('cashPaymentMonth').value,
    ratioMonth: document.getElementById('cashRatioMonth').value
  };
  document.getElementById('loadingCashDash').style.display = 'block';
  const data = await sendRequest("updateCashDashboardFilters", { filterObj });
  document.getElementById('loadingCashDash').style.display = 'none';
  if (data) {
    localStorage.setItem("app_cash_dash_data", JSON.stringify(data));
    renderCashDashboard(data);
  }
}

function convertDisplayToInputDate(dStr) {
  if (!dStr) return '';
  const parts = dStr.split('/');
  return parts.length === 3 ? `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}` : dStr;
}

function loadRecentTransactions(forceFetch = false) {
  const cacheKey = "app_tx_spending";
  const cached = localStorage.getItem(cacheKey);

  if (cached && !forceFetch) {
    try { renderTxList(JSON.parse(cached)); return; } catch(e) {}
  }

  document.getElementById('loadingTx').style.display = 'block';
  sendRequest("getRecentTransactions", { type: 'spending' }).then(list => {
    document.getElementById('loadingTx').style.display = 'none';
    if (list) {
      localStorage.setItem(cacheKey, JSON.stringify(list));
      renderTxList(list);
    }
  });
}

function renderTxList(list) {
  const txList = document.getElementById('txList');
  if (!txList) return;
  if (!list || list.length === 0) {
    txList.innerHTML = '<p class="text-center text-muted m-0 py-2 small">Chưa có giao dịch thẻ.</p>';
    return;
  }

  txList.innerHTML = '<div class="list-group list-group-flush">' + list.map(item => {
    const amt = Number(item.amount || 0);
    const isPay = amt < 0;
    const dateFormatted = formatDate(item.date);
    const amtFormatted = Math.abs(amt).toLocaleString('vi-VN');
    const merchBadge = item.merchant ? `<span class="badge bg-light text-dark border ms-1">${item.merchant}</span>` : '';
    const targetBadge = (item.target && item.target.trim()) ? `<span class="badge bg-info-subtle text-info border border-info ms-1">${item.target}</span>` : '';

    return `
      <div class="tx-item d-flex justify-content-between align-items-center py-2 border-bottom">
        <div>
          <div class="fw-bold small">${dateFormatted} - <span class="text-primary">${item.card}</span></div>
          <div class="text-dark small">${item.category || 'Chưa phân loại'} ${merchBadge} ${targetBadge}</div>
          <div class="${isPay ? 'text-success fw-bold' : 'amount-text'} small">${isPay ? '-' : ''}${amtFormatted} đ</div>
        </div>
        <button class="btn btn-outline-danger btn-sm py-0 px-2" type="button" onclick="confirmDelete('spending', ${item.rowIndex}, '${dateFormatted}', '${item.card}', '${amtFormatted}')"><i class="bi bi-trash"></i></button>
      </div>`;
  }).join('') + '</div>';
}

async function confirmDelete(type, rowIndex, date, card, amount) {
  if (confirm(`Bạn có chắc chắn muốn XÓA giao dịch này?\n\n- Ngày: ${date}\n- Thẻ: ${card}\n- Số tiền: ${amount} đ`)) {
    document.getElementById('loadingTx').style.display = 'block';
    const msg = await sendRequest("deleteTransaction", { type: 'spending', rowIndex });
    if (msg) { 
      showAlert(msg, 'success'); 
      loadRecentTransactions(true); 
      loadDashboard(true); 
    } else {
      document.getElementById('loadingTx').style.display = 'none';
    }
  }
}

async function fetchRecommendation() {
  const kwInput = document.getElementById('recommendInput');
  if (!kwInput) return;
  const kw = kwInput.value.trim();
  if (!kw) return;

  if (document.activeElement) document.activeElement.blur();

  const recModalEl = document.getElementById('recommendModal');
  if (!recModalEl) return;
  const recModal = bootstrap.Modal.getOrCreateInstance(recModalEl);

  document.getElementById('loadingRecModal').style.display = 'block';
  document.getElementById('cardRecommendList').innerHTML = '';
  document.getElementById('resMainCat').innerText = 'Đang tra cứu...';
  document.getElementById('resSubCat').innerText = 'Đang tra cứu...';

  recModal.show();

  const data = await sendRequest("getCardRecommendation", { keyword: kw });
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

    data.cards.forEach(item => {
      listContainer.innerHTML += `
        <div class="recommend-card mb-2 p-2 border-start border-4 border-primary bg-light rounded shadow-sm">
          <div class="d-flex justify-content-between align-items-center mb-1">
            <span class="fw-bold text-dark small">${item.cardName}</span>
            <span class="rate-badge">${item.rate}</span>
          </div>
          <div class="text-muted small" style="font-size: 0.75rem;">
            <div>• <strong>Kiểu áp dụng:</strong> ${item.applyType}</div>
            <div>• <strong>Hoàn max/danh mục:</strong> ${item.maxCat} | <strong>Max/kỳ:</strong> ${item.maxCycle}</div>
            ${item.minSpend ? `<div>• <strong>Chi tối thiểu:</strong> ${item.minSpend}</div>` : ''}
          </div>
        </div>`;
    });
  }
}    

async function loadDashboard(fetchServer = false) {
  if (fetchServer) {
    const data = await sendRequest("getDashboardData");
    if (data) {
      localStorage.setItem("app_dash_data", JSON.stringify(data));
      renderDashboard(data);
      document.getElementById('loadingDash').style.display = 'none';
      document.getElementById('dashContent').style.display = 'block';
      applyCategoryFilter();
    }
  } else {
    const cached = localStorage.getItem("app_dash_data");
    if (cached) {
      try { 
        renderDashboard(JSON.parse(cached));
        document.getElementById('loadingDash').style.display = 'none';
        document.getElementById('dashContent').style.display = 'block';
      } catch(e){}
    }
  }
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

  filtered.forEach(st => {
    let statusBadge = '';
    if (st.status === 'UPDATING') statusBadge = `<span class="badge bg-warning text-dark stmt-badge"><div class="spinner-border spinner-border-sm me-1" style="width:0.6rem;height:0.6rem;"></div> Đang cập nhật...</span>`;
    else if (st.status === 'Chưa TT') statusBadge = `<span class="badge bg-danger stmt-badge btn-pay-now" onclick="quickPay('${st.card}', ${st.remainingAmount})" title="Bấm để trả ngay"><i class="bi bi-credit-card"></i> Chưa TT</span>`;
    else if (st.status === 'Đã TT') statusBadge = `<span class="badge bg-success stmt-badge">Đã TT</span>`;
    else statusBadge = `<span class="badge bg-secondary stmt-badge">${st.status}</span>`;

    stmtList.innerHTML += `
      <div class="list-group-item px-1 py-2 ${st.status === 'Chưa TT' ? 'highlight-row' : ''}">
        <div class="d-flex justify-content-between align-items-center">
          <div class="card-title-box"><span class="card-name-text" title="${st.card}">${st.card}</span>${statusBadge}</div>
          <span class="amount-text">${formatVND(st.remainingAmount)}</span>
        </div>
        <div class="text-muted text-truncate" style="font-size: 0.75rem;">
          Kỳ ${st.cycle} (${st.fromDate} - ${st.toDate}) | Hạn: <span class="fw-bold text-dark">${st.dueDate}</span>
        </div>
      </div>`;
  });
}

async function applyCategoryFilter() {
  const filterObj = {
    card: document.getElementById('dashFilterCard').value,
    category: document.getElementById('dashFilterCategory').value,
    status: document.getElementById('dashFilterStatus').value
  };

  document.getElementById('loadingReport').style.display = 'block';
  const reportData = await sendRequest("updateDashboardFilters", { filterObj });
  document.getElementById('loadingReport').style.display = 'none';

  if (reportData) {
    const tableBody = document.getElementById('categoryReportTable');
    tableBody.innerHTML = '';
    if (reportData.length === 0) {
      tableBody.innerHTML = '<tr><td colspan="2" class="text-center text-muted">Không có dữ liệu.</td></tr>'; return;
    }

    reportData.forEach((row, idx) => {
      const isHeader = idx === 0;
      const isTotal = ['TỔNG', 'CÒN LẠI', 'ĐÃ THANH TOÁN', 'TRỪ VÀO SAO KÊ'].some(k => row.label.toString().toUpperCase().includes(k));
      const rowClass = isHeader ? 'table-primary fw-bold' : (isTotal ? 'summary-row' : '');

      tableBody.innerHTML += `
        <tr class="${rowClass}">
          <td>${row.label}</td>
          <td class="text-end">${typeof row.amount === 'number' ? formatVND(row.amount) : row.amount}</td>
        </tr>`;
    });
  }
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

async function handleFormSubmit(form) {
  event.preventDefault();
  const btn = document.getElementById('btnSubmit');
  btn.disabled = true; btn.innerText = 'Đang lưu...';

  const formObject = Object.fromEntries(new FormData(form).entries());
  const dashCache = localStorage.getItem("app_dash_data");
  if (dashCache) {
    try {
      const parsedDash = JSON.parse(dashCache);
      parsedDash.statements = parsedDash.statements.map(st => {
        if (st.card === formObject.card) st.status = 'UPDATING';
        return st;
      });
      renderDashboard(parsedDash);
    } catch(e){}
  }

  const msg = await sendRequest("submitData", { formObject });
  btn.disabled = false; btn.innerText = 'Lưu Giao Dịch SPENDING_PAYMENTS';

  if (msg) {
    showAlert(msg, 'success');
    form.reset();
    setTodayDefaultDates();
    loadRecentTransactions(true);
    loadDashboard(true);
  }
}

function showAlert(msg, type) {
  const alert = document.getElementById('alertMsg');
  if (!alert) return;

  alert.className = `alert alert-${type} mb-3 py-2 px-3 small fw-bold shadow-sm border`;
  alert.innerHTML = (type === 'danger' || type === 'warning') 
    ? `<i class="bi bi-exclamation-triangle-fill me-1"></i> ${msg}`
    : `<i class="bi bi-check-circle-fill me-1"></i> ${msg}`;
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
        else if (res.method === "Ví Điện Tử") document.getElementById('mWallet').checked = true;
        else document.getElementById('mCash').checked = true;

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
