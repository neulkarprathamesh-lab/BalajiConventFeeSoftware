// update.js - renderer for the Check for Updates window.
// Talks to the main process through the `feehub.updater` bridge exposed by preload.js.

const $ = (id) => document.getElementById(id);
const show = (id) => { ['checking','uptodate','available','progress','success','failure'].forEach(s => { $(s).classList.add('hidden'); }); $(id).classList.remove('hidden'); };
const bytesToMB = (n) => (typeof n === 'number' && n > 0) ? `${(n / (1024 * 1024)).toFixed(1)} MB` : '- MB';

let currentUpdate = null;
let isMainServer = true;

function fallbackInstallerUrl() {
  if (!currentUpdate) return null;
  return isMainServer ? currentUpdate.serverInstallerUrl : currentUpdate.clientInstallerUrl;
}

async function boot() {
  show('checking');
  try {
    const ctx = await window.feehub.updater.getContext();
    isMainServer = !!(ctx && ctx.isMainServer);
    const info = await window.feehub.updater.check();
    console.log('[update] check result:', info);
    $('installed-version').textContent = info.installed || '?';
    $('installed-version-2').textContent = info.installed || '?';
    $('installed-footer').textContent = `Installed ${info.installed || '?'}`;
    if (info.disabled) {
      show('uptodate');
      $('installed-version').textContent = info.installed || '?';
      document.querySelector('#uptodate p.hint').textContent = 'Updater is disabled in this build (no GitHub repository configured).';
      return;
    }
    if (info.error) {
      show('failure');
      $('error-message').textContent = `Unable to check for updates. Check your Internet connection and try again.`;
      return;
    }
    if (!info.available) { show('uptodate'); return; }
    currentUpdate = info;
    $('remote-version').textContent = info.remote;
    $('dl-size').textContent = bytesToMB(info.downloadSizeBytes);
    $('release-notes').textContent = (info.notes || 'No release notes provided.').trim();
    const differential = usesDifferentialPath();
    document.querySelectorAll('#available .pin-row').forEach((el) => { el.classList.toggle('hidden', !differential); });
    document.querySelector('#available h2').textContent = differential
      ? 'A new version is available'
      : (isMainServer ? 'A new version is available (full installer required)' : 'A new version is available for this Client PC');
    show('available');
  } catch (e) {
    show('failure');
    $('error-message').textContent = `Unexpected error: ${e && e.message ? e.message : String(e)}`;
  }
}

$('close-btn').addEventListener('click', () => window.close());
$('close-btn-2').addEventListener('click', () => window.close());
$('later').addEventListener('click', () => window.close());
$('restart-btn').addEventListener('click', () => window.feehub.updater.reconnect());
$('retry-btn').addEventListener('click', boot);
$('fallback-btn').addEventListener('click', () => {
  const url = fallbackInstallerUrl();
  if (url) window.feehub.updater.openExternal(url);
});
$('full-installer-link').addEventListener('click', () => {
  const url = fallbackInstallerUrl();
  if (url) window.feehub.updater.openExternal(url);
});


function usesDifferentialPath() {
  // Client PCs have no backend/frontend to differentially patch - they must
  // ALWAYS go through the full installer, never the Main Server's backend
  // upload/install endpoints (doing so would modify the shared Main Server
  // from a client machine, which is never allowed).
  if (!isMainServer) return false;
  if (!currentUpdate) return false;
  if (currentUpdate.fullInstallerRequired) return false;
  return !!currentUpdate.deltaAvailable;
}

$('update-now').addEventListener('click', async () => {
  if (!usesDifferentialPath()) {
    const installerUrl = isMainServer ? currentUpdate.serverInstallerUrl : currentUpdate.clientInstallerUrl;
    const filename = isMainServer ? currentUpdate.serverInstallerFilename : currentUpdate.clientInstallerFilename;
    if (!installerUrl || !currentUpdate.sha256sumsUrl) {
      show('failure');
      $('error-message').textContent = 'This release does not publish a full installer for this machine type.';
      return;
    }
    show('progress');
    $('progress-title').textContent = 'Downloading full installer...';
    $('progress-bar').style.width = '0%';
    $('phase-line').textContent = 'Starting download...';
    window.feehub.updater.removeAllProgressListeners();
    window.feehub.updater.onProgress((data) => {
      if (data.phase === 'downloading-installer' && data.total > 0) {
        const pct = Math.round((data.received / data.total) * 100);
        $('progress-bar').style.width = `${pct}%`;
        $('phase-line').textContent = `Downloading... ${bytesToMB(data.received)} / ${bytesToMB(data.total)} (${pct}%)`;
      } else if (data.phase === 'launching') {
        $('progress-title').textContent = 'Launching installer...';
        $('phase-line').textContent = 'Balaji FeeHub will now close so the installer can run.';
      }
    });
    const result = await window.feehub.updater.downloadAndRunFullInstaller({ installerUrl, sha256sumsUrl: currentUpdate.sha256sumsUrl, filename });
    if (!result || !result.ok) {
      show('failure');
      $('error-message').textContent = (result && result.error) || 'Unknown error downloading the installer.';
    }
    return;
  }

  const email = ($('admin-email').value || '').trim();
  const password = $('admin-password').value || '';
  const pin = ($('admin-pin').value || '').trim();
  if (!email || !password) {
    alert('Please enter the Administrator email and password.');
    return;
  }
  if (!/^\d{4,8}$/.test(pin)) {
    alert('Please enter the 4-8 digit Administrator PIN.');
    return;
  }
  show('progress');
  $('progress-title').textContent = 'Downloading update...';
  $('progress-bar').style.width = '0%';
  $('phase-line').textContent = 'Starting download...';

  window.feehub.updater.removeAllProgressListeners();
  window.feehub.updater.onProgress((data) => {
    if (data.phase === 'downloading' && data.total > 0) {
      const pct = Math.round((data.received / data.total) * 100);
      $('progress-bar').style.width = `${pct}%`;
      $('phase-line').textContent = `Downloading... ${bytesToMB(data.received)} / ${bytesToMB(data.total)} (${pct}%)`;
    } else if (data.phase === 'verified') {
      $('progress-bar').style.width = '100%';
      $('phase-line').textContent = `Verified SHA-256. Authenticating with Main Server...`;
    } else if (data.phase === 'authenticating') {
      $('progress-title').textContent = 'Authenticating...';
      $('phase-line').textContent = data.message || 'Verifying administrator credentials...';
    } else if (data.phase === 'uploading') {
      $('progress-title').textContent = 'Uploading to Main Server...';
      $('phase-line').textContent = data.message || 'Uploading...';
    } else if (data.phase === 'verifying') {
      $('progress-title').textContent = 'Verifying signature and file hashes...';
      $('phase-line').textContent = data.message || 'Verifying...';
    } else if (data.phase === 'installing') {
      $('progress-title').textContent = 'Applying update...';
      $('phase-line').textContent = data.message || 'Installing...';
    } else if (data.phase === 'restarting') {
      $('progress-title').textContent = 'Backend restarting...';
      $('phase-line').textContent = data.message || 'Restarting...';
    }
  });

  const result = await window.feehub.updater.downloadAndInstall({
    deltaUrl: currentUpdate.deltaUrl,
    expectedSha256: currentUpdate.expectedSha256,
    adminEmail: email,
    adminPassword: password,
    adminPin: pin,
  });
  if (result && result.ok) {
    $('new-version').textContent = result.toVersion || currentUpdate.remote;
    show('success');
  } else {
    show('failure');
    $('error-message').textContent = (result && result.error) || 'Unknown error during update.';
  }
});

boot();
