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
    google.accounts.id.initialize({
      client_id: CLIENT_ID,
      callback: handleCredentialResponse
    });
    google.accounts.id.renderButton(
      document.getElementById("google-btn-container"),
      { theme: "outline", size: "medium", text: "signin_with" }
    );
  }
}

function handleCredentialResponse(response) {
  if (response.credential) {
    googleToken = response.credential;
    localStorage.setItem("google_id_token", googleToken);
    verifyAndProceed();
  }
}

async function verifyAndProceed() {
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
    updateUI(data.email || 'User', true);
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
