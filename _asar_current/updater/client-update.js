/**
 * client-update.js — Client (Electron shell) self-update via signed
 * .bcupdate packages distributed by the EXISTING Main Server (never GitHub,
 * never a separate server). See backend/routers/updates.py's client_router
 * for the server side, and scripts/build_client_bcupdate.py for how a
 * package is built and signed.
 *
 * Design constraints this respects:
 *  - Zero npm dependencies (see package.json) - all ZIP/crypto handling uses
 *    only Node built-ins plus the bundled zip-lite.js reader (STORED-only
 *    ZIP entries, so no DEFLATE decompressor is needed either).
 *  - Never blocks app startup - every network call here is only ever
 *    triggered by a periodic timer or the manual "Check for Updates" menu
 *    item, both already off the startup path (see main.js).
 *  - Never touches the Main Server's own files/database - a plain read-only
 *    GET for metadata/package, entirely separate from the admin-only
 *    publish/unpublish endpoints.
 *  - Never overwrites the running app.asar directly (Windows keeps it open/
 *    locked while Electron is running) - a small detached helper process,
 *    launched via this SAME Electron binary in ELECTRON_RUN_AS_NODE mode
 *    (so no separate Node.js install is ever required), performs the actual
 *    file swap after this process has fully exited, with an automatic
 *    rollback if the swap doesn't verify.
 */
const { app } = require('electron');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const os = require('os');
const { httpGetJson, httpDownload, httpPostJson, sha256File } = require('./updater');
const { isUpgrade, compare } = require('./version-compare');
const { extractEntries } = require('./zip-lite');

const CHECK_TIMEOUT_MS = 8000;
const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_PACKAGE_MB = 300;
const CLIENT_UPDATE_PORT = 8001;

// The vendor's CLIENT-update public key, baked into the shipped Electron
// bundle at build time (analogous to updater/config.json's GITHUB_REPO, but
// a cryptographic trust anchor instead of a repo name). Only the PUBLIC half
// is ever present here - the PRIVATE half stays on the build machine
// (backend/keys/client_update_private.pem) and is never shipped anywhere.
// Deliberately a SEPARATE keypair from the server-update system's key.
const CLIENT_UPDATE_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAwnuV2FD7eZrEUNUhuCe9
48yB4DSUDPOs2y8NxECYAYMODJyaGjk0P76oBi17xrJZIKo/MLkE14/0lr+ePLOJ
apOYzRO8/3/noiDYu3orHNZKQN+/g1DPs8TXZfr+4pN9nlr1mABSfVFIFOWkNKXU
XHbvFKbIBMhPa4rz3Mv06VGY0/LEyIGzahELigMdTK/pNkF9IFiGKVlbNtk1VSIo
Jt5ht2wGcpkKw+IK6TxxsCrTTnbJ5jAeX8k+uqUKlA5s9kxQFuUzhZvTWAfZpOup
/oFJcTQp+XhXOdi82qIQMEoZkLzrpBkE4H0fu/uZV78YPKjZyKY58dj0i8FGAdx5
eQIDAQAB
-----END PUBLIC KEY-----`;

function log(...args) { console.log('[client-update]', ...args); }

function readInstalledVersion() {
  try { return require('../package.json').version || '0.0.0'; } catch (_) { return '0.0.0'; }
}

// --- 1. Check ----------------------------------------------------------------
async function checkForClientUpdate(serverIp) {
  const installed = readInstalledVersion();
  if (!serverIp) return { available: false, installed, error: 'No Main Server configured yet.' };
  const url = `http://${serverIp}:${CLIENT_UPDATE_PORT}/api/client-updates/latest`;
  try {
    const info = await httpGetJson(url, CHECK_TIMEOUT_MS);
    if (!info || !info.published) return { available: false, installed, published: false };
    const available = isUpgrade(installed, info.version);
    return {
      available, installed, remote: info.version,
      releaseNotes: info.release_notes || '', releaseDate: info.release_date,
      minSupportedVersion: info.min_supported_version || '0.0.0',
      packageSize: info.package_size, expectedSha256: info.sha256,
      downloadUrl: `http://${serverIp}:${CLIENT_UPDATE_PORT}${info.download_url}`,
    };
  } catch (e) {
    // Main Server unreachable/off - the expected, common case on a school
    // LAN. Never an error the user should see - silent, exactly like every
    // other connectivity check in this app (see lib/syncEngine.js).
    return { available: false, installed, error: e.message, offline: true };
  }
}

// --- 2. Download ---------------------------------------------------------------
async function downloadClientUpdate(downloadUrl, expectedSha256, onProgress) {
  const dir = path.join(app.getPath('userData'), 'client-updates', 'staging');
  await fsp.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `download-${Date.now()}.bcupdate.tmp`);
  const fin = path.join(dir, 'latest.bcupdate');
  try { await fsp.unlink(fin); } catch (_) {}
  await httpDownload(downloadUrl, tmp, DOWNLOAD_TIMEOUT_MS, onProgress, MAX_PACKAGE_MB);
  const actual = await sha256File(tmp);
  if (expectedSha256 && actual.toLowerCase() !== String(expectedSha256).toLowerCase()) {
    try { await fsp.unlink(tmp); } catch (_) {}
    throw new Error(`Update package SHA-256 mismatch (expected ${expectedSha256}, got ${actual}). Refusing to install.`);
  }
  await fsp.rename(tmp, fin);
  const stat = await fsp.stat(fin);
  log(`Downloaded ${fin} (${stat.size} bytes, sha256 ${actual})`);
  return { path: fin, size: stat.size, sha256: actual };
}

// --- 3. Verify + extract -------------------------------------------------------
function verifyManifestSignature(manifestBytes, signatureB64) {
  const ok = crypto.verify(
    'sha256',
    manifestBytes,
    { key: CLIENT_UPDATE_PUBLIC_KEY_PEM, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: crypto.constants.RSA_PSS_SALTLEN_AUTO },
    Buffer.from(signatureB64, 'base64')
  );
  if (!ok) throw new Error('Update signature is invalid - this package was not produced by the software vendor.');
}

function verifyAndExtractPackage(bcupdatePath, installedVersion) {
  const buf = fs.readFileSync(bcupdatePath);
  const entries = extractEntries(buf, ['manifest.json', 'manifest.sig', 'payload/resources/app.asar']);
  if (!entries['manifest.json'] || !entries['manifest.sig'] || !entries['payload/resources/app.asar']) {
    throw new Error('Update package is malformed (missing manifest.json / manifest.sig / payload/resources/app.asar).');
  }
  const manifestBytes = entries['manifest.json'];
  const signatureB64 = entries['manifest.sig'].toString('utf8').trim();
  verifyManifestSignature(manifestBytes, signatureB64);

  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (manifest.package_type !== 'client') throw new Error('This package is not a client update package.');
  const expectedSha = manifest.files && manifest.files['resources/app.asar'];
  if (!expectedSha) throw new Error('Manifest does not list resources/app.asar.');

  const appAsarBuf = entries['payload/resources/app.asar'];
  const actualSha = crypto.createHash('sha256').update(appAsarBuf).digest('hex');
  if (actualSha !== expectedSha) {
    throw new Error(`app.asar checksum mismatch (expected ${expectedSha}, got ${actualSha}). Refusing to install.`);
  }
  if (compare(installedVersion, manifest.min_supported_version || '0.0.0') < 0) {
    throw new Error(`This update requires at least version ${manifest.min_supported_version}. You are on ${installedVersion}.`);
  }
  return { manifest, appAsarBuf, expectedSha };
}

// --- 4. Apply (via a detached helper, since the running app.asar is locked) ----
// Uses 'original-fs' (Electron's genuinely unpatched fs module), NOT plain
// 'fs' - Electron's own ASAR-awareness patches on 'fs' mishandle operations
// that target a *.asar file directly (as opposed to a path *inside* one),
// throwing a misleading "ENOENT, <empty> not found in ...app.asar" even
// though the file exists and is perfectly readable. 'original-fs' is
// Electron's documented escape hatch for exactly this - real file I/O, no
// virtual-filesystem interpretation of the .asar extension. This surfaced
// via real testing (see conversation), not a hypothetical.
const HELPER_SOURCE = `
const fs = require('original-fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const [,, installDir, newAsarPath, backupDir, exePath, expectedSha, resultPath] = process.argv;

function sha256(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}
function writeResult(obj) {
  try {
    fs.mkdirSync(path.dirname(resultPath), { recursive: true });
    // journal: append this stage to a running list so an app that starts up
    // after the helper died mid-flight can see exactly how far it got, not
    // just "pending" forever - this is what makes "interrupted update
    // recovery" possible instead of the app just being stuck.
    let journal = [];
    try { journal = (JSON.parse(fs.readFileSync(resultPath, 'utf8')).journal) || []; } catch (e) {}
    journal.push({ stage: obj.stage, at: new Date().toISOString(), ok: obj.ok });
    fs.writeFileSync(resultPath, JSON.stringify({ ...obj, journal }));
  } catch (e) {}
}

// Relaunch is retried (not fire-and-forget) - a failed spawn is exactly the
// "app closes and never reopens" symptom this exists to prevent. Verifies
// the child actually stayed alive briefly before declaring success.
async function relaunchWithRetry(maxAttempts) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const ok = await new Promise((resolve) => {
      let settled = false;
      let child;
      try {
        child = spawn(exePath, [], { detached: true, stdio: 'ignore', cwd: installDir });
      } catch (e) {
        resolve(false); return;
      }
      child.on('error', () => { if (!settled) { settled = true; resolve(false); } });
      child.on('spawn', () => {
        // A process object existing briefly isn't proof it stayed up (AV can
        // kill it a moment later) - a short delay before declaring success
        // catches the common "spawned then immediately killed" case without
        // meaningfully slowing down the good-path relaunch.
        setTimeout(() => { if (!settled) { settled = true; child.unref(); resolve(true); } }, 500);
      });
    });
    if (ok) return true;
    if (attempt < maxAttempts) await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

async function main() {
  const asarPath = path.join(installDir, 'resources', 'app.asar');
  const backupPath = path.join(backupDir, 'app.asar');
  writeResult({ ok: false, stage: 'started' });
  // Small grace period so the just-exited parent's file handles are fully
  // released before this process touches anything.
  await new Promise((r) => setTimeout(r, 700));

  try {
    fs.mkdirSync(backupDir, { recursive: true });
    writeResult({ ok: false, stage: 'backup_starting' });
    fs.copyFileSync(asarPath, backupPath);
    writeResult({ ok: false, stage: 'backup_complete' });
  } catch (e) {
    writeResult({ ok: false, stage: 'failed_backup', error: String((e && e.message) || e) });
    const relaunched = await relaunchWithRetry(3);
    if (!relaunched) writeResult({ ok: false, stage: 'failed_backup', error: String((e && e.message) || e), relaunchFailed: true });
    return;
  }

  let installedOk = false;
  try {
    writeResult({ ok: false, stage: 'installing' });
    fs.copyFileSync(newAsarPath, asarPath);
    const actual = sha256(asarPath);
    if (actual !== expectedSha) throw new Error('post-copy sha256 mismatch: ' + actual);
    installedOk = true;
    writeResult({ ok: true, stage: 'installed' });
  } catch (e) {
    try {
      fs.copyFileSync(backupPath, asarPath);
      writeResult({ ok: false, stage: 'failed_rolled_back', error: String((e && e.message) || e), rolledBack: true });
    } catch (e2) {
      writeResult({ ok: false, stage: 'failed_rollback_failed', error: String((e && e.message) || e), rolledBack: false, rollbackError: String((e2 && e2.message) || e2) });
    }
  }

  writeResult({ ok: installedOk, stage: 'relaunching' });
  const relaunched = await relaunchWithRetry(3);
  if (!relaunched) {
    // The file swap itself may well have succeeded - only the relaunch
    // failed. Preserve whatever the last real outcome was, just flag that
    // the app did not come back up on its own so the NEXT manual launch
    // (or an admin) can tell the difference from a fresh "nothing happened".
    writeResult({ ok: installedOk, stage: installedOk ? 'installed_relaunch_failed' : 'relaunch_failed', relaunchFailed: true });
  }
}

main().catch((e) => { writeResult({ ok: false, stage: 'failed_unexpected', error: String((e && e.message) || e) }); relaunchWithRetry(3); });
`;

/**
 * Stages the new app.asar, writes+launches the detached helper, then quits
 * this Electron instance so the helper can safely swap files. Returns
 * immediately after scheduling the quit - the caller should tell the user
 * the app is restarting.
 */
async function applyClientUpdateAndRestart(appAsarBuf, expectedSha, toVersion) {
  const installDir = path.dirname(process.execPath);   // e.g. C:\Program Files\BalajiFeeHub\Client
  const exePath = process.execPath;
  const workDir = path.join(app.getPath('userData'), 'client-updates');
  // Deliberately NOT named *.asar - Electron's fs patches special-case any
  // path ending in .asar as "this is an archive, look inside it" even for
  // plain read/write/copy of the archive file itself, which produced a
  // misleading ENOENT during real testing (see HELPER_SOURCE's comment
  // above). A staging file with a different extension sidesteps that
  // entirely; the helper still uses 'original-fs' for the actual app.asar
  // paths as defence in depth.
  const stagingAsar = path.join(workDir, 'staging', 'app-update-payload.bin');
  const backupDir = path.join(workDir, 'rollback', `${readInstalledVersion()}__${Date.now()}`);
  const resultPath = path.join(workDir, 'update-result.json');
  const helperPath = path.join(workDir, 'apply-update-helper.js');

  fs.mkdirSync(path.dirname(stagingAsar), { recursive: true });
  fs.writeFileSync(stagingAsar, appAsarBuf);
  fs.mkdirSync(path.dirname(helperPath), { recursive: true });
  fs.writeFileSync(helperPath, HELPER_SOURCE, 'utf8');

  // Record intent BEFORE spawning, so even if the helper never starts for
  // some reason, the next launch's marker-check can report the failure
  // instead of silently pretending nothing happened.
  fs.writeFileSync(resultPath, JSON.stringify({ ok: false, stage: 'pending', toVersion, journal: [{ stage: 'started', at: new Date().toISOString() }] }));

  // Wait for actual confirmation the helper process started before quitting -
  // this was the real gap behind "app closes and never reopens": the old
  // code fired app.quit() on a fixed timer regardless of whether spawn()
  // even succeeded, with no 'error' handler on this particular child, so an
  // async spawn failure (AV interference, ENOENT, permissions) could bring
  // the whole app down with nothing left to bring it back.
  const spawned = await new Promise((resolve) => {
    let settled = false;
    let child;
    try {
      child = spawn(
        exePath,
        [helperPath, installDir, stagingAsar, backupDir, exePath, expectedSha, resultPath],
        { detached: true, stdio: 'ignore', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } }
      );
    } catch (e) {
      resolve(false); return;
    }
    child.on('error', () => { if (!settled) { settled = true; resolve(false); } });
    child.on('spawn', () => { if (!settled) { settled = true; child.unref(); resolve(true); } });
  });

  if (!spawned) {
    fs.writeFileSync(resultPath, JSON.stringify({ ok: false, stage: 'failed_helper_spawn', toVersion, error: 'Could not start the update helper process.' }));
    throw new Error('Could not start the update installer. The application has not been changed and remains on the current version.');
  }

  setTimeout(() => app.quit(), 600);
}

/**
 * Called once at startup (see main.js) to report the outcome of an update
 * that was applied on the PREVIOUS run, then clears the marker so it is
 * only ever reported once.
 */
function consumePendingUpdateResult() {
  const resultPath = path.join(app.getPath('userData'), 'client-updates', 'update-result.json');
  try {
    if (!fs.existsSync(resultPath)) return null;
    const data = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
    fs.unlinkSync(resultPath);
    return data;
  } catch (_) {
    return null;
  }
}

// --- 5. Success/failure reporting back to the Main Server ----------------------
// Explicit allowlist only - this must never be able to carry a password,
// Master PIN, auth token, DB credential, or any student/fee data, regardless
// of what shape `result`/extra happens to have. Queued to a local file and
// retried automatically if the Main Server is unreachable at report time -
// never blocks/fails the update flow itself.
const REPORT_QUEUE_FILE = () => path.join(app.getPath('userData'), 'client-updates', 'pending-reports.json');

function _sanitizeReport(raw) {
  return {
    pc_hostname: os.hostname(),
    installed_version: raw.installedVersion || readInstalledVersion(),
    target_version: raw.toVersion || null,
    stage: raw.stage || null,
    ok: !!raw.ok,
    error_message: raw.error ? String(raw.error).slice(0, 500) : null,
    rolled_back: !!raw.rolledBack,
    relaunch_failed: !!raw.relaunchFailed,
    journal: Array.isArray(raw.journal) ? raw.journal.slice(-20) : [],
    reported_at: new Date().toISOString(),
  };
}

function _readQueue() {
  try { return JSON.parse(fs.readFileSync(REPORT_QUEUE_FILE(), 'utf8')); } catch (_) { return []; }
}
function _writeQueue(list) {
  try { fs.mkdirSync(path.dirname(REPORT_QUEUE_FILE()), { recursive: true }); fs.writeFileSync(REPORT_QUEUE_FILE(), JSON.stringify(list)); } catch (_) {}
}

async function reportUpdateOutcome(raw) {
  const report = _sanitizeReport(raw);
  await flushQueuedReports(raw.currentServerIp);
  const serverIp = raw.currentServerIp;
  if (!serverIp) { _writeQueue([..._readQueue(), report]); return; }
  try {
    await httpPostJson(`http://${serverIp}:${CLIENT_UPDATE_PORT}/api/client-updates/report`, report, 8000);
  } catch (e) {
    _writeQueue([..._readQueue(), report]);
  }
}

// Called opportunistically (every check tick) so a report queued while the
// Main Server was down goes out automatically the moment it's back, with no
// user action needed.
async function flushQueuedReports(serverIp) {
  if (!serverIp) return;
  const queue = _readQueue();
  if (!queue.length) return;
  const remaining = [];
  for (const report of queue) {
    try {
      await httpPostJson(`http://${serverIp}:${CLIENT_UPDATE_PORT}/api/client-updates/report`, report, 8000);
    } catch (e) {
      remaining.push(report);
    }
  }
  _writeQueue(remaining);
}

module.exports = {
  checkForClientUpdate,
  downloadClientUpdate,
  verifyAndExtractPackage,
  applyClientUpdateAndRestart,
  consumePendingUpdateResult,
  readInstalledVersion,
  reportUpdateOutcome,
  flushQueuedReports,
};
