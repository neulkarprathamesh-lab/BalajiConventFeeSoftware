#!/usr/bin/env node
'use strict';
/**
 * Builds the Balaji FeeHub Client (offline-first, bundled UI):
 *
 *   1. frontend/       -> production bundle for the desktop client   (REACT_APP_DESKTOP=1, PUBLIC_URL=.)
 *   2. _asar_current/  + bundle -> resources/app.asar                 (packed with @electron/asar)
 *   3. 04-desktop/     -> staged Electron runtime (BalajiFeeHub.exe + Chromium files)
 *   4. installer/*.iss -> dist/BalajiFeeHub-Client-Setup.exe           (Inno Setup 6)
 *   5. staged folder   -> dist/BalajiFeeHub-Client-Windows-x64.zip
 *
 * Usage:  node build-client.js            production artifacts in dist/
 *         node build-client.js --test     also a per-user TEST installer in dist/test/
 *                                         (no administrator prompt; used by the automated install test)
 *
 * Nothing is copied from the Main Server's database or data folders. The
 * package contains the client UI, the Electron runtime and the updater only.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const asar = require('@electron/asar');

const ROOT = path.resolve(__dirname, '..');                // ...\03-source-code
const FRONTEND = path.join(ROOT, 'frontend');
const SHELL = path.join(ROOT, '_asar_current');
const BUNDLE_OUT = path.join(FRONTEND, 'build-desktop');
const RUNTIME = process.env.FEEHUB_CLIENT_RUNTIME || 'C:\\balaji-fee\\04-desktop';
const DIST = path.join(ROOT, 'dist');
const STAGE_ROOT = path.join(DIST, 'staging');
const STAGE = path.join(STAGE_ROOT, 'BalajiFeeHub-Client');
const APP_SRC = path.join(STAGE_ROOT, 'app-src');
const ISS = path.join(ROOT, 'installer', 'BalajiFeeHub-Client.iss');
const DOCS = path.join(__dirname, 'docs');
const ISCC = process.env.ISCC || [
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Inno Setup 6', 'ISCC.exe'),
  'C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe',
  'C:\\Program Files\\Inno Setup 6\\ISCC.exe',
].find((p) => fs.existsSync(p));

const WANT_TEST = process.argv.includes('--test');
const log = (msg) => console.log(`[build-client] ${msg}`);

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${cmd} exited with ${r.status}`);
}

function rimraf(p) { fs.rmSync(p, { recursive: true, force: true }); }

function copyDir(src, dest, filter) {
  fs.cpSync(src, dest, { recursive: true, filter: filter || (() => true) });
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

// Files of the shell that ship inside app.asar. Tests and backups never ship.
const SHELL_FILES = ['main.js', 'preload.js', 'config-store.js', 'package.json', 'icon.ico'];
const SHELL_DIRS = ['renderer', 'updater'];

function main() {
  const version = JSON.parse(fs.readFileSync(path.join(SHELL, 'package.json'), 'utf8')).version;
  log(`client version ${version}`);

  // 1. Production bundle of the UI for the desktop client.
  log('building the bundled UI (REACT_APP_DESKTOP=1, PUBLIC_URL=.) ...');
  rimraf(BUNDLE_OUT);
  run(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['craco', 'build'], {
    cwd: FRONTEND,
    shell: true,
    env: {
      ...process.env,
      REACT_APP_DESKTOP: '1',
      REACT_APP_VERSION: version,
      PUBLIC_URL: '.',
      BUILD_PATH: 'build-desktop',
      GENERATE_SOURCEMAP: 'false',
      CI: 'false',
    },
  });

  // 2. The desktop bundle never loads third-party scripts (the shared web page
  //    carries a preview-tool script that must not run inside the fee software).
  const indexHtml = path.join(BUNDLE_OUT, 'index.html');
  const html = fs.readFileSync(indexHtml, 'utf8').replace(/<script[^>]*src="https:\/\/assets\.emergent\.sh[^"]*"[^>]*><\/script>/g, '');
  if (/assets\.emergent\.sh/.test(html)) throw new Error('third-party script still present in bundle index.html');
  fs.writeFileSync(indexHtml, html, 'utf8');
  const externalScripts = [...html.matchAll(/<script[^>]+src="(https?:[^"]+)"/g)].map((m) => m[1]);
  if (externalScripts.length) throw new Error(`external scripts in bundle: ${externalScripts.join(', ')}`);

  // 3. Place the bundle inside the shell so it is packed into app.asar.
  rimraf(path.join(SHELL, 'renderer', 'app'));
  copyDir(BUNDLE_OUT, path.join(SHELL, 'renderer', 'app'));

  // 4. Stage the Electron runtime (the existing, already-deployed BalajiFeeHub.exe).
  log(`staging Electron runtime from ${RUNTIME} ...`);
  if (!fs.existsSync(path.join(RUNTIME, 'BalajiFeeHub.exe'))) throw new Error(`runtime not found: ${RUNTIME}`);
  rimraf(STAGE_ROOT);
  copyDir(RUNTIME, STAGE, (src) => !/\.bak/i.test(path.basename(src)) && path.basename(src) !== 'app.asar');

  // 5. Pack the shell + bundle into resources/app.asar (no tests, no build leftovers).
  rimraf(APP_SRC);
  fs.mkdirSync(APP_SRC, { recursive: true });
  for (const f of SHELL_FILES) fs.copyFileSync(path.join(SHELL, f), path.join(APP_SRC, f));
  for (const d of SHELL_DIRS) copyDir(path.join(SHELL, d), path.join(APP_SRC, d));
  const asarOut = path.join(STAGE, 'resources', 'app.asar');
  fs.mkdirSync(path.dirname(asarOut), { recursive: true });
  await_pack(APP_SRC, asarOut);
  rimraf(APP_SRC);

  const listed = asar.listPackage(asarOut).map((p) => p.replace(/\\/g, '/'));
  for (const must of ['/main.js', '/preload.js', '/config-store.js', '/package.json', '/renderer/app/index.html']) {
    if (!listed.includes(must)) throw new Error(`app.asar is missing ${must}`);
  }
  if (listed.some((p) => /\/test\//.test(p) || /\/node_modules\//.test(p))) throw new Error('tests or node_modules leaked into app.asar');
  log(`app.asar packed: ${listed.length} entries, ${(fs.statSync(asarOut).size / 1048576).toFixed(1)} MB`);

  // 6. Operator documents, shipped next to the app and inside the ZIP.
  for (const doc of ['README-Client-Installation.txt', 'CLIENT-DEPENDENCIES.txt']) {
    const text = fs.readFileSync(path.join(DOCS, doc), 'utf8').replace(/\{\{VERSION\}\}/g, version);
    fs.writeFileSync(path.join(DIST, doc), text, 'utf8');
    fs.writeFileSync(path.join(STAGE, doc), text, 'utf8');
  }

  // 7. Installer.
  if (!ISCC) throw new Error('Inno Setup 6 (ISCC.exe) not found. Install it, or set the ISCC environment variable.');
  log('compiling the installer with Inno Setup ...');
  const iscc = (extra) => run(ISCC, [
    '/Q',
    `/DMyAppVersion=${version}`,
    `/DStagingDir=${STAGE}`,
    ...extra,
    ISS,
  ]);
  iscc([`/DOutputDir=${DIST}`, '/DOutputName=BalajiFeeHub-Client-Setup']);
  if (WANT_TEST) {
    const testDir = path.join(DIST, 'test');
    fs.mkdirSync(testDir, { recursive: true });
    iscc([`/DOutputDir=${testDir}`, '/DOutputName=BalajiFeeHub-Client-TEST-UserInstall-Setup', '/DUserInstall=1']);
  }

  // 8. ZIP: the complete client folder, extract-and-run (no installer needed).
  const zip = path.join(DIST, 'BalajiFeeHub-Client-Windows-x64.zip');
  rimraf(zip);
  log('creating the portable ZIP ...');
  // .NET's zipper writes standard forward-slash entry names (Compress-Archive writes backslashes).
  run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory('${STAGE}', '${zip}', 'Optimal', $true)`]);

  // Admin-only test procedure: next to the artifacts, never inside the installer or ZIP.
  const manual = fs.readFileSync(path.join(DOCS, 'MANUAL-TEST-SERVER-OFF-ON.txt'), 'utf8').replace(/\{\{VERSION\}\}/g, version);
  fs.writeFileSync(path.join(DIST, 'MANUAL-TEST-SERVER-OFF-ON.txt'), manual, 'utf8');

  // 9. Report.
  const setup = path.join(DIST, 'BalajiFeeHub-Client-Setup.exe');
  const artifacts = [setup, zip, path.join(DIST, 'README-Client-Installation.txt'), path.join(DIST, 'CLIENT-DEPENDENCIES.txt'), path.join(DIST, 'MANUAL-TEST-SERVER-OFF-ON.txt')];
  for (const f of artifacts) {
    if (!fs.existsSync(f)) throw new Error(`missing artifact ${f}`);
    log(`${path.relative(ROOT, f)}  ${(fs.statSync(f).size / 1048576).toFixed(1)} MB  sha256 ${sha256(f)}`);
  }
  log('done');
}

// asar.createPackage is async; the build is sequential, so block on it here.
function await_pack(src, dest) {
  const worker = `require('@electron/asar').createPackage(${JSON.stringify(src)}, ${JSON.stringify(dest)}).then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });`;
  run(process.execPath, ['-e', worker], { cwd: __dirname });
}

try {
  main();
} catch (err) {
  console.error(`[build-client] FAILED: ${err.message}`);
  process.exit(1);
}
