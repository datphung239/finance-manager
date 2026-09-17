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
}

async function applyCashFilters() {
  const filterStart = document.getElementById('cashFilterStart').value;
  const filterEnd = document.getElementById('cashFilterEnd').value;
  const payMonth = document.getElementById('cashPaymentMonth').value;
  const ratioMonth = document.getElementById('cashRatioMonth').value;

  const data = await sendRequest("updateCashDashboardFilters", {
    filterStart, filterEnd, payMonth, ratioMonth
  });

  if (data) {
    localStorage.setItem("app_cash_dash_data", JSON.stringify(data));
    renderCashDashboard(data);
  }
}
