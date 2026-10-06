/**
 * Balaji FeeHub client - server address configuration.
 *
 * The Main Server address lives ONLY in the per-user AppData config file:
 *     %APPDATA%\BalajiFeeHub\config.json
 * It is never compiled into the app or hard-coded in main.js. The file sits
 * outside the install directory, so it survives application restarts, Windows
 * restarts and client updates / reinstalls.
 *
 * Defaults (used when no config exists yet or a value is missing):
 *     serverHost = 192.168.0.116
 *     serverPort = 8001
 *
 * Pure functions only (plus small file helpers) so they can be unit tested
 * without starting Electron - see test/config-store.test.js.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_SERVER_HOST = '192.168.0.116';
const DEFAULT_SERVER_PORT = 8001;
// The web frontend (serve_frontend.py) runs on the Main Server on this port.
// Only used to build links that must open on the server (QR codes, parent
// lookup pages). The desktop client itself never loads it.
const FRONTEND_PORT = 3000;

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const HOSTNAME = /^(?=.{1,253}$)[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;

/**
 * Validates and normalizes an admin- or user-entered server address.
 * Accepts "192.168.0.116", "192.168.0.116:8001", "http://192.168.0.116:8001/"
 * or a host name. Returns { ok, host, port } or { ok:false, error }.
 */
function normalizeServerAddress(hostInput, portInput) {
  let host = String(hostInput || '').trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  let port = portInput;
  const withPort = host.match(/^(.*):(\d+)$/);
  if (withPort) {
    host = withPort[1];
    if (port === undefined || port === null || port === '') port = withPort[2];
  }
  host = host.trim();
  // A dotted-quad shape that is not a valid IPv4 (e.g. 999.1.1.1) is an error,
  // never a host name, even though its all-digit labels would pass HOSTNAME.
  const looksNumeric = /^[\d.]+$/.test(host);
  if (!host || (looksNumeric && !IPV4.test(host)) || (!IPV4.test(host) && !HOSTNAME.test(host))) {
    return { ok: false, error: 'Enter a valid IP address or host name, for example 192.168.0.116.' };
  }
  const effectivePort = (port === undefined || port === null || port === '') ? DEFAULT_SERVER_PORT : Number(port);
  if (!Number.isInteger(effectivePort) || effectivePort < 1 || effectivePort > 65535) {
    return { ok: false, error: 'Port must be a whole number between 1 and 65535.' };
  }
  return { ok: true, host, port: effectivePort };
}

/**
 * Config file location: <appData>\BalajiFeeHub\config.json (Electron:
 * app.getPath('appData')). `overrideDir` is the support-only environment setting
 * BALAJI_FEEHUB_CONFIG_DIR, used to keep a test client's settings apart from a
 * live Client PC. Electron on Windows does not read the APPDATA variable.
 */
function configPaths(appDataDir, overrideDir) {
  const dir = overrideDir || path.join(appDataDir, 'BalajiFeeHub');
  return { dir, file: path.join(dir, 'config.json') };
}

/**
 * Applies defaults and migrates the legacy { serverIp } key written by earlier
 * client versions. Never throws - unreadable JSON falls back to defaults so a
 * damaged file can never stop the client from opening.
 */
function resolveConfig(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const legacyHost = typeof src.serverIp === 'string' ? src.serverIp : null;
  const host = typeof src.serverHost === 'string' && src.serverHost.trim() ? src.serverHost.trim() : (legacyHost || DEFAULT_SERVER_HOST);
  const portNum = Number(src.serverPort);
  const port = Number.isInteger(portNum) && portNum >= 1 && portNum <= 65535 ? portNum : DEFAULT_SERVER_PORT;
  const { serverIp, ...rest } = src; // eslint-disable-line no-unused-vars
  return { ...rest, serverHost: host, serverPort: port };
}

function serverBase(cfg) {
  return `http://${cfg.serverHost}:${cfg.serverPort}`;
}

function frontendBase(cfg) {
  return `http://${cfg.serverHost}:${FRONTEND_PORT}`;
}

/** True when the configured server is this PC itself (the Main Server PC). */
function isLocalMainServer(cfg) {
  return cfg.serverHost === '127.0.0.1' || cfg.serverHost === 'localhost';
}

function readConfigFile(file) {
  try {
    return resolveConfig(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch (_) {
    return resolveConfig(null);
  }
}

/** Writes the given settings merged over the existing file; keeps unknown keys. */
function writeConfigFile(file, patch) {
  let existing = {};
  try { existing = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { existing = {}; }
  const next = resolveConfig({ ...existing, ...patch });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
  fs.renameSync(tmp, file);
  return next;
}

module.exports = {
  DEFAULT_SERVER_HOST,
  DEFAULT_SERVER_PORT,
  FRONTEND_PORT,
  normalizeServerAddress,
  configPaths,
  resolveConfig,
  serverBase,
  frontendBase,
  isLocalMainServer,
  readConfigFile,
  writeConfigFile,
};
