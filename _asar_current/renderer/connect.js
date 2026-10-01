(() => {
  const $ = (id) => document.getElementById(id);
  const searching = $('searching');
  const manual = $('manual');
  const progress = $('progress');
  const errorBox = $('error');
  const ipInput = $('ip-input');
  const connectBtn = $('connect-btn');
  const retryBtn = $('retry-btn');
  const savedInfo = $('saved-info');
  const diagBtn = $('diag-btn');
  const diagResult = $('diag-result');

  const urlParams = new URLSearchParams(window.location.search);
  const initialError = urlParams.get('error');
  if (initialError) {
    showManual(initialError);
  }

  window.feehub.getSavedServer().then((cfg) => {
    if (cfg && cfg.serverIp) {
      savedInfo.textContent = `Last connected: ${cfg.serverIp}`;
      ipInput.value = cfg.serverIp;
    } else {
      savedInfo.textContent = 'First run - discovering Main Server';
    }
  });

  window.feehub.onProgress((msg) => {
    if (!msg) return;
    progress.textContent = msg;
  });

  window.feehub.onDiscoveryFailed(() => {
    showManual();
  });

  function showManual(errMsg) {
    searching.classList.add('hidden');
    manual.classList.remove('hidden');
    if (errMsg) {
      errorBox.textContent = errMsg;
      errorBox.classList.remove('hidden');
    }
    setTimeout(() => ipInput.focus(), 30);
  }

  function showSearching() {
    manual.classList.add('hidden');
    errorBox.classList.add('hidden');
    searching.classList.remove('hidden');
    progress.textContent = 'Starting...';
  }

  connectBtn.addEventListener('click', async () => {
    const ip = ipInput.value.trim();
    if (!ip) {
      errorBox.textContent = 'Please enter the Main Server IP address.';
      errorBox.classList.remove('hidden');
      return;
    }
    connectBtn.disabled = true;
    connectBtn.textContent = 'Connecting...';
    errorBox.classList.add('hidden');
    const res = await window.feehub.connectManual(ip);
    if (!res.ok) {
      errorBox.textContent = res.error;
      errorBox.classList.remove('hidden');
      connectBtn.disabled = false;
      connectBtn.textContent = 'Connect';
    }
    // Success: main.js loads the app URL; this page will be replaced.
  });

  ipInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') connectBtn.click();
  });

  retryBtn.addEventListener('click', async () => {
    showSearching();
    await window.feehub.rediscover();
  });

  diagBtn.addEventListener('click', async () => {
    diagBtn.disabled = true;
    diagBtn.textContent = 'Creating report...';
    diagResult.classList.add('hidden');
    diagResult.classList.remove('err');
    try {
      const res = await window.feehub.diagnostics.create(ipInput.value.trim() || undefined);
      if (res.ok) {
        diagResult.textContent = `Saved to Desktop — click to open`;
        diagResult.classList.remove('hidden');
        diagResult.onclick = () => window.feehub.diagnostics.openLocation(res.path);
        diagResult.style.cursor = 'pointer';
        diagResult.style.textDecoration = 'underline';
      } else {
        diagResult.textContent = `Could not create report: ${res.error}`;
        diagResult.classList.add('err');
        diagResult.classList.remove('hidden');
      }
    } finally {
      diagBtn.disabled = false;
      diagBtn.textContent = 'Create Diagnostic Report';
    }
  });
})();
