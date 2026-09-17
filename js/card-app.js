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

    stmtList.innerHTML += 
      `<div class="list-group-item px-1 py-2 ${st.status === 'Chưa TT' ? 'highlight-row' : ''}">
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

      tableBody.innerHTML += 
        `<tr class="${rowClass}">
          <td>${row.label}</td>
          <td class="text-end">${typeof row.amount === 'number' ? formatVND(row.amount) : row.amount}</td>
        </tr>`;
    });
  }
}

function quickPay(cardName, remainingAmount) {
  switchForm('spending');
  document.getElementById('card').value = cardName;
  document.getElementById('categoryInput').value = 'TTT_Thanh toán dư nợ thẻ';
  document.getElementById('amount').value = -Math.abs(remainingAmount);
  handleCategoryChange();
}

function handleCategoryChange() {
  const catVal = document.getElementById('categoryInput').value.trim();
  const amtInput = document.getElementById('amount');
  const helpEl = document.getElementById('cardCategoryHelp');

  if (catVal.toUpperCase().startsWith("TTT_")) {
    if (amtInput.value && !amtInput.value.startsWith('-')) {
      amtInput.value = '-' + amtInput.value.replace(/[^0-9]/g, '');
    }
    if (helpEl) helpEl.innerHTML = '<span class="text-danger fw-bold"><i class="bi bi-info-circle"></i> Danh mục thanh toán: Số tiền tự động mang dấu ÂM (-)</span>';
  } else {
    if (amtInput.value.startsWith('-')) {
      amtInput.value = amtInput.value.replace(/[^0-9]/g, '');
    }
    if (helpEl) helpEl.innerHTML = '';
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

async function handleFormSubmit(form) {
  event.preventDefault();
  const btn = document.getElementById('btnSubmit');
  btn.disabled = true; btn.innerText = 'Đang lưu...';

  const formObject = Object.fromEntries(new FormData(form).entries());
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

async function loadRecentTransactions(forceFetch = false) {
  const list = await sendRequest("getRecentTransactions", { type: 'spending' });
  if (list) renderTxList(list);
}

function renderTxList(list) {
  const container = document.getElementById('txList');
  if (!list || list.length === 0) {
    container.innerHTML = '<p class="text-center text-muted py-2 small">Không có giao dịch gần đây.</p>'; return;
  }

  container.innerHTML = list.map(item => {
    const isPay = Number(item.amount) < 0;
    const amtFormatted = formatVND(Math.abs(item.amount));
    const dateFormatted = formatDate(item.date);
    const merchBadge = item.merchant ? `<span class="badge bg-secondary ms-1">${item.merchant}</span>` : '';
    const targetBadge = item.target ? `<span class="badge bg-info text-dark ms-1">${item.target}</span>` : '';

    return 
      `<div class="tx-item d-flex justify-content-between align-items-center py-2 border-bottom">
        <div>
          <div class="fw-bold small">${dateFormatted} - <span class="text-primary">${item.card}</span></div>
          <div class="text-dark small">${item.category || 'Chưa phân loại'} ${merchBadge} ${targetBadge}</div>
          <div class="${isPay ? 'text-success fw-bold' : 'amount-text'} small">${isPay ? '-' : ''}${amtFormatted}</div>
        </div>
        <button class="btn btn-outline-danger btn-sm py-0 px-2" type="button" onclick="confirmDelete('spending', ${item.rowIndex}, '${dateFormatted}', '${item.card}', '${amtFormatted}')"><i class="bi bi-trash"></i></button>
      </div>`;
  }).join('');
}

async function confirmDelete(type, rowIndex, date, card, amount) {
  if (confirm(`Bạn có chắc chắn muốn XÓA giao dịch này?\n\n- Ngày: ${date}\n- Thẻ: ${card}\n- Số tiền: ${amount}`)) {
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

function showAlert(msg, type) {
  const alert = document.getElementById('alertMsg');
  if (!alert) return;
  alert.className = `alert alert-${type} py-2 px-3 small fw-bold shadow-sm mt-2`;
  alert.innerHTML = (type === 'danger') ? `<i class="bi bi-exclamation-triangle-fill me-1"></i> ${msg}` : `<i class="bi bi-check-circle-fill me-1"></i> ${msg}`;
  alert.style.display = 'block';
  setTimeout(() => { alert.style.display = 'none'; }, 3000);
}

async function fetchRecommendation() {
  const kwInput = document.getElementById('recommendInput');
  if (!kwInput) return;
  const kw = kwInput.value.trim();
  if (!kw) return;

  const recModalEl = document.getElementById('recommendModal');
  if (!recModalEl) return;
  const recModal = bootstrap.Modal.getOrCreateInstance(recModalEl);

  document.getElementById('loadingRecModal').style.display = 'block';
  document.getElementById('cardRecommendList').innerHTML = '';
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
      listContainer.innerHTML += 
        `<div class="recommend-card mb-2 p-2 border-start border-4 border-primary bg-light rounded shadow-sm">
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
