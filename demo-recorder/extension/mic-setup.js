const msg = document.getElementById('msg');
document.getElementById('allow').onclick = async () => {
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    s.getTracks().forEach((t) => t.stop());
    msg.className = 'ok';
    msg.textContent = 'Microphone ready. Go back to your app and press Start in the Demo Recorder popup. This tab closes by itself.';
    setTimeout(() => window.close(), 2500);
  } catch (e) {
    msg.className = 'err';
    msg.textContent = 'Microphone blocked (' + (e.message || e.name) + '). Click the icon at the right of the address bar to allow it, then try again.';
  }
};
