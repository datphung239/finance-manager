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

function validateKDAmount() {
  const catVal = document.getElementById('cashCategory').value.trim();
  const amtInput = document.getElementById('cashAmount');
  const help = document.getElementById('amountHelp');

  if (catVal.toUpperCase().startsWith("KD-")) {
    if (amtInput.value && !amtInput.value.startsWith('-')) {
      amtInput.value = '-' + amtInput.value.replace(/[^0-9]/g, '');
    }
    if (help) help.innerHTML = '<span class="text-success fw-bold"><i class="bi bi-info-circle"></i> Doanh thu Kinh Doanh: Tự động mang dấu ÂM (-)</span>';
  } else {
    if (amtInput.value.startsWith('-')) {
      amtInput.value = amtInput.value.replace(/[^0-9]/g, '');
    }
    if (help) help.innerHTML = '';
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
    loadRecentCashTransactions(true);
    loadCashDashboard(true);
  }
}

async function loadRecentCashTransactions(forceFetch = false) {
  const list = await sendRequest("getRecentTransactions", { type: 'cash_spending' });
  if (list) renderRecentCashListUI(list);
}

function renderRecentCashListUI(list) {
  const container = document.getElementById('txListCash');
  if (!list || list.length === 0) {
    container.innerHTML = '<p class="text-center text-muted py-2 small">Không có giao dịch cash gần đây.</p>'; return;
  }

  container.innerHTML = list.map(item => {
    const isRev = Number(item.amount) < 0;
    const amtFormatted = formatVND(Math.abs(item.amount));
    const dateFormatted = formatDate(item.date);
    const methodBadge = `<span class="badge bg-secondary ms-1">${item.method || 'Tiền Mặt'}</span>`;
    const targetBadge = item.target ? `<span class="badge bg-info text-dark ms-1">${item.target}</span>` : '';

    return 
      `<div class="tx-item d-flex justify-content-between align-items-center py-2 border-bottom">
        <div>
          <div class="fw-bold small">${dateFormatted} - <span class="text-success">${item.category}</span></div>
          <div class="text-dark small">${item.merchant || 'Cửa hàng'} ${methodBadge} ${targetBadge}</div>
          <div class="${isRev ? 'text-success fw-bold' : 'text-danger fw-bold'} small">${isRev ? '-' : ''}${amtFormatted}</div>
        </div>
        <button class="btn btn-outline-danger btn-sm py-0 px-2" type="button" onclick="confirmDeleteCash(${item.rowIndex}, '${dateFormatted}', '${item.category}', '${amtFormatted}')"><i class="bi bi-trash"></i></button>
      </div>`;
  }).join('');
}

async function confirmDeleteCash(rowIndex, date, category, amount) {
  if (confirm(`Bạn có chắc muốn XÓA giao dịch này?\n\n- Ngày: ${date}\n- Danh mục: ${category}\n- Số tiền: ${amount}`)) {
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
  // 1. Hiển thị container lên trước để Canvas có kích thước thật
  document.getElementById('loadingCashDash').style.display = 'none';
  document.getElementById('cashDashContent').style.display = 'block';

  // 2. Điền thông số KPI & Bảng biểu
  document.getElementById('cashTotalRev').innerText = formatVND(d.period.totalRevenue);
  document.getElementById('cashTotalExp').innerText = formatVND(d.period.totalExpense);
  
  // ... (Gắn các dữ liệu text khác) ...

  // 3. VẼ CHART 1: Biến Động Chi Tiêu 4 Tháng (Line/Bar Chart)
  if (chartTrendsInstance) chartTrendsInstance.destroy();
  const ctxTrends = document.getElementById('chartMonthTrends')?.getContext('2d');
  if (ctxTrends && d.monthTrends) {
    chartTrendsInstance = new Chart(ctxTrends, {
      type: 'bar',
      data: {
        labels: d.monthTrends.map(m => m.month),
        datasets: [{
          label: 'Chi tiêu (đ)',
          data: d.monthTrends.map(m => m.amount),
          backgroundColor: '#198754',
          borderRadius: 4
        }]
      },
      options: { responsive: true, maintainAspectRatio: false }
    });
  }

  // 4. VẼ CHART 2: Tỷ Lệ Hình Thức TT (Doughnut Chart)
  if (chartPaymentInstance) chartPaymentInstance.destroy();
  const ctxPayment = document.getElementById('chartPaymentMethods')?.getContext('2d');
  if (ctxPayment && d.paymentData?.list) {
    chartPaymentInstance = new Chart(ctxPayment, {
      type: 'doughnut',
      data: {
        labels: d.paymentData.list.map(p => p.method),
        datasets: [{
          data: d.paymentData.list.map(p => p.amount),
          backgroundColor: ['#198754', '#0dcaf0', '#ffc107', '#6c757d']
        }]
      },
      options: { responsive: true, maintainAspectRatio: false }
    });
  }

  // 5. VẼ CHART 3: Biến Động Chi Tiêu 3 Tháng Theo Đối Tượng
  if (chartTargetInstance) chartTargetInstance.destroy();
  const ctxTarget = document.getElementById('chartTargetData')?.getContext('2d');
  if (ctxTarget && d.targetData?.list) {
    chartTargetInstance = new Chart(ctxTarget, {
      type: 'bar',
      data: {
        labels: d.targetData.list.map(t => t.target),
        datasets: [
          { label: d.targetData.months[0] || 'Tháng này', data: d.targetData.list.map(t => t.m1Amt), backgroundColor: '#198754' },
          { label: d.targetData.months[1] || 'Tháng trước', data: d.targetData.list.map(t => t.m2Amt), backgroundColor: '#20c997' },
          { label: d.targetData.months[2] || 'Tháng cũ', data: d.targetData.list.map(t => t.m3Amt), backgroundColor: '#0dcaf0' }
        ]
      },
      options: { responsive: true, maintainAspectRatio: false }
    });
  }

  // 6. VẼ CHART 4: Chi Tiêu Hằng Ngày
  if (chartDailyInstance) chartDailyInstance.destroy();
  const ctxDaily = document.getElementById('chartDailyList')?.getContext('2d');
  if (ctxDaily && d.dailyData?.list) {
    chartDailyInstance = new Chart(ctxDaily, {
      type: 'line',
      data: {
        labels: d.dailyData.list.map(i => i.date),
        datasets: [{
          label: 'Số tiền chi',
          data: d.dailyData.list.map(i => i.amount),
          borderColor: '#198754',
          fill: true,
          tension: 0.3
        }]
      },
      options: { responsive: true, maintainAspectRatio: false }
    });
  }
}
