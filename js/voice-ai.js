let recognitionInstance = null;
let isProcessingVoice = false;
let silenceTimer = null;

function startVoiceRecognition(mode) {
  if (isProcessingVoice) return;

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    alert("Trình duyệt không hỗ trợ Web Speech API!"); return;
  }

  recognitionInstance = new SpeechRecognition();
  recognitionInstance.lang = 'vi-VN';
  recognitionInstance.interimResults = true;
  recognitionInstance.continuous = false;

  const btn = mode === 'recommend' ? document.getElementById('btnVoiceRec') : (mode === 'cash_spending' ? document.getElementById('btnVoiceCash') : document.getElementById('btnVoice'));
  const liveBox = mode === 'recommend' ? document.getElementById('liveSpeechBoxRec') : (mode === 'cash_spending' ? document.getElementById('liveSpeechBoxCash') : document.getElementById('liveSpeechBox'));
  const liveText = mode === 'recommend' ? document.getElementById('liveSpeechTextRec') : (mode === 'cash_spending' ? document.getElementById('liveSpeechTextCash') : document.getElementById('liveSpeechText'));

  if (btn) btn.classList.add('btn-mic-listening');
  if (liveBox) liveBox.classList.remove('hidden');

  recognitionInstance.onresult = (e) => {
    let transcript = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      transcript += e.results[i][0].transcript;
    }
    if (liveText) liveText.innerText = transcript;

    if (e.results[0].isFinal) {
      processParsedVoiceText(transcript, mode);
    }
  };

  recognitionInstance.onerror = () => resetVoiceUI();
  recognitionInstance.start();
}

async function processParsedVoiceText(text, mode) {
  isProcessingVoice = true;
  if (mode === 'recommend') {
    document.getElementById('recommendInput').value = text;
    fetchRecommendation();
    resetVoiceUI();
    return;
  }

  try {
    const res = await sendRequest("parseVoiceInput", { text, mode });
    if (res) {
      if (mode === 'spending') {
        if (res.card) document.getElementById('card').value = res.card;
        if (res.merchant) document.getElementById('merchantInput').value = res.merchant;
        if (res.category) document.getElementById('categoryInput').value = res.category;
        if (res.amount) document.getElementById('amount').value = res.amount;
        if (res.target) document.getElementById('cardTarget').value = res.target;
        handleCategoryChange();
        showAlert(`AI đã tự động điền: Thẻ "${res.card}" | Merchant "${res.merchant}" | DM "${res.category}"`, "success");
      } else if (mode === 'cash_spending') {
        if (res.merchant) document.getElementById('cashMerchantInput').value = res.merchant;
        if (res.category) document.getElementById('cashCategory').value = res.category;
        if (res.amount) document.getElementById('cashAmount').value = res.amount;
        if (res.target) document.getElementById('cashTarget').value = res.target;
        if (res.method) {
          const radio = document.querySelector(`input[name="method"][value="${res.method}"]`);
          if (radio) radio.checked = true;
        }
        validateKDAmount();
        showAlertCash(`AI đã tự động điền Thu/Chi Cash!`, "success");
      }
    }
  } catch (err) {
    alert("Lỗi xử lý kết nối giọng nói!");
  } finally {
    resetVoiceUI();
  }
}

function resetVoiceUI() {
  isProcessingVoice = false;
  if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; }
  if (recognitionInstance) {
    try { recognitionInstance.abort(); } catch(e){}
    recognitionInstance = null;
  }

  ['btnVoice', 'btnVoiceCash', 'btnVoiceRec'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.classList.remove('btn-mic-listening');
  });

  ['liveSpeechBox', 'liveSpeechBoxCash', 'liveSpeechBoxRec'].forEach(id => {
    const box = document.getElementById(id);
    if (box) box.classList.add('hidden');
  });
}
