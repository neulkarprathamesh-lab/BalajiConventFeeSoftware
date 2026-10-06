// Server Settings window - reads and saves the Main Server address through the
// `feehub.server` bridge (preload.js). Saving reloads the main window so the
// new address takes effect immediately; no restart is needed.
const $ = (id) => document.getElementById(id);

function showMessage(text, ok) {
  const el = $('message');
  el.textContent = text;
  el.classList.remove('hidden');
  el.style.color = ok ? '#86efac' : '';
}

function readForm() {
  return { host: $('host-input').value, port: $('port-input').value };
}

async function init() {
  const cfg = await window.feehub.server.get();
  $('host-input').value = cfg.serverHost;
  $('port-input').value = String(cfg.serverPort);
  $('current-info').textContent = `Current: ${cfg.serverHost}:${cfg.serverPort}`;
}

$('test-btn').addEventListener('click', async () => {
  $('test-btn').disabled = true;
  showMessage('Testing...', true);
  const res = await window.feehub.server.test(readForm());
  $('test-btn').disabled = false;
  if (res.ok) showMessage(`Connected to Main Server at ${res.host}:${res.port}.`, true);
  else showMessage(res.error, false);
});

$('save-btn').addEventListener('click', async () => {
  $('save-btn').disabled = true;
  const res = await window.feehub.server.save(readForm());
  if (!res.ok) {
    $('save-btn').disabled = false;
    showMessage(res.error, false);
  }
  // On success the main process closes this window and reloads the app.
});

$('host-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('save-btn').click(); });
$('port-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('save-btn').click(); });

init();
