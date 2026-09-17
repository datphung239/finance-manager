// js/cash-app.js - Quản lý Cash Dashboard & Thu Chi Tiền Mặt/Bank

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
  if (!d) return;

  // 1. Gắn chỉ số Tổng Doanh Thu & Tổng Chi
  if (d.period) {
    document.getElementById('cashTotalRev').innerText = formatVND(d.period.totalRevenue);
    document.getElementById('cashTotalExp').innerText = formatVND(d.period.totalExpense);

    const filterStart = document.getElementById('cashFilterStart');
    const filterEnd = document.getElementById('cashFilterEnd');
    if (filterStart && d.period.startDate) filterStart.value = convertDisplayToInputDate(d.period.startDate);
    if (filterEnd && d.period.endDate) filterEnd.value = convertDisplayToInputDate(d.period.endDate);
  }

  // 2. Gắn ngày filter cho Payment & Ratio
  if (d.paymentData && d.paymentData.filterMonth) {
    const payMonthInput = document.getElementById('cashPaymentMonth');
    if (payMonthInput) payMonthInput.value = convertDisplayToInputDate(d.paymentData.filterMonth);
  }

  if (d.ratioTableData) {
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
  }

  if (d.frequencyData) {
    document.getElementById('cashTxCount').innerText = d.frequencyData.txCount + " lần";
    document.getElementById('cashAvgAmt').innerText = formatVND(d.frequencyData.avgAmt);
    document.getElementById('cashMaxAmt').innerText = formatVND(d.frequencyData.maxAmt);
  }

  // ==========================================
  // CHART 1: BIẾN ĐỘNG CHI TIÊU 4 THÁNG
  // ==========================================
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
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } }
      }
    });
  }

  // ==========================================
  // CHART 2: TỶ LỆ HÌNH THỨC THANH TOÁN
  // ==========================================
  if (chartPaymentInstance) chartPaymentInstance.destroy();
  const ctxPayment = document.getElementById('chartPaymentMethods')?.getContext('2d');
  if (ctxPayment && d.paymentData && d.paymentData.list) {
    const totalPaymentAmt = d.paymentData.list.reduce((sum, item) => sum + item.amount, 0);
    chartPaymentInstance = new Chart(ctxPayment, {
      type: 'doughnut',
      data: {
        labels: d.paymentData.list.map(p => {
          const pct = totalPaymentAmt > 0 ? ((p.amount / totalPaymentAmt) * 100).toFixed(1) : 0;
          return `${p.method} (${pct}%)`;
        }),
        datasets: [{
          data: d.paymentData.list.map(p => p.amount),
          backgroundColor: ['#198754', '#6c757d', '#6f42c1', '#0dcaf0', '#ffc107']
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: { boxWidth: 12, font: { size: 11 } }
          }
        }
      }
    });
  }

  // ==========================================
  // CHART 3: BIẾN ĐỘNG CHI TIÊU 3 THÁNG THEO ĐỐI TƯỢNG
  // ==========================================
  if (chartTargetInstance) chartTargetInstance.destroy();
  const ctxTarget = document.getElementById('chartTargetData')?.getContext('2d');
  if (ctxTarget && d.targetData && d.targetData.list) {
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
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'top',
            labels: { boxWidth: 12, font: { size: 10 } }
          }
        }
      }
    });
  }

  // ==========================================
  // BẢNG: BIẾN ĐỘNG CHI TIÊU THEO DANH MỤC
  // ==========================================
  const catTbody = document.getElementById('tableCatChanges');
  if (catTbody) {
    catTbody.innerHTML = '';
    if (d.catChanges && d.catChanges.length > 0) {
      d.catChanges.forEach(c => {
        const isInc = c.diff > 0;
        const colorClass = isInc ? 'text-danger' : (c.diff < 0 ? 'text-success' : 'text-muted');
        const sign = isInc ? '+' : '';
        catTbody.innerHTML += 
          `<tr>
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
  }

  // ==========================================
  // CHART 4: CHI TIÊU HẰNG NGÀY
  // ==========================================
  if (chartDailyInstance) chartDailyInstance.destroy();
  const ctxDaily = document.getElementById('chartDailyList')?.getContext('2d');
  if (ctxDaily && d.dailyData && d.dailyData.list) {
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
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: true,
            position: 'top',
            labels: { boxWidth: 15, font: { size: 10, weight: 'bold' } }
          }
        }
      }
    });
  }
}

async function applyCashFilters() {
  const filterObj = {
    startDate: document.getElementById('cashFilterStart')?.value || '',
    endDate: document.getElementById('cashFilterEnd')?.value || '',
    paymentMonth: document.getElementById('cashPaymentMonth')?.value || '',
    ratioMonth: document.getElementById('cashRatioMonth')?.value || ''
  };

  document.getElementById('loadingCashDash').style.display = 'block';
  const data = await sendRequest("updateCashDashboardFilters", { filterObj });
  document.getElementById('loadingCashDash').style.display = 'none';

  if (data) {
    localStorage.setItem("app_cash_dash_data", JSON.stringify(data));
    renderCashDashboard(data);
  }
}

function validateKDAmount() {
  const catInput = document.getElementById('cashCategory');
  const amtInput = document.getElementById('cashAmount');
  const helpEl = document.getElementById('amountHelp');

  if (!catInput || !amtInput) return;
  const catVal = catInput.value.trim().toUpperCase();

  if (catVal.startsWith("KD-") || catVal.startsWith("THU_") || catVal.includes("THU NHẬP") || catVal.includes("DOANH THU")) {
    if (amtInput.value && !amtInput.value.startsWith('-')) {
      amtInput.value = '-' + amtInput.value.replace(/[^0-9]/g, '');
    }
    if (helpEl) helpEl.innerHTML = '<span class="text-success fw-bold"><i class="bi bi-info-circle"></i> Danh mục Doanh Thu / Thu Nhập: Số tiền tự động mang dấu ÂM (-)</span>';
  } else {
    if (amtInput.value.startsWith('-')) {
      amtInput.value = amtInput.value.replace(/[^0-9]/g, '');
    }
    if (helpEl) helpEl.innerHTML = '';
  }
}

async function handleCashFormSubmit(form) {
  event.preventDefault();
  const btn = document.getElementById('btnSubmitCash');
  if (btn) { btn.disabled = true; btn.innerText = 'Đang lưu...'; }

  const formObject = Object.fromEntries(new FormData(form).entries());
  const msg = await sendRequest("submitData", { formObject });

  if (btn) { btn.disabled = false; btn.innerText = 'Lưu Giao Dịch Cash'; }

  if (msg) {
    showAlertCash(msg, 'success');
    form.reset();
    setTodayDefaultDates();
    loadRecentCashTransactions(true);
    loadCashDashboard(true);
  }
}

function switchCashTab(type) {
  const isDash = (type === 'dash');
  document.getElementById('tab-cash-dash')?.classList.toggle('active', isDash);
  document.getElementById('tab-cash-input')?.classList.toggle('active', !isDash);

  const dashBlock = document.getElementById('cashDashboardBlock');
  const inputBlock = document.getElementById('cashInputBlock');

  if (dashBlock) dashBlock.style.display = isDash ? 'block' : 'none';
  if (inputBlock) inputBlock.style.display = !isDash ? 'block' : 'none';

  if (isDash) {
    loadCashDashboard(false);
  } else {
    setTodayDefaultDates();
    loadRecentCashTransactions(false);
  }
}

async function loadRecentCashTransactions(forceFetch = false) {
  const cacheKey = "app_tx_cash";
  const cached = localStorage.getItem(cacheKey);

  if (cached && !forceFetch) {
    try { renderCashTxList(JSON.parse(cached)); return; } catch(e) {}
  }

  const loadingEl = document.getElementById('loadingTxCash');
  if (loadingEl) loadingEl.style.display = 'block';

  const list = await sendRequest("getRecentTransactions", { type: 'cash_spending' });
  if (loadingEl) loadingEl.style.display = 'none';

  if (list) {
    localStorage.setItem(cacheKey, JSON.stringify(list));
    renderCashTxList(list);
  }
}

function renderCashTxList(list) {
  const container = document.getElementById('txListCash');
  if (!container) return;

  if (!list || list.length === 0) {
    container.innerHTML = '<p class="text-center text-muted m-0 py-2 small">Chưa có giao dịch Cash.</p>';
    return;
  }

  container.innerHTML = '<div class="list-group list-group-flush">' + list.map(item => {
    const amt = Number(item.amount || 0);
    const isRevenue = amt < 0;
    const dateFormatted = formatDate(item.date);
    const amtFormatted = Math.abs(amt).toLocaleString('vi-VN') + ' đ';
    const merchBadge = item.merchant ? `<span class="badge bg-light text-dark border ms-1">${item.merchant}</span>` : '';
    const targetBadge = (item.target && item.target.trim()) ? `<span class="badge bg-info-subtle text-info border border-info ms-1">${item.target}</span>` : '';

    return `
      <div class="tx-item d-flex justify-content-between align-items-center py-2 border-bottom">
        <div>
          <div class="fw-bold small">${dateFormatted} - <span class="text-success">${item.method || 'Tiền Mặt'}</span></div>
          <div class="text-dark small">${item.category || 'Chưa phân loại'} ${merchBadge} ${targetBadge}</div>
          <div class="${isRevenue ? 'text-success fw-bold' : 'text-danger fw-bold'} small">${isRevenue ? '+' : ''}${amtFormatted}</div>
        </div>
        <button class="btn btn-outline-danger btn-sm py-0 px-2" type="button" onclick="confirmDeleteCash(${item.rowIndex}, '${dateFormatted}', '${amtFormatted}')"><i class="bi bi-trash"></i></button>
      </div>`;
  }).join('') + '</div>';
}

async function confirmDeleteCash(rowIndex, date, amount) {
  if (confirm(`Bạn có chắc muốn XÓA giao dịch Cash này?\n\n- Ngày: ${date}\n- Số tiền: ${amount}`)) {
    const msg = await sendRequest("deleteTransaction", { type: 'cash_spending', rowIndex });
    if (msg) {
      showAlertCash(msg, 'success');
      loadRecentCashTransactions(true);
      loadCashDashboard(true);
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
