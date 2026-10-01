// client-update.js - renderer for the Client (.bcupdate) update progress
// window. Purely a display layer: every percentage/stage it shows comes
// from real IPC events sent by main.js/updater/client-update.js as the
// actual download/verify/signature-check happen - never a fake animation.
//
// IMPORTANT: backup/install/relaunch happen in a DETACHED HELPER PROCESS
// *after* this Electron instance quits (the running app can't overwrite its
// own locked app.asar - see updater/client-update.js). That means this
// window cannot show live progress for those specific stages; it shows them
// as "in progress" right before the app quits, and the actual outcome
// (success/failure/rollback) is reported via the dialog that
// reportPendingClientUpdateResult() shows after the app relaunches - this
// window itself cannot outlive the process restart it's initiating.

const $ = (id) => document.getElementById(id);
const bytesToMB = (n) => (typeof n === 'number' && n > 0) ? `${(n / (1024 * 1024)).toFixed(1)} MB` : '';

const STAGE_ORDER = ['downloading', 'verifying', 'signature', 'backup', 'installing', 'restarting'];

function setStageChips(activeStage, doneUpTo) {
  const doneIdx = STAGE_ORDER.indexOf(doneUpTo || activeStage);
  document.querySelectorAll('.stage-chip').forEach((el) => {
    const stage = el.dataset.stage;
    const idx = STAGE_ORDER.indexOf(stage);
    el.classList.remove('active', 'done', 'failed');
    if (stage === activeStage) el.classList.add('active');
    else if (idx < doneIdx) el.classList.add('done');
  });
}

function setProgress(pct) {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  $('progress-bar').style.width = `${clamped}%`;
  $('progress-pct').textContent = `${clamped}%`;
}

function showFailure(message) {
  document.getElementById('progress').classList.add('hidden');
  document.getElementById('failure').classList.remove('hidden');
  $('error-message').textContent = message || 'The update could not be applied safely, so nothing was changed.';
  document.querySelectorAll('.stage-chip.active').forEach((el) => { el.classList.remove('active'); el.classList.add('failed'); });
}

function handleProgress(data) {
  if (!data) return;
  if (data.installed) $('installed-version').textContent = data.installed;
  if (data.remote) $('remote-version').textContent = data.remote;

  switch (data.stage) {
    case 'downloading': {
      setStageChips('downloading');
      $('stage-line').textContent = 'Downloading update package...';
      if (data.total > 0) {
        const pct = (data.received / data.total) * 100;
        setProgress(pct);
        $('phase-line').textContent = `${bytesToMB(data.received)} / ${bytesToMB(data.total)}`;
      } else {
        $('phase-line').textContent = bytesToMB(data.received) ? `${bytesToMB(data.received)} downloaded` : 'Starting download...';
      }
      break;
    }
    case 'verifying':
      setStageChips('verifying', 'downloading');
      setProgress(100);
      $('stage-line').textContent = 'Verifying package integrity (SHA-256)...';
      $('phase-line').textContent = 'Checking the download is complete and untampered.';
      break;
    case 'signature':
      setStageChips('signature', 'verifying');
      setProgress(100);
      $('stage-line').textContent = 'Verifying digital signature...';
      $('phase-line').textContent = 'Confirming this package was signed by the vendor.';
      break;
    case 'finalizing':
      // Backup + Installing + Restarting all happen after this process
      // quits (in the detached helper) - shown together as the last visible
      // step before handoff, honestly rather than faking individual timing
      // we cannot observe from here.
      setStageChips('backup', 'signature');
      document.querySelectorAll('[data-stage="backup"],[data-stage="installing"],[data-stage="restarting"]').forEach((el) => el.classList.add('active'));
      setProgress(100);
      $('stage-line').textContent = 'Backing up, installing, and restarting...';
      $('phase-line').textContent = 'Balaji FeeHub will close and reopen automatically. This usually takes a few seconds.';
      $('hint').textContent = 'Do not turn off this PC. Balaji FeeHub will reopen on its own.';
      break;
    case 'failed':
      showFailure(data.message);
      break;
    default:
      break;
  }
}

window.feehub.clientUpdater.onProgress(handleProgress);
$('close-btn').addEventListener('click', () => window.close());
