import React, { useCallback, useEffect, useRef, useState } from 'react';
import api, { API_BASE } from '@/lib/api';
import { PageHeader } from '@/components/Layout';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import {
  Rocket, UploadCloud, ShieldCheck, ShieldAlert, FileArchive, History,
  Undo2, CheckCircle2, XCircle, Loader2, Info, Clock, KeyRound, FileText,
} from 'lucide-react';

// Runtime-detected (never a build-time env var) - see lib/api.js.
const API = API_BASE;

const fmtBytes = (n) => {
  if (!n && n !== 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
};
const fmtDate = (s) => s ? new Date(s).toLocaleString('en-IN') : '—';

const statusChip = (s) => {
  const cls = {
    success:            'bg-emerald-50 text-emerald-700 border-emerald-200',
    in_progress:        'bg-blue-50 text-blue-700 border-blue-200',
    failed:             'bg-rose-50 text-rose-700 border-rose-200',
    failed_rolled_back: 'bg-amber-50 text-amber-800 border-amber-200',
    rolled_back:        'bg-slate-100 text-slate-700 border-slate-200',
  }[s] || 'bg-slate-100 text-slate-700 border-slate-200';
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide border ${cls}`}>{(s || '').replace(/_/g, ' ')}</span>;
};

export default function SoftwareUpdates() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'administrator';

  const [current, setCurrent] = useState(null);
  const [history, setHistory] = useState([]);
  const [rollbacks, setRollbacks] = useState([]);
  const [staged, setStaged] = useState(null);   // { update_id, filename, size_bytes, sha256, manifest }
  const [busy, setBusy] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [installLog, setInstallLog] = useState(null);
  const fileRef = useRef(null);

  const loadAll = useCallback(async () => {
    try {
      const [cur, hist, rbs] = await Promise.all([
        api.get('/updates/current'),
        api.get('/updates'),
        isAdmin ? api.get('/updates/rollbacks') : Promise.resolve({ data: [] }),
      ]);
      setCurrent(cur.data); setHistory(hist.data); setRollbacks(rbs.data);
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Failed to load update status');
    }
  }, [isAdmin]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const pickFile = () => fileRef.current?.click();

  const askPin = () => window.prompt('Administrator PIN required:') || '';

  const onFileChosen = async (e) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.bcupdate')) {
      return toast.error('Please choose a file with the .bcupdate extension.');
    }
    const pin = askPin(); if (!pin) return;
    setBusy(true); setUploadPct(0); setStaged(null); setInstallLog(null);
    try {
      const form = new FormData(); form.append('file', file);
      const r = await fetch(`${API}/api/updates/upload`, {
        method: 'POST', credentials: 'include',
        headers: {
          'X-Admin-Pin': pin,
          Authorization: `Bearer ${localStorage.getItem('bc_token') || ''}`,
        },
        body: form,
      });
      if (!r.ok) {
        const txt = await r.text();
        try { throw new Error(JSON.parse(txt).detail || txt); } catch { throw new Error(txt); }
      }
      const data = await r.json();
      setStaged(data);
      toast.success(`Package verified — v${data.manifest.version} ready to install.`);
    } catch (err) {
      toast.error(String(err.message || err));
    } finally { setBusy(false); setUploadPct(0); }
  };

  const doInstall = async () => {
    if (!staged) return;
    const m = staged.manifest;
    const ok = window.confirm(
      `Install update v${m.version}?\n\n` +
      `From: ${current?.current?.version || '?'}\nTo: ${m.version}\n\n` +
      `The system will:\n • Create a full database backup\n • Create a configuration snapshot\n • Snapshot every file about to change (for rollback)\n • Apply ${Object.keys(m.files || {}).length} file(s)` +
      `${m.files?.['backend/requirements.txt'] ? '\n • Install new Python packages' : ''}` +
      `${(m.migrations || []).length ? `\n • Run ${(m.migrations || []).length} migration(s)` : ''}` +
      `${m.requires_backend_restart ? '\n • Restart the backend service' : ''}` +
      `\n\nThis operation cannot be interrupted. Continue?`
    );
    if (!ok) return;
    const pin = askPin(); if (!pin) return;
    setBusy(true); setInstallLog(null);
    try {
      const r = await fetch(`${API}/api/updates/install/${staged.update_id}`, {
        method: 'POST', credentials: 'include',
        headers: {
          'X-Admin-Pin': pin,
          Authorization: `Bearer ${localStorage.getItem('bc_token') || ''}`,
        },
      });
      if (!r.ok) {
        const txt = await r.text();
        try { throw new Error(JSON.parse(txt).detail || txt); } catch { throw new Error(txt); }
      }
      const data = await r.json();
      setInstallLog(data.log);
      toast.success(`Installed v${data.to_version} — restarting server…`);
      // Poll until the backend comes back up on the new version, then reload.
      setStaged(null);
      pollForNewVersion(data.to_version);
    } catch (err) {
      toast.error(String(err.message || err)); setBusy(false);
    }
  };

  const pollForNewVersion = (expected, attempts = 0) => {
    if (attempts > 40) { setBusy(false); toast.error('Server did not come back within 2 minutes — please refresh manually.'); return; }
    fetch(`${API}/api/version`, { cache: 'no-store' })
      .then(r => r.json())
      .then(v => {
        if (v?.app_version === expected || v?.version === expected) {
          toast.success('Update complete — reloading the app.');
          setTimeout(() => window.location.reload(), 800);
        } else {
          setTimeout(() => pollForNewVersion(expected, attempts + 1), 3000);
        }
      })
      .catch(() => setTimeout(() => pollForNewVersion(expected, attempts + 1), 3000));
  };

  const cancelStaged = async () => {
    if (!staged) return;
    if (!window.confirm('Discard this staged update?')) return;
    const pin = askPin(); if (!pin) return;
    try {
      const r = await fetch(`${API}/api/updates/staging/${staged.update_id}`, {
        method: 'DELETE', credentials: 'include',
        headers: {
          'X-Admin-Pin': pin,
          Authorization: `Bearer ${localStorage.getItem('bc_token') || ''}`,
        },
      });
      if (!r.ok) throw new Error(await r.text());
      setStaged(null); toast.success('Staged package cleared.');
    } catch (e) { toast.error(String(e.message || e)); }
  };

  const doRollback = async (rbId, fromVersion) => {
    if (!window.confirm(`Roll back to ${fromVersion || 'the previous version'}?\n\nAll files snapshotted before that update was applied will be restored. The backend will restart.`)) return;
    const pin = askPin(); if (!pin) return;
    setBusy(true);
    try {
      const r = await fetch(`${API}/api/updates/rollback/${rbId}`, {
        method: 'POST', credentials: 'include',
        headers: {
          'X-Admin-Pin': pin,
          Authorization: `Bearer ${localStorage.getItem('bc_token') || ''}`,
        },
      });
      if (!r.ok) throw new Error(await r.text());
      toast.success('Rollback in progress — server restarting…');
      pollForNewVersion(fromVersion);
    } catch (e) { toast.error(String(e.message || e)); setBusy(false); }
  };

  const cur = current?.current || {};
  const m = staged?.manifest;

  return (
    <>
      <PageHeader
        title="Software Updates"
        subtitle="Install signed .bcupdate packages offline — the LAN never talks to the internet."
      />
      <div className="p-6 space-y-6" data-testid="software-updates-page">
        {/* Current version + Upload */}
        <div className="grid lg:grid-cols-3 gap-4">
          <section className="lg:col-span-1 bg-white border border-slate-200 rounded-xl p-4" data-testid="update-current-version">
            <div className="text-[11px] uppercase tracking-widest text-slate-500 font-semibold">Currently Installed</div>
            <div className="mt-1 font-mono text-3xl font-bold text-slate-900">v{cur.version || '—'}</div>
            <div className="mt-2 text-[12px] text-slate-600 space-y-0.5">
              <div><Clock className="inline w-3.5 h-3.5 mr-1 text-slate-400" /> Build date: <b>{cur.build_date || '—'}</b></div>
              <div><FileArchive className="inline w-3.5 h-3.5 mr-1 text-slate-400" /> DB schema: v{cur.database_version || '—'}</div>
              <div><KeyRound className="inline w-3.5 h-3.5 mr-1 text-slate-400" /> Key fingerprint: <span className="font-mono text-[11px]">{current?.public_key_fingerprint || '—'}</span></div>
            </div>
            <div className="mt-3 text-[11px] text-slate-500 flex items-center gap-3 border-t border-slate-100 pt-2">
              <span>Rollbacks kept: <b>{current?.rollback_available ?? 0}</b> / {current?.rollback_keep ?? 3}</span>
              <span>Total installs: <b>{current?.installed_count ?? 0}</b></span>
            </div>
          </section>

          <section className="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-4" data-testid="update-upload-card">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-slate-900 text-white flex items-center justify-center flex-shrink-0"><Rocket className="w-5 h-5" /></div>
              <div className="flex-1">
                <div className="font-heading font-semibold text-lg text-slate-900">Install a new update package</div>
                <p className="text-[13px] text-slate-600 mt-0.5">
                  Click below and pick the <code className="font-mono text-[11px] bg-slate-100 px-1 py-0.5 rounded">.bcupdate</code> file your software vendor has given you.
                  Every package is <b>digitally signed</b>. Uploads that fail signature or checksum verification are rejected.
                </p>
              </div>
            </div>

            {!staged && (
              <div className="mt-4">
                <div
                  onClick={isAdmin && !busy ? pickFile : undefined}
                  className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${isAdmin && !busy ? 'border-slate-300 hover:border-blue-500 hover:bg-blue-50 cursor-pointer' : 'border-slate-200 bg-slate-50 opacity-60 cursor-not-allowed'}`}
                  data-testid="update-dropzone"
                >
                  <UploadCloud className="w-8 h-8 mx-auto text-slate-500" />
                  <div className="mt-2 text-sm font-medium text-slate-800">
                    {busy ? 'Verifying…' : 'Click to choose a .bcupdate file'}
                  </div>
                  <div className="mt-1 text-[11px] text-slate-500">Max 500 MB · Admin PIN required</div>
                </div>
                <input ref={fileRef} type="file" accept=".bcupdate,application/zip" className="hidden" onChange={onFileChosen} data-testid="update-file-input" />
              </div>
            )}

            {staged && m && (
              <div className="mt-4 border border-emerald-200 bg-emerald-50/60 rounded-lg p-4" data-testid="update-preview">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-emerald-700" />
                  <div className="font-semibold text-emerald-900">Package verified · SHA-256 + RSA signature OK</div>
                </div>
                <div className="mt-3 grid md:grid-cols-2 gap-3 text-[12px]">
                  <Info2 label="Version">v{cur.version || '—'} <span className="mx-1 text-slate-400">→</span> <b className="font-mono">v{m.version}</b></Info2>
                  <Info2 label="Minimum supported">v{m.min_supported_version}</Info2>
                  <Info2 label="Build date">{m.build_date}</Info2>
                  <Info2 label="Package size">{fmtBytes(staged.size_bytes)}</Info2>
                  <Info2 label="Files to write">{Object.keys(m.files || {}).length}</Info2>
                  <Info2 label="Migrations">{(m.migrations || []).length}</Info2>
                  <Info2 label="Backend restart">{m.requires_backend_restart ? 'Yes' : 'No'}</Info2>
                  <Info2 label="Frontend reload">{m.requires_frontend_reload ? 'Yes' : 'No'}</Info2>
                </div>
                {m.release_notes && (
                  <div className="mt-3 bg-white border border-slate-200 rounded p-3 text-[12px] text-slate-700 leading-relaxed">
                    <div className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-1">Release Notes</div>
                    <div className="whitespace-pre-wrap">{m.release_notes}</div>
                  </div>
                )}
                <div className="mt-3 text-[11px] text-slate-500 flex items-center gap-2">
                  <FileText className="w-3.5 h-3.5" /> SHA-256: <span className="font-mono">{(staged.sha256 || '').slice(0, 16)}…</span>
                </div>
                <div className="mt-4 flex gap-2">
                  <button onClick={doInstall} disabled={busy} className="h-10 px-4 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white rounded font-semibold text-sm inline-flex items-center gap-2" data-testid="update-install-btn">
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />}
                    {busy ? 'Installing…' : `Install v${m.version}`}
                  </button>
                  <button onClick={cancelStaged} disabled={busy} className="h-10 px-3 border border-slate-300 rounded text-sm hover:bg-slate-50" data-testid="update-cancel-btn">Cancel</button>
                </div>
              </div>
            )}
          </section>
        </div>

        {/* Install log */}
        {installLog?.steps?.length > 0 && (
          <section className="bg-white border border-slate-200 rounded-xl p-4" data-testid="update-install-log">
            <div className="font-heading font-semibold flex items-center gap-2"><Info className="w-4 h-4 text-slate-500" /> Install log</div>
            <div className="mt-2 divide-y divide-slate-100">
              {installLog.steps.map((s, i) => (
                <div key={i} className="py-2 flex items-start gap-2 text-[13px]">
                  {s.ok ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" /> : <XCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />}
                  <div className="flex-1">
                    <div className="font-medium text-slate-800">{s.name}</div>
                    {s.message && <div className="text-[12px] text-slate-500">{s.message}</div>}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* History */}
        <section className="bg-white border border-slate-200 rounded-xl overflow-hidden" data-testid="update-history">
          <div className="px-4 py-3 border-b border-slate-100 bg-slate-50 flex items-center gap-2">
            <History className="w-4 h-4 text-slate-500" /><h2 className="text-sm font-semibold text-slate-800">Update history</h2>
          </div>
          <table className="w-full dense-table">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-slate-600 bg-white">
                <th className="pl-3 py-2 w-40">When</th>
                <th className="w-32">From → To</th>
                <th>Notes</th>
                <th className="w-32">Installed by</th>
                <th className="w-24">Status</th>
                <th className="text-right pr-3 w-28">Actions</th>
              </tr>
            </thead>
            <tbody>
              {history.length === 0 && (
                <tr><td colSpan="6" className="text-center py-6 text-slate-500 text-[13px]">No updates installed yet. Upload a .bcupdate file above to get started.</td></tr>
              )}
              {history.map(h => (
                <tr key={h.id} data-testid={`update-row-${h.id}`} className="border-b border-slate-100">
                  <td className="pl-3 py-2 text-[12px] text-slate-600 font-mono">{fmtDate(h.installed_at)}</td>
                  <td className="text-[12px] font-mono"><span className="text-slate-500">v{h.from_version}</span> → <b>v{h.to_version}</b></td>
                  <td className="text-[12px] text-slate-700"><div className="line-clamp-2">{h.release_notes || '—'}</div></td>
                  <td className="text-[12px]">{h.installed_by}</td>
                  <td>{statusChip(h.status)}</td>
                  <td className="text-right pr-3">
                    {isAdmin && h.rollback_available && h.status === 'success' && rollbacks.find(r => r.rollback_id === h.rollback_id) && (
                      <button
                        onClick={() => doRollback(h.rollback_id, h.from_version)}
                        disabled={busy}
                        className="h-7 px-2 border border-amber-300 text-amber-800 rounded text-[11px] inline-flex items-center gap-1 hover:bg-amber-50 disabled:opacity-50"
                        data-testid={`update-rollback-${h.id}`}
                      ><Undo2 className="w-3 h-3" /> Rollback</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {isAdmin && rollbacks.length > 0 && (
          <section className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-[12px] text-slate-600" data-testid="update-rollbacks-info">
            <div className="font-semibold text-slate-800 mb-2 flex items-center gap-2"><Undo2 className="w-4 h-4" /> Rollback snapshots on disk ({rollbacks.length}/{current?.rollback_keep ?? 3})</div>
            <ul className="space-y-1">
              {rollbacks.map(r => (
                <li key={r.rollback_id} className="flex items-center gap-3">
                  <span className="font-mono text-[11px]">{r.rollback_id}</span>
                  <span className="text-slate-500">v{r.from_version}</span>
                  <span className="text-slate-500">{fmtBytes(r.size_bytes)}</span>
                  <span className="text-slate-400 text-[11px]">{fmtDate(r.created_at)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-2 text-[11px] text-slate-500">Only the most recent {current?.rollback_keep ?? 3} snapshots are kept. Older ones are pruned automatically after each successful install.</div>
          </section>
        )}

        {!isAdmin && (
          <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-[13px] text-amber-800 flex items-center gap-2">
            <ShieldAlert className="w-4 h-4" /> Only Administrators can upload or install software updates. This page is read-only for your role.
          </div>
        )}
      </div>
    </>
  );
}

function Info2({ label, children }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">{label}</div>
      <div className="text-[13px] text-slate-900">{children}</div>
    </div>
  );
}
