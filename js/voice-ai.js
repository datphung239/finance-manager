let recognition = null;

// Khởi tạo nhận diện giọng nói
function startVoiceRecognition(onSuccessCallback, statusElementId) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    alert("Trình duyệt của bạn không hỗ trợ nhận diện giọng nói Web Speech API!");
    return;
  }

  recognition = new SpeechRecognition();
  recognition.lang = 'vi-VN';
  recognition.continuous = false;
  
  const statusEl = document.getElementById(statusElementId);
  if (statusEl) statusEl.innerText = "Đang nghe...";

  recognition.onresult = function(event) {
    const transcript = event.results[0][0].transcript;
    if (statusEl) statusEl.innerText = `Đã nghe: "${transcript}"`;
    onSuccessCallback(transcript);
  };

  recognition.onerror = function(event) {
    if (statusEl) statusEl.innerText = "Lỗi nhận diện giọng nói, vui lòng thử lại!";
  };

  recognition.start();
}

// Gọi API parseVoiceInput về Backend (Sử dụng Groq/Gemini)
function sendVoiceToAI(text, mode, onParsedCallback) {
  fetch(API_URL, {
    method: 'POST',
    body: JSON.stringify({
      action: 'parseVoiceInput',
      token: currentToken,
      text: text,
      mode: mode
    })
  })
  .then(res => res.json())
  .then(res => {
    if (res.success) {
      onParsedCallback(res.data);
    } else {
      alert("Lỗi AI: " + (res.message || "Không thể phân tích câu nói"));
    }
  })
  .catch(err => console.error("Lỗi AI Voice:", err));
}
