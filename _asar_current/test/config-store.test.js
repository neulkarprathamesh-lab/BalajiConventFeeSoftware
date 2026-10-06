'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cs = require('../config-store');

test('default Main Server address is 192.168.0.116:8001', () => {
  const cfg = cs.resolveConfig(null);
  assert.equal(cfg.serverHost, '192.168.0.116');
  assert.equal(cfg.serverPort, 8001);
  assert.equal(cs.serverBase(cfg), 'http://192.168.0.116:8001');
  assert.equal(cs.frontendBase(cfg), 'http://192.168.0.116:3000');
});

test('legacy serverIp key is migrated to serverHost and dropped', () => {
  const cfg = cs.resolveConfig({ serverIp: '10.0.0.5', lastConnectedAt: 'x' });
  assert.equal(cfg.serverHost, '10.0.0.5');
  assert.equal(cfg.serverPort, 8001);
  assert.equal('serverIp' in cfg, false);
  assert.equal(cfg.lastConnectedAt, 'x');
});

test('an invalid stored port falls back to the default port', () => {
  assert.equal(cs.resolveConfig({ serverHost: '10.0.0.5', serverPort: 'abc' }).serverPort, 8001);
  assert.equal(cs.resolveConfig({ serverHost: '10.0.0.5', serverPort: 70000 }).serverPort, 8001);
});

test('normalizeServerAddress accepts common spellings', () => {
  assert.deepEqual(cs.normalizeServerAddress('192.168.0.116'), { ok: true, host: '192.168.0.116', port: 8001 });
  assert.deepEqual(cs.normalizeServerAddress('192.168.0.116:9001'), { ok: true, host: '192.168.0.116', port: 9001 });
  assert.deepEqual(cs.normalizeServerAddress('http://192.168.0.116:8001/'), { ok: true, host: '192.168.0.116', port: 8001 });
  assert.deepEqual(cs.normalizeServerAddress('feehub-main', '8001'), { ok: true, host: 'feehub-main', port: 8001 });
});

test('normalizeServerAddress rejects junk, bad octets and bad ports', () => {
  for (const bad of ['', '   ', '999.1.1.1', '192.168.0', 'not a host!', 'http://']) {
    assert.equal(cs.normalizeServerAddress(bad).ok, false, `expected rejection for "${bad}"`);
  }
  assert.equal(cs.normalizeServerAddress('192.168.0.116', 0).ok, false);
  assert.equal(cs.normalizeServerAddress('192.168.0.116', 65536).ok, false);
  assert.equal(cs.normalizeServerAddress('192.168.0.116', 'abc').ok, false);
});

test('isLocalMainServer only for this PC', () => {
  assert.equal(cs.isLocalMainServer({ serverHost: '127.0.0.1' }), true);
  assert.equal(cs.isLocalMainServer({ serverHost: '192.168.0.116' }), false);
});

test('config survives a write/read cycle and keeps unrelated keys', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'feehub-cfg-'));
  const { file } = cs.configPaths(dir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ lastCacheClearedForVersion: '1.0.2' }));
  cs.writeConfigFile(file, { serverHost: '10.1.1.9', serverPort: 8001 });
  const back = cs.readConfigFile(file);
  assert.equal(back.serverHost, '10.1.1.9');
  assert.equal(back.lastCacheClearedForVersion, '1.0.2');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a missing or corrupt config file reads as defaults and never throws', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'feehub-cfg-'));
  const { file } = cs.configPaths(dir);
  assert.equal(cs.readConfigFile(file).serverHost, '192.168.0.116');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{ not json');
  assert.equal(cs.readConfigFile(file).serverPort, 8001);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a support override folder replaces the default AppData location', () => {
  const p = cs.configPaths(path.join('appdata-root'), path.join('override-dir'));
  assert.equal(p.dir, path.join('override-dir'));
  assert.equal(p.file, path.join('override-dir', 'config.json'));
  assert.equal(cs.configPaths(path.join('appdata-root')).dir, path.join('appdata-root', 'BalajiFeeHub'));
});
