// URL Deployment của Google Apps Script[cite: 5]
const API_URL = "https://script.google.com/macros/s/AKfycbyUMT-Rq85WCqBVwLsfNu4XMEITG97lOrdS7VjXi6J-NOtWih021nolsVzQFozI0k4Rdw/exec"; 

// Google Client ID[cite: 5]
const CLIENT_ID = "457034906414-kk5rglsgac2krun66bprec56v0i3c2n2.apps.googleusercontent.com";

// Biến trạng thái ứng dụng
let googleToken = null;
let currentStatementsData = [];
let merchantMapData = {};
let cashMerchantMapData = {};

// Khai báo các đối tượng Chart.js
let chartTrendsInstance = null;
let chartPaymentInstance = null;
let chartTargetInstance = null;
let chartDailyInstance = null;

// Helper định dạng tiền & ngày tháng
const formatVND = (val) => typeof val === 'number' ? val.toLocaleString('vi-VN') + ' đ' : val;

const formatDate = (str) => {
  if (!str) return '';
  const clean = str.toString().replace("'", "").trim();
  const p = clean.includes('/') ? clean.split('/') : clean.split('-');
  if (p.length !== 3) return clean;
  if (clean.includes('-')) return `${p[2].padStart(2,'0')}/${p[1].padStart(2,'0')}/${p[0]}`;
  return `${p[0].padStart(2,'0')}/${p[1].padStart(2,'0')}/${p[2]}`;
};

function convertDisplayToInputDate(dStr) {
  if (!dStr) return '';
  const p = dStr.toString().split('/');
  if (p.length === 3) return `${p[2]}-${p[1].padStart(2, '0')}-${p[0].padStart(2, '0')}`;
  return dStr;
}

function setTodayDefaultDates() {
  const today = new Date().toISOString().split('T')[0];
  ['date', 'cashDate'].forEach(id => {
    const el = document.getElementById(id);
    if (el && !el.value) el.value = today;
  });
}

// Wrapper gửi Request tới Apps Script Backend
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

function clearAppCache() {
  ["app_init_data", "app_dash_data", "app_cash_dash_data", "app_tx_spending", "app_tx_cash"].forEach(k => localStorage.removeItem(k));
}
