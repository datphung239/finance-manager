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

function switchForm(type) {
  document.querySelectorAll('#mainTab .nav-link').forEach(btn => btn.classList.remove('active'));
  const activeTab = document.getElementById(`tab-${type}`);
  if (activeTab) activeTab.classList.add('active');

  const isDash = (type === 'dashboard');
  document.getElementById('dashboardBlock').style.display = isDash ? 'block' : 'none';
  document.getElementById('inputFormFields').style.display = !isDash ? 'block' : 'none';

  if (isDash) {
    loadDashboard(false);
  } else {
    setTodayDefaultDates();
    loadRecentTransactions(false);
  }
}

async function fetchInitialAppDataServer() {
  const data = await sendRequest("getInitialData");
  if (data) {
    localStorage.setItem("app_init_data", JSON.stringify(data));
    applyInitialData(data);
  }
  await loadDashboard(true);
  await loadCashDashboard(true);
  loadRecentTransactions(true);
  loadRecentCashTransactions(true);
}

function applyInitialData(data) {
  populateDropdown('card', data.cards || [], '-- Chọn thẻ --');
  populateDropdown('dashFilterCard', data.cards || [], '-- Tất cả Thẻ --');
  populateDropdown('dashFilterCategory', data.categories || [], '-- Tất cả Danh Mục --');

  // Card Datalists
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
  if (data.merchantCategoryMap) merchantMapData = data.merchantCategoryMap;

  // Cash Datalists
  const cashCatOpt = document.getElementById('cashCategoryOptions');
  if (cashCatOpt && data.cashCategories) {
    cashCatOpt.innerHTML = '';
    data.cashCategories.forEach(item => { cashCatOpt.innerHTML += `<option value="${item}">`; });
  }

  const cashMerchOpt = document.getElementById('cashMerchantOptions');
  if (cashMerchOpt && data.cashMerchants) {
    cashMerchOpt.innerHTML = '';
    data.cashMerchants.forEach(item => { cashMerchOpt.innerHTML += `<option value="${item}">`; });
  }
  if (data.cashMerchantCategoryMap) cashMerchantMapData = data.cashMerchantCategoryMap;
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
      if (type === 'cash') validateKDAmount();
      else handleCategoryChange();
      break;
    }
  }
}
