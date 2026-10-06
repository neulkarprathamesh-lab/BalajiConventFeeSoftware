// The desktop client (bundled UI) takes its server address from the AppData config
// through window.feehubRuntime. These tests load the modules in that environment.
import fs from 'fs';
import path from 'path';

function loadWithBridge(bridge) {
  let modules;
  jest.isolateModules(() => {
    if (bridge) window.feehubRuntime = bridge; else delete window.feehubRuntime;
    modules = {
      runtime: require('./runtime'),
    };
  });
  return modules;
}

afterEach(() => { delete window.feehubRuntime; });

const DESKTOP = {
  isDesktop: true,
  getConfig: () => ({
    appVersion: '1.1.0',
    serverHost: '192.168.0.116', serverPort: 8001,
    serverBase: 'http://192.168.0.116:8001', frontendBase: 'http://192.168.0.116:3000',
  }),
};

describe('desktop runtime', () => {
  test('the API base comes from the configured server address (default 192.168.0.116:8001)', () => {
    const { runtime } = loadWithBridge(DESKTOP);
    expect(runtime.isDesktop()).toBe(true);
    expect(runtime.API_BASE).toBe('http://192.168.0.116:8001');
  });

  test('the client reports the installed version', () => {
    const { runtime } = loadWithBridge(DESKTOP);
    expect(runtime.appVersion()).toBe('1.1.0');
  });

  test('QR and parent links point at the Main Server web address, not file://', () => {
    const { runtime } = loadWithBridge(DESKTOP);
    expect(runtime.appOrigin()).toBe('http://192.168.0.116:3000');
  });

  test('a configured address change is picked up after the bridge is re-read (new session)', () => {
    const changed = { ...DESKTOP, getConfig: () => ({ ...DESKTOP.getConfig(), serverHost: '10.0.0.5', serverBase: 'http://10.0.0.5:8001' }) };
    const { runtime } = loadWithBridge(changed);
    expect(runtime.API_BASE).toBe('http://10.0.0.5:8001');
  });

  test('without the desktop bridge the web behaviour is unchanged', () => {
    const { runtime } = loadWithBridge(null);
    expect(runtime.isDesktop()).toBe(false);
    expect(runtime.API_BASE).toBe('http://localhost:8001');
    expect(runtime.appVersion()).toBe('1.0');
  });
});

describe('no hard-coded server address in the client UI code', () => {
  const srcRoot = path.join(__dirname, '..');
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return /\.(js|jsx)$/.test(e.name) && !/\.test\.js$/.test(e.name) ? [p] : [];
  });

  test('the server IP appears only in the config default/documentation, never in screens', () => {
    const offenders = walk(srcRoot).filter((f) => fs.readFileSync(f, 'utf8').includes('192.168.0.116'));
    // lib/installationManual.js documents the installation; nothing else may embed the address.
    offenders.forEach((f) => expect(path.basename(f)).toBe('installationManual.js'));
  });
});

describe('App routing', () => {
  test('every server-only screen in the policy list is a real route in App.js', () => {
    const { SERVER_ONLY_ROUTES } = require('./syncPolicy');
    const app = fs.readFileSync(path.join(__dirname, '..', 'App.js'), 'utf8');
    SERVER_ONLY_ROUTES.forEach((key) => {
      expect(app).toContain(`path="${key}"`);
    });
  });
});
