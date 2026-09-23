/**
 * updater.js — Electron-side update client.
 *
 * Responsibilities:
 *   1. Talk to GitHub Releases API to discover the latest published version.
 *   2. Compare with installed version (semver, downgrade-safe).
 *   3. Download the *.bcupdate delta package (typically 5-20 MB, not 700 MB).
 *   4. Verify SHA-256 against the release manifest before touching anything.
 *   5. Post the verified package to the Main Server's existing
 *      /api/updates/upload endpoint (which enforces RSA signature check,
 *      per-file SHA-256 verify, DB backup, rollback snapshot, atomic apply,
 *      auto-rollback on failure).
 *   6. Ask the user for the Administrator PIN, then call /api/updates/install.
 *   7. Restart the app once the backend reports 'restart_scheduled: true'.
 *
 * NEVER touches:
 *   - the school database
 *   - /app/backups, /app/logs, .env
 *   - any file outside the payload roots the backend already validates
 *
 * NEVER stores GitHub tokens; uses only the public releases API.
 */

const { app, net, dialog, ipcMain, shell } = require('electron');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { spawn } = require('child_process');
const { isUpgrade, compare } = require('./version-compare');
const { parseAuthResponse, isAdminUser, parseSha256Sums } = require('./auth-utils');

// --- Config -----------------------------------------------------------------

// Owner/repo is baked into the shipped Electron bundle at build time by
// GitHub Actions (see .github/workflows/build-installers.yml step "Embed
// updater repo config"). At runtime we read desktop/updater/config.json;
// if it is missing the updater is silently disabled.
function loadRepoConfig() {
  try {
    // eslint-disable-next-line global-require
    const cfg = require('./config.json');
    return cfg && typeof cfg.repo === 'string' && /^[^/]+\/[^/]+$/.test(cfg.repo) ? cfg.repo : null;
  } catch (_) {
    // Fallback for dev: env var can still be used before the config file
    // is baked in.
    const env = process.env.UPDATER_GITHUB_REPO;
    return env && /^[^/]+\/[^/]+$/.test(env) ? env : null;
  }
}
const GITHUB_REPO = loadRepoConfig();
const RELEASES_API = GITHUB_REPO
  ? `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`
  : null;
const CHECK_TIMEOUT_MS = 8000;
const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_DELTA_MB = 300; // hard cap for .bcupdate deltas; anything larger is refused
const MAX_FULL_INSTALLER_MB = 1024; // hard cap for full Server/Client .exe downloads (MongoDB MSI + wheels can be large)
const USER_AGENT = 'BalajiFeeHub-Updater/1.0';

// --- Utilities --------------------------------------------------------------

function log(...args) { console.log('[updater]', ...args); }
function warn(...args) { console.warn('[updater]', ...args); }
function errlog(...args) { console.error('[updater]', ...args); }

function readInstalledVersion() {
  try {
    return require('../package.json').version || '0.0.0';
  } catch (_) { return '0.0.0'; }
}

function httpGetJson(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = net.request({ method: 'GET', url, redirect: 'follow' });
    req.setHeader('User-Agent', USER_AGENT);
    req.setHeader('Accept', 'application/vnd.github+json');
    const timer = setTimeout(() => { req.abort(); reject(new Error(`GitHub API timed out after ${timeoutMs}ms`)); }, timeoutMs);
    let body = '';
    req.on('response', (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        clearTimeout(timer);
        return httpGetJson(res.headers.location, timeoutMs).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        clearTimeout(timer);
        return reject(new Error(`GitHub API returned HTTP ${res.statusCode}`));
      }
      res.on('data', (chunk) => { body += chunk.toString('utf8'); });
      res.on('end', () => {
        clearTimeout(timer);
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error('GitHub API returned invalid JSON')); }
      });
    });
    req.on('error', (e) => { clearTimeout(timer); reject(e); });
    req.end();
  });
}

function httpPostJson(url, bodyObj, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = net.request({ method: 'POST', url });
    req.setHeader('Content-Type', 'application/json');
    const payload = JSON.stringify(bodyObj || {});
    const timer = setTimeout(() => { req.abort(); reject(new Error(`Request timed out after ${timeoutMs}ms`)); }, timeoutMs);
    let body = '';
    req.on('response', (res) => {
      res.on('data', (chunk) => { body += chunk.toString('utf8'); });
      res.on('end', () => {
        clearTimeout(timer);
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 300)}`));
        try { resolve(body ? JSON.parse(body) : {}); } catch (e) { resolve({}); }
      });
    });
    req.on('error', (e) => { clearTimeout(timer); reject(e); });
    req.write(payload);
    req.end();
  });
}

function httpDownload(url, destPath, timeoutMs, onProgress, maxMB = MAX_DELTA_MB) {
  return new Promise((resolve, reject) => {
    const req = net.request({ method: 'GET', url, redirect: 'follow' });
    req.setHeader('User-Agent', USER_AGENT);
    req.setHeader('Accept', 'application/octet-stream');
    const timer = setTimeout(() => { req.abort(); reject(new Error(`Download timed out after ${timeoutMs}ms`)); }, timeoutMs);
    let out = null;
    req.on('response', (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        clearTimeout(timer);
        return httpDownload(res.headers.location, destPath, timeoutMs, onProgress, maxMB).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        clearTimeout(timer);
        return reject(new Error(`Download returned HTTP ${res.statusCode}`));
      }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let received = 0;
      out = fs.createWriteStream(destPath);
      res.on('data', (chunk) => {
        received += chunk.length;
        out.write(chunk);
        if (onProgress) onProgress(received, total);
        if (received > maxMB * 1024 * 1024) {
          out.end(); try { fs.unlinkSync(destPath); } catch (_) {}
          clearTimeout(timer);
          req.abort();
          reject(new Error(`Download exceeds ${maxMB} MB - refusing to download`));
        }
      });
      res.on('end', () => {
        out.end(() => { clearTimeout(timer); resolve({ received, total }); });
      });
      res.on('error', (e) => { clearTimeout(timer); try { out.end(); } catch (_) {} reject(e); });
    });
    req.on('error', (e) => { clearTimeout(timer); reject(e); });
    req.end();
  });
}

function httpGetText(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = net.request({ method: 'GET', url, redirect: 'follow' });
    req.setHeader('User-Agent', USER_AGENT);
    const timer = setTimeout(() => { req.abort(); reject(new Error(`Request timed out after ${timeoutMs}ms`)); }, timeoutMs);
    let body = '';
    req.on('response', (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        clearTimeout(timer);
        return httpGetText(res.headers.location, timeoutMs).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        clearTimeout(timer);
        return reject(new Error(`Request returned HTTP ${res.statusCode}`));
      }
      res.on('data', (chunk) => { body += chunk.toString('utf8'); });
      res.on('end', () => { clearTimeout(timer); resolve(body); });
    });
    req.on('error', (e) => { clearTimeout(timer); reject(e); });
    req.end();
  });
}

function sha256File(p) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    const s = fs.createReadStream(p);
    s.on('data', (d) => h.update(d));
    s.on('end', () => resolve(h.digest('hex')));
    s.on('error', reject);
  });
}

// --- Release manifest parsing ----------------------------------------------
/*
 * A release published by the CI workflow contains, at minimum:
 *
 *   BalajiFeeHub-Update-<version>.bcupdate          <- the delta
 *   BalajiFeeHub-Update-<version>.manifest.json     <- {version, sha256, size, min_supported_version, notes, base_version}
 *   BalajiFeeHub-Server-Setup.exe                   <- full installer fallback
 *   BalajiFeeHub-Client-Setup.exe                   <- full installer fallback
 *   SHA256SUMS.txt                                  <- checksums for all of the above
 *
 * The manifest JSON is small (<2 KB) and is fetched first. Only if the user
 * confirms 'Update Now' do we actually download the .bcupdate.
 */

function pickAsset(assets, matcher) {
  return (assets || []).find((a) => matcher(a.name)) || null;
}

async function fetchLatestRelease() {
  if (!RELEASES_API) throw new Error('Updater disabled: UPDATER_GITHUB_REPO not set at build time.');
  const rel = await httpGetJson(RELEASES_API, CHECK_TIMEOUT_MS);
  if (rel.draft || rel.prerelease) throw new Error('Latest release is draft or prerelease - ignoring.');
  const assets = rel.assets || [];
  const manifestAsset = pickAsset(assets, (n) => /\.manifest\.json$/i.test(n));
  const deltaAsset    = pickAsset(assets, (n) => /\.bcupdate$/i.test(n));
  const serverExeAsset   = pickAsset(assets, (n) => /Server-Setup\.exe$/i.test(n));
  const clientExeAsset   = pickAsset(assets, (n) => /Client-Setup\.exe$/i.test(n));
  const sha256sumsAsset  = pickAsset(assets, (n) => /^SHA256SUMS\.txt$/i.test(n));
  if (!manifestAsset) throw new Error('Release has no *.manifest.json asset - cannot verify update.');
  // Fetch the manifest itself (public, no auth)
  const manifest = await httpGetJson(manifestAsset.browser_download_url, CHECK_TIMEOUT_MS);
  // A baseline or otherwise full-installer-only release legitimately has no
  // .bcupdate asset - that is NOT an error, it just means the differential
  // path is unavailable and the caller must fall back to the full installer.
  return {
    tag: rel.tag_name,
    name: rel.name || rel.tag_name,
    body: rel.body || '',
    publishedAt: rel.published_at,
    manifest,
    deltaUrl: deltaAsset ? deltaAsset.browser_download_url : null,
    deltaSize: deltaAsset ? deltaAsset.size : 0,
    serverInstallerUrl: serverExeAsset ? serverExeAsset.browser_download_url : null,
    serverInstallerFilename: serverExeAsset ? serverExeAsset.name : null,
    clientInstallerUrl: clientExeAsset ? clientExeAsset.browser_download_url : null,
    clientInstallerFilename: clientExeAsset ? clientExeAsset.name : null,
    sha256sumsUrl: sha256sumsAsset ? sha256sumsAsset.browser_download_url : null,
  };
}

// --- Public API used by main.js --------------------------------------------

async function checkForUpdates() {
  const installed = readInstalledVersion();
  if (!RELEASES_API) return { available: false, disabled: true, installed };
  try {
    const rel = await fetchLatestRelease();
    const remoteVersion = String(rel.manifest.version || rel.tag.replace(/^v/, ''));
    const available = isUpgrade(installed, remoteVersion);
    return {
      available,
      installed,
      remote: remoteVersion,
      publishedAt: rel.publishedAt,
      notes: rel.manifest.release_notes || rel.body || '',
      downloadSizeBytes: rel.deltaSize,
      minSupportedVersion: rel.manifest.min_supported_version || '0.0.0',
      deltaAvailable: !!rel.deltaUrl,
      deltaUrl: rel.deltaUrl,
      expectedSha256: rel.manifest.sha256 || null,
      fullInstallerRequired: !!rel.manifest.full_installer_required,
      // Per-component breakdown of what this release actually changes - see
      // build-bcupdate.js. null for baseline releases (nothing to diff yet).
      components: rel.manifest.components || null,
      serverInstallerUrl: rel.serverInstallerUrl,
      serverInstallerFilename: rel.serverInstallerFilename,
      clientInstallerUrl: rel.clientInstallerUrl,
      clientInstallerFilename: rel.clientInstallerFilename,
      sha256sumsUrl: rel.sha256sumsUrl,
    };
  } catch (e) {
    warn('checkForUpdates failed:', e.message);
    return { available: false, error: e.message, installed };
  }
}

async function downloadUpdate(deltaUrl, expectedSha256, onProgress) {
  const dir = path.join(app.getPath('userData'), 'updates', 'staging');
  await fsp.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `download-${Date.now()}.bcupdate.tmp`);
  const fin = path.join(dir, `latest.bcupdate`);
  try { await fsp.unlink(fin); } catch (_) {}
  await httpDownload(deltaUrl, tmp, DOWNLOAD_TIMEOUT_MS, onProgress, MAX_DELTA_MB);
  const actual = await sha256File(tmp);
  if (expectedSha256 && actual.toLowerCase() !== String(expectedSha256).toLowerCase()) {
    try { await fsp.unlink(tmp); } catch (_) {}
    throw new Error(`Update package SHA-256 mismatch. Refusing to install. (expected ${expectedSha256}, got ${actual})`);
  }
  await fsp.rename(tmp, fin);
  const stat = await fsp.stat(fin);
  log(`Downloaded ${path.basename(fin)} (${stat.size} bytes, sha256 ${actual})`);
  return { path: fin, size: stat.size, sha256: actual };
}

/**
 * Full-installer update path (Client PCs, and Server releases that flag
 * full_installer_required). The differential .bcupdate mechanism can NEVER
 * cover this - build-bcupdate.js intentionally excludes the Electron shell
 * and installer scripts from any diff (they change rarely and are only
 * ever delivered via the full Inno Setup installer). This downloads the
 * published Server/Client -Setup.exe, verifies it against the release's own
 * SHA256SUMS.txt (never trusts an unverified executable), and only then
 * hands off to the installer.
 */
async function downloadAndVerifyFullInstaller(installerUrl, sha256sumsUrl, filename, onProgress) {
  if (!installerUrl) throw new Error('No installer URL was published for this release.');
  if (!sha256sumsUrl) throw new Error('Release is missing SHA256SUMS.txt - refusing to download an unverifiable installer.');
  const dir = path.join(app.getPath('userData'), 'updates', 'staging');
  await fsp.mkdir(dir, { recursive: true });
  const sumsText = await httpGetText(sha256sumsUrl, CHECK_TIMEOUT_MS);
  const expected = parseSha256Sums(sumsText, filename);
  if (!expected) throw new Error(`SHA256SUMS.txt does not list ${filename} - refusing to download an unverifiable installer.`);
  const tmp = path.join(dir, `${filename}.tmp`);
  const fin = path.join(dir, filename);
  try { await fsp.unlink(fin); } catch (_) {}
  await httpDownload(installerUrl, tmp, DOWNLOAD_TIMEOUT_MS, onProgress, MAX_FULL_INSTALLER_MB);
  const actual = await sha256File(tmp);
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    try { await fsp.unlink(tmp); } catch (_) {}
    throw new Error(`Installer SHA-256 mismatch. Refusing to run. (expected ${expected}, got ${actual})`);
  }
  await fsp.rename(tmp, fin);
  const stat = await fsp.stat(fin);
  log(`Downloaded + verified ${filename} (${stat.size} bytes, sha256 ${actual})`);
  return { path: fin, size: stat.size, sha256: actual };
}

/**
 * Launches the (already SHA-256 verified) installer and quits this Electron
 * instance so Inno Setup can replace the running application's files. The
 * installer itself requests Administrator elevation (see PrivilegesRequired
 * = admin in the .iss files) and is safe to run repeatedly (repair-style).
 */
function launchInstallerAndQuit(installerPath) {
  const child = spawn(installerPath, [], { detached: true, stdio: 'ignore' });
  child.unref();
  setTimeout(() => app.quit(), 800);
}

/**
 * Reuses the EXISTING /api/auth/login endpoint (no new auth logic) to
 * obtain a Bearer token from the main process, for use when the person is
 * applying an update from the login screen before they have signed in.
 * Response parsing is in auth-utils.js (parseAuthResponse) so it can be
 * unit-tested without needing a live backend or the Electron `net` module.
 */
function postLogin(serverIp, email, password) {
  return new Promise((resolve, reject) => {
    const url = `http://${serverIp || '127.0.0.1'}:8001/api/auth/login`;
    const req = net.request({ method: 'POST', url });
    req.setHeader('Content-Type', 'application/json');
    req.setHeader('User-Agent', USER_AGENT);
    let body = '';
    req.on('response', (res) => {
      res.on('data', (c) => { body += c.toString('utf8'); });
      res.on('end', () => {
        const result = parseAuthResponse(res.statusCode, body);
        if (!result.ok) return reject(new Error(result.error));
        resolve({ token: result.token, user: result.user });
      });
    });
    req.on('error', reject);
    req.write(JSON.stringify({ email, password }));
    req.end();
  });
}

/**
 * Post the downloaded .bcupdate to the Main Server's /api/updates/upload
 * endpoint, then call /api/updates/install/{id} with the admin PIN.
 * Returns the backend's install response so the UI can show the changelog.
 *
 * Auth: /api/updates/upload + /install require BOTH a logged-in
 * administrator AND their PIN (backend core.require_admin_pin). Two ways to
 * satisfy the "logged-in administrator" half:
 *   - authToken: an existing JWT the caller already holds (e.g. the app's
 *     own localStorage bc_token, if the person happens to already be
 *     logged in when using Help > Check for Updates).
 *   - adminEmail + adminPassword: used to call the EXISTING /api/auth/login
 *     endpoint right here (no new auth logic) to obtain a fresh token -
 *     this is the path used from the login screen, before the person has
 *     signed in to the app itself.
 * Previously this relied on the BrowserWindow's session cookie being
 * forwarded automatically - that assumption was silently broken (the
 * login cookie is set Secure=true and is therefore never stored by the
 * browser over plain LAN http://), so upload/install would always have
 * received 401 "Not authenticated" regardless of caller. Explicit Bearer
 * tokens fix this for both entry points.
 */
async function installUpdate({ serverIp, bcupdatePath, adminPin, authToken, adminEmail, adminPassword, onStage }) {
  const ip = serverIp || '127.0.0.1';
  const backendBase = `http://${ip}:8001/api/updates`;
  const stage = (s, msg) => { if (onStage) onStage(s, msg); log(s, msg || ''); };

  if (!adminPin) throw new Error('Administrator PIN is required to apply an update.');

  let token = authToken || null;
  if (!token) {
    if (!adminEmail || !adminPassword) {
      throw new Error('Administrator email and password (or an active session) are required to apply an update.');
    }
    stage('authenticating', 'Verifying administrator credentials...');
    const loginResp = await postLogin(ip, adminEmail, adminPassword);
    if (!isAdminUser(loginResp.user)) {
      throw new Error('Only an administrator account can apply updates.');
    }
    token = loginResp.token;
  }

  // 1. Upload
  stage('uploading', 'Sending update package to Main Server...');
  const uploadResp = await postMultipart(`${backendBase}/upload`, bcupdatePath, 'file', adminPin, token);
  if (!uploadResp || !uploadResp.update_id) {
    throw new Error(`Upload rejected: ${uploadResp && uploadResp.detail || 'no update_id returned'}`);
  }
  stage('verifying', 'Main Server verifying package (signature + per-file SHA-256)...');

  // 2. Install
  stage('installing', 'Applying update (DB backup + rollback snapshot + file swap)...');
  const installResp = await postJson(`${backendBase}/install/${uploadResp.update_id}`, {}, adminPin, token);
  if (!installResp || !installResp.ok) {
    throw new Error(`Install rejected: ${installResp && installResp.detail || 'unknown backend error'}`);
  }
  stage('restarting', 'Backend is restarting; reconnecting in a moment...');
  return {
    ok: true,
    fromVersion: installResp.from_version,
    toVersion: installResp.to_version,
    restartDelaySeconds: installResp.restart_delay_seconds || 2,
    log: installResp.log,
  };
}

function postMultipart(url, filePath, fieldName, adminPin, authToken) {
  return new Promise((resolve, reject) => {
    const boundary = '----BalajiFeeHubUpdater' + crypto.randomBytes(16).toString('hex');
    const fileName = path.basename(filePath);
    const head = Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${fieldName}"; filename="${fileName}"\r\n` +
      `Content-Type: application/octet-stream\r\n\r\n`,
      'utf8'
    );
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
    const req = net.request({ method: 'POST', url });
    req.setHeader('Content-Type', `multipart/form-data; boundary=${boundary}`);
    req.setHeader('User-Agent', USER_AGENT);
    if (adminPin) req.setHeader('X-Admin-Pin', adminPin);
    if (authToken) req.setHeader('Authorization', `Bearer ${authToken}`);
    let body = '';
    req.on('response', (res) => {
      res.on('data', (c) => { body += c.toString('utf8'); });
      res.on('end', () => {
        try { resolve(body ? JSON.parse(body) : {}); }
        catch (_) { reject(new Error(`Upload endpoint returned non-JSON (HTTP ${res.statusCode})`)); }
      });
    });
    req.on('error', reject);
    req.write(head);
    const s = fs.createReadStream(filePath);
    s.on('data', (chunk) => req.write(chunk));
    s.on('end', () => { req.write(tail); req.end(); });
    s.on('error', reject);
  });
}

function postJson(url, payload, adminPin, authToken) {
  return new Promise((resolve, reject) => {
    const req = net.request({ method: 'POST', url });
    req.setHeader('Content-Type', 'application/json');
    req.setHeader('User-Agent', USER_AGENT);
    if (adminPin) req.setHeader('X-Admin-Pin', adminPin);
    if (authToken) req.setHeader('Authorization', `Bearer ${authToken}`);
    let body = '';
    req.on('response', (res) => {
      res.on('data', (c) => { body += c.toString('utf8'); });
      res.on('end', () => {
        try { resolve(body ? JSON.parse(body) : {}); }
        catch (_) { reject(new Error(`Install endpoint returned non-JSON (HTTP ${res.statusCode})`)); }
      });
    });
    req.on('error', reject);
    req.write(JSON.stringify(payload || {}));
    req.end();
  });
}

// --- IPC wiring -------------------------------------------------------------

function registerIpc({ getServerIp, showUpdateWindow }) {
  ipcMain.handle('updater:check', async () => checkForUpdates());
  ipcMain.handle('updater:context', async () => {
    const serverIp = getServerIp();
    return { installedVersion: readInstalledVersion(), serverIp, isMainServer: serverIp === '127.0.0.1' };
  });
  ipcMain.handle('updater:openReleaseNotes', async (_e, url) => {
    if (url) shell.openExternal(url);
    return { ok: true };
  });
  ipcMain.handle('updater:downloadAndInstall', async (event, { deltaUrl, expectedSha256, adminPin, authToken, adminEmail, adminPassword }) => {
    const sender = event.sender;
    try {
      const dl = await downloadUpdate(deltaUrl, expectedSha256, (received, total) => {
        sender.send('updater:progress', { phase: 'downloading', received, total });
      });
      sender.send('updater:progress', { phase: 'verified', sha256: dl.sha256, size: dl.size });
      const result = await installUpdate({
        serverIp: getServerIp(),
        bcupdatePath: dl.path,
        adminPin,
        authToken,
        adminEmail,
        adminPassword,
        onStage: (phase, msg) => sender.send('updater:progress', { phase, message: msg }),
      });
      return { ok: true, ...result };
    } catch (e) {
      errlog('downloadAndInstall failed:', e.message);
      return { ok: false, error: e.message };
    }
  });
  // Client PCs (and any Server release flagged full_installer_required) can
  // never be updated via the .bcupdate diff mechanism - it structurally
  // excludes the Electron shell and installer scripts. This path downloads
  // the already-published, SHA-256-verified Server/Client-Setup.exe and
  // hands off to it, never modifying the Main Server's backend/frontend.
  ipcMain.handle('updater:downloadAndRunFullInstaller', async (event, { installerUrl, sha256sumsUrl, filename }) => {
    const sender = event.sender;
    try {
      const dl = await downloadAndVerifyFullInstaller(installerUrl, sha256sumsUrl, filename, (received, total) => {
        sender.send('updater:progress', { phase: 'downloading-installer', received, total });
      });
      sender.send('updater:progress', { phase: 'launching' });
      launchInstallerAndQuit(dl.path);
      return { ok: true };
    } catch (e) {
      errlog('downloadAndRunFullInstaller failed:', e.message);
      return { ok: false, error: e.message };
    }
  });
}

module.exports = {
  checkForUpdates,
  downloadUpdate,
  downloadAndVerifyFullInstaller,
  installUpdate,
  registerIpc,
  readInstalledVersion,
  compare,
  parseAuthResponse,
  isAdminUser,
  parseSha256Sums,
  // Shared net/hash utilities, reused by client-update.js so the CLIENT
  // (Electron shell) update path doesn't duplicate this networking code.
  httpGetJson,
  httpDownload,
  httpPostJson,
  sha256File,
};
