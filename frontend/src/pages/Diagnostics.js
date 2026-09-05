import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { CheckCircle2, XCircle, RefreshCw, AlertTriangle, HardDrive, Database, Server, Wifi, Printer, ScanLine, FolderCheck, Archive, Info, Loader2 } from 'lucide-react';
import api, { API_BASE } from '@/lib/api';

// Runtime-detected (never a build-time env var) - see lib/api.js.
const API = API_BASE;

function StatusPill({ ok, warn }) {
  const cls = ok
    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : warn
    ? 'bg-amber-50 text-amber-800 border-amber-200'
    : 'bg-rose-50 text-rose-700 border-rose-200';
  const label = ok ? 'OK' : warn ? 'WARN' : 'FAIL';
  const Icon = ok ? CheckCircle2 : warn ? AlertTriangle : XCircle;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border ${cls}`}>
      <Icon className="w-3.5 h-3.5" /> {label}
    </span>
  );
}

function Row({ icon: Icon, name, check, testid }) {
  if (!check) {
    return (
      <div className="flex items-center gap-3 py-3.5 px-4 border-b border-slate-100" data-testid={testid}>
        <Icon className="w-4 h-4 text-slate-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-slate-900">{name}</div>
          <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" /> checking…</div>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-3 py-3.5 px-4 border-b border-slate-100" data-testid={testid}>
      <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${check.ok ? 'text-emerald-600' : check.warn ? 'text-amber-600' : 'text-rose-600'}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="text-sm font-medium text-slate-900">{name}</div>
          <StatusPill ok={check.ok} warn={check.warn} />
        </div>
        <div className="text-xs text-slate-600 mt-1 leading-relaxed">{check.message}</div>
      </div>
    </div>
  );
}

export default function Diagnostics() {
  const [server, setServer] = useState(null);
  const [client, setClient] = useState({});
  const [loading, setLoading] = useState(false);
  const [runAt, setRunAt] = useState(null);
  const [error, setError] = useState(null);

  // ---- Client-side probes ----
  async function probeMainServer() {
    const t0 = performance.now();
    try {
      const r = await axios.get(`${API}/api/version`, { timeout: 5000 });
      const ms = Math.round(performance.now() - t0);
      const warn = ms > 800;
      return { ok: true, warn, message: `Main server reachable in ${ms} ms (v${r.data.app_version})`, latency_ms: ms };
    } catch (e) {
      return { ok: false, message: `Cannot connect to Main Server at ${API} — ${e.message}` };
    }
  }
  function probeLan() {
    const online = navigator.onLine;
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    const type = conn?.effectiveType || 'unknown';
    return {
      ok: online,
      message: online
        ? `Browser reports online (network type: ${type})`
        : 'Browser reports offline — check LAN cable/Wi-Fi',
    };
  }
  function probePrinter() {
    if (typeof window.print !== 'function') {
      return { ok: false, message: 'This browser does not expose the print API — try Chrome or Edge.' };
    }
    return {
      ok: true, warn: true,
      message: 'Browser print API available. Click "Test Print Page" below to verify the physical printer.',
    };
  }
  async function probeScanner() {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) {
        return { ok: false, message: 'Camera enumeration not supported by this browser.' };
      }
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cams = devices.filter(d => d.kind === 'videoinput');
      if (!cams.length) {
        return { ok: false, message: 'No camera/scanner detected. QR scanning at the kiosk needs at least one camera.' };
      }
      return { ok: true, message: `${cams.length} camera(s) available for QR/barcode scanning.` };
    } catch (e) {
      return { ok: false, message: `Cannot list cameras: ${e.message}` };
    }
  }
  function probeBrowser() {
    const ua = navigator.userAgent;
    const isChromium = /Chrome|Edg|Chromium/.test(ua);
    return {
      ok: isChromium,
      warn: !isChromium,
      message: isChromium
        ? `Modern Chromium browser detected — best for offline PWA + printing.`
        : `Non-Chromium browser (${ua.split(' ').slice(-1)[0]}) — prefer Chrome or Edge for full compatibility.`,
    };
  }

  async function runAll() {
    setLoading(true); setError(null);
    try {
      const [srv, mainServer, lan, printer, scanner, browser] = await Promise.all([
        // Authenticated endpoint - must go through the shared `api` instance
        // so the Authorization: Bearer <token> interceptor attaches; the raw
        // axios import below is only for the deliberately unauthenticated
        // /api/version reachability probe in probeMainServer().
        api.get('/diagnostics').then(r => r.data),
        probeMainServer(), Promise.resolve(probeLan()),
        Promise.resolve(probePrinter()), probeScanner(),
        Promise.resolve(probeBrowser()),
      ]);
      setServer(srv);
      setClient({ mainServer, lan, printer, scanner, browser });
      setRunAt(new Date().toLocaleString());
    } catch (e) {
      setError(e?.response?.data?.detail || e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { runAll(); /* eslint-disable-next-line */ }, []);

  const byName = Object.fromEntries((server?.server_side_checks || []).map(c => [c.name, c]));
  const overallOk = server && server.overall_ok && Object.values(client).every(c => c && c.ok);
  const anyFail = server && (!server.overall_ok || Object.values(client).some(c => c && !c.ok && !c.warn));

  return (
    <div className="space-y-6" data-testid="diagnostics-page">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">System Diagnostics</h1>
          <p className="text-sm text-slate-500 mt-1">
            Automatic health check across database, server, LAN, printer, scanner, backups and storage.
          </p>
          {runAt && (
            <p className="text-xs text-slate-400 mt-1" data-testid="diag-run-at">
              Last run: {runAt}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => window.print()}
            className="h-9 px-3 border border-slate-300 rounded text-sm hover:bg-slate-50"
            data-testid="diag-test-print"
          >
            Test Print Page
          </button>
          <button
            onClick={runAll}
            disabled={loading}
            className="h-9 px-4 bg-slate-900 text-white rounded text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50"
            data-testid="diag-rerun"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {loading ? 'Running…' : 'Re-run All Checks'}
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-800" data-testid="diag-error">
          <strong>Diagnostics error:</strong> {error}
        </div>
      )}

      {/* Overall banner */}
      {server && !loading && (
        overallOk ? (
          <div className="p-4 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center gap-3" data-testid="diag-overall-ok">
            <CheckCircle2 className="w-5 h-5 text-emerald-700 shrink-0" />
            <div>
              <div className="text-sm font-semibold text-emerald-900">All systems operational</div>
              <div className="text-xs text-emerald-800">Every check passed. Software is ready for daily use.</div>
            </div>
          </div>
        ) : anyFail ? (
          <div className="p-4 rounded-lg bg-rose-50 border border-rose-200 flex items-center gap-3" data-testid="diag-overall-fail">
            <XCircle className="w-5 h-5 text-rose-700 shrink-0" />
            <div>
              <div className="text-sm font-semibold text-rose-900">One or more checks failed</div>
              <div className="text-xs text-rose-800">Share this page with your IT / support contact to get help fast.</div>
            </div>
          </div>
        ) : (
          <div className="p-4 rounded-lg bg-amber-50 border border-amber-200 flex items-center gap-3" data-testid="diag-overall-warn">
            <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0" />
            <div>
              <div className="text-sm font-semibold text-amber-900">Ready with warnings</div>
              <div className="text-xs text-amber-800">Nothing is broken but some checks need your attention.</div>
            </div>
          </div>
        )
      )}

      <div className="grid md:grid-cols-2 gap-6">
        {/* Client-side checks */}
        <section className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2 bg-slate-50">
            <Info className="w-4 h-4 text-slate-500" />
            <h2 className="text-sm font-semibold text-slate-800">This PC (browser)</h2>
          </div>
          <Row icon={Server} name="Main Server connection" check={client.mainServer} testid="diag-main-server" />
          <Row icon={Wifi} name="LAN connectivity" check={client.lan} testid="diag-lan" />
          <Row icon={Printer} name="Printer availability" check={client.printer} testid="diag-printer" />
          <Row icon={ScanLine} name="Scanner / Camera availability" check={client.scanner} testid="diag-scanner" />
          <Row icon={Info} name="Browser compatibility" check={client.browser} testid="diag-browser" />
        </section>

        {/* Server-side checks */}
        <section className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2 bg-slate-50">
            <Info className="w-4 h-4 text-slate-500" />
            <h2 className="text-sm font-semibold text-slate-800">Main Server</h2>
          </div>
          <Row icon={Database}    name="Database connection"  check={byName['Database connection']}  testid="diag-db" />
          <Row icon={Archive}     name="Database version"     check={byName['Database version']}     testid="diag-db-version" />
          <Row icon={Info}        name="Software version"     check={byName['Software version']}     testid="diag-sw-version" />
          <Row icon={FolderCheck} name="Backup folder access" check={byName['Backup folder access']} testid="diag-backup-folder" />
          <Row icon={HardDrive}   name="Storage space"        check={byName['Storage space']}        testid="diag-storage" />
          <Row icon={CheckCircle2} name="Seed data"           check={byName['Seed data']}            testid="diag-seed" />
        </section>
      </div>

      {/* Support block */}
      <section className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs text-slate-600 leading-relaxed">
        <div className="font-semibold text-slate-800 mb-1">Sharing this report</div>
        Take a screenshot of this page (or use <span className="font-mono">Test Print Page</span> to save a PDF) and send it to your school's IT / support contact.
        Every check shows a plain-English message, so you can fix common issues (printer offline, backup folder missing, LAN cable unplugged) without any technical knowledge.
      </section>
    </div>
  );
}
