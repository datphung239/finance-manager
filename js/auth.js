// Callback khi đăng nhập Google thành công
function handleCredentialResponse(response) {
  currentToken = response.credential;
  localStorage.setItem('google_id_token', currentToken);
  verifyAuthToken();
}

// Gọi API verifyAuth về Backend
function verifyAuthToken() {
  if (!currentToken) {
    showLoginScreen();
    return;
  }
  
  fetch(API_URL, {
    method: 'POST',
    body: JSON.stringify({ action: 'verifyAuth', token: currentToken })
  })
  .then(res => res.json())
  .then(res => {
    if (res.success) {
      userEmail = res.email;
      showAppScreen();
      initAppData(); // Tải dữ liệu ban đầu
    } else {
      logout();
    }
  })
  .catch(err => {
    console.error("Lỗi xác thực:", err);
    showLoginScreen();
  });
}

function logout() {
  localStorage.removeItem('google_id_token');
  currentToken = null;
  userEmail = null;
  location.reload();
}

function showLoginScreen() {
  document.getElementById('login-screen').style.display = 'block';
  document.getElementById('app-screen').style.display = 'none';
}

function showAppScreen() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-screen').style.display = 'block';
  if (userEmail) {
    document.getElementById('user-email-display').innerText = userEmail;
  }
}
