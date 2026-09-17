// js/auth.js - Quản lý xác thực Google ID Token

function initAuth() {
  const savedToken = localStorage.getItem("google_id_token");
  if (savedToken) {
    googleToken = savedToken;
    verifyAndProceed();
  } else {
    showLoginPrompt();
  }
}

function showLoginPrompt() {
  updateUI("", false);
  if (window.google?.accounts?.id) {
    // Hủy các instance cũ đang treo để tránh bị khựng popup
    google.accounts.id.cancel();

    google.accounts.id.initialize({
      client_id: CLIENT_ID,
      callback: handleCredentialResponse,
      auto_select: false // Tránh tự động chọn làm treo phiên
    });

    const btnContainer = document.getElementById("google-btn-container");
    if (btnContainer) {
      btnContainer.innerHTML = ''; // Làm sạch container trước khi render nút mới
      google.accounts.id.renderButton(
        btnContainer,
        { theme: "outline", size: "large", text: "signin_with" }
      );
    }
  }
}

async function handleCredentialResponse(response) {
  if (response && response.credential) {
    googleToken = response.credential;
    localStorage.setItem("google_id_token", googleToken);
    
    // Hiển thị trạng thái đang xử lý để không bị cảm giác khựng
    const userEmailEl = document.getElementById("user-email");
    if (userEmailEl) userEmailEl.textContent = "Đang xác thực...";
    
    await verifyAndProceed();
  }
}

async function verifyAndProceed() {
  if (!googleToken) {
    showLoginPrompt();
    return;
  }

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      body: JSON.stringify({ action: "verifyAuth", token: googleToken })
    });
    
    const data = await res.json();
    
    if (!data.success) {
      alert(`Lỗi truy cập: ${data.message || 'Tài khoản không có quyền!'}`);
      logout();
      return;
    }

    // Xác thực thành công -> Cập nhật UI & Tải dữ liệu App
    updateUI(data.email || 'User', true);
    await fetchInitialAppDataServer();

  } catch (err) {
    console.error("Lỗi xác thực Server:", err);
    // Nếu token hết hạn hoặc lỗi mạng, xóa token cũ và cho đăng nhập lại
    logout();
  }
}

function updateUI(email, isLoggedIn) {
  const emailEl = document.getElementById("user-email");
  const btnContainer = document.getElementById("google-btn-container");
  const userInfo = document.getElementById("user-info");
  const appContainer = document.getElementById("app-container");

  if (emailEl) emailEl.textContent = email;
  if (btnContainer) btnContainer.classList.toggle("hidden", isLoggedIn);
  if (userInfo) userInfo.classList.toggle("hidden", !isLoggedIn);
  if (appContainer) appContainer.classList.toggle("hidden", !isLoggedIn);

  if (isLoggedIn && window.google?.accounts?.id) {
    google.accounts.id.cancel(); // Đóng hẳn prompt nếu đã vào app
  }
}

function logout() {
  googleToken = null;
  localStorage.removeItem("google_id_token");
  clearAppCache();
  showLoginPrompt();
}
