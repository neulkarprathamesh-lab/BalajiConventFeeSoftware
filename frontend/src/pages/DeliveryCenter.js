import React, { useEffect, useState } from 'react';
import api, { API_BASE } from '@/lib/api';
import { PageHeader } from '@/components/Layout';
import { toast } from 'sonner';
import {
  Download, Package, Server, Database, Settings2, Receipt, BookOpen,
  History, ShieldCheck, RefreshCw, ExternalLink, FileText, CheckCircle2,
  Trash2, AlertTriangle, FileDown, Loader2,
} from 'lucide-react';
import { downloadInstallationManual } from '@/lib/installationManual';

const ICONS = {
  package: Package, server: Server, database: Database, settings: Settings2,
  receipt: Receipt, book: BookOpen, history: History,
};

function useAdminPin() {
  const [pin, setPin] = useState('');
  const ask = () => {
    const p = window.prompt('Administrator PIN required for this download:');
    if (p) setPin(p);
    return p;
  };
  return { pin, ask };
}

async function downloadWithPin(endpoint, filename, pin) {
  const url = `${API_BASE}${endpoint}`;
  const r = await fetch(url, {
    method: 'GET',
    credentials: 'include',
    headers: pin ? { 'X-Admin-Pin': pin } : {},
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(t || r.statusText);
  }
  const blob = await r.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(a.href);
}

export default function DeliveryCenter() {
  const [manifest, setManifest] = useState(null);
  const [busy, setBusy] = useState(null);
  const [purgePreview, setPurgePreview] = useState(null);
  const [genBusy, setGenBusy] = useState(false);
  const { ask } = useAdminPin();

  const load = () => api.get('/deliverables/manifest').then(r => setManifest(r.data));
  useEffect(() => { load(); }, []);

  const loadPurgePreview = async () => {
    const pin = ask(); if (!pin) return;
    try {
      const r = await fetch(`${API_BASE}/api/production/purge/preview`, {
        credentials: 'include',
        headers: {
          Authorization: `Bearer ${localStorage.getItem('bc_token') || ''}`,
          'X-Admin-Pin': pin,
        },
      });
      if (!r.ok) throw new Error(await r.text());
      setPurgePreview(await r.json());
    } catch (e) { toast.error(String(e.message || e)); }
  };

  const doPurge = async () => {
    const phrase = window.prompt('This will PERMANENTLY delete every transactional row (students, receipts, vouchers, audit log, snapshots, updates). Master data is preserved.\n\nType exactly:  PURGE DEMO DATA');
    if (phrase !== 'PURGE DEMO DATA') { toast.error('Cancelled — phrase did not match.'); return; }
    const pin = ask(); if (!pin) return;
    setBusy('purge');
    try {
      const r = await fetch(`${API_BASE}/api/production/purge`, {
        method: 'POST', credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('bc_token') || ''}`,
          'X-Admin-Pin': pin,
        },
        body: JSON.stringify({ confirm_phrase: phrase, also_clear_backup_files: false, also_clear_staged_updates: true }),
      });
      if (!r.ok) throw new Error(await r.text());
      const data = await r.json();
      const total = Object.values(data.collections_deleted || {}).reduce((a,b) => a + (typeof b === 'number' ? b : 0), 0);
      toast.success(`Purge complete — ${total} transactional row(s) deleted, master data preserved.`);
      setPurgePreview(null);
      load();
    } catch (e) { toast.error(String(e.message || e)); }
    setBusy(null);
  };

  const generateManual = async () => {
    setGenBusy(true);
    try {
      const v = manifest?.app_version || '1.0.0';
      await downloadInstallationManual({ appVersion: v, buildDate: new Date().toISOString().slice(0,10) });
      toast.success('Installation manual downloaded.');
    } catch (e) { toast.error(`Manual generation failed — ${e.message || e}`); }
    setGenBusy(false);
  };

  const doDownload = async (item) => {
    setBusy(item.label);
    try {
      if (item.route) {
        window.open(item.route, '_blank');
      } else if (item.endpoint) {
        const filename = item.label.replace(/[^a-z0-9-]+/gi, '_').toLowerCase() + '.dat';
        const needsPin = item.endpoint.includes('/config/export') || item.endpoint.includes('/config/backup') || item.endpoint.includes('/deliverables/');
        const pin = needsPin ? ask() : null;
        // Detect proper extension by hint
        const fname =
          item.endpoint.includes('receipt-types') ? 'receipt-types-v1.0.json' :
          item.endpoint.includes('license')       ? 'LICENSE_AND_OWNERSHIP.md' :
          item.endpoint.includes('release-notes') ? 'RELEASE_NOTES_v1.0.md' :
          item.endpoint.includes('config/export') ? `balaji-config-${new Date().toISOString().slice(0,10)}.zip` :
          filename;
        await downloadWithPin(item.endpoint, fname, pin);
        toast.success(`Downloaded ${fname}`);
      }
    } catch (e) {
      toast.error(e.message || 'Download failed');
    }
    setBusy(null);
  };

  if (!manifest) return <div className="p-8 text-sm text-slate-500">Loading Delivery Center…</div>;

  return (
    <>
      <PageHeader
        title="Final Delivery Center"
        subtitle={`Version ${manifest.app_version} · Schema v${manifest.database_version} · Generated ${new Date(manifest.generated_at).toLocaleString('en-IN')}`}
        actions={
          <button onClick={load} className="h-9 px-3 border border-slate-300 rounded text-sm hover:bg-white flex items-center gap-1.5" data-testid="dc-refresh">
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
        }
      />
      <div className="p-6 space-y-6" data-testid="delivery-center">
        <div className="p-4 rounded-xl bg-gradient-to-r from-emerald-50 to-blue-50 border border-emerald-200 flex items-start gap-3">
          <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0 mt-0.5" />
          <div>
            <div className="font-heading font-semibold text-emerald-900">Balaji FeeHub v{manifest.app_version} — production-ready</div>
            <div className="text-[13px] text-emerald-800 mt-0.5">
              This is the day-to-day download hub for the school — configuration exports, the latest database backup, the ownership documents,
              and the full illustrated Installation Manual (PDF). Use "Purge Demo Data" to reset to a fresh-install database before shipping the final ZIP.
            </div>
          </div>
        </div>

        {/* Installation Manual + Purge Demo Data — headline actions */}
        <section className="grid md:grid-cols-2 gap-4">
          <div className="bg-white border border-slate-200 rounded-xl p-4" data-testid="dc-install-manual">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-slate-900 text-white flex items-center justify-center flex-shrink-0"><BookOpen className="w-5 h-5" /></div>
              <div className="flex-1">
                <div className="font-heading font-semibold text-slate-900">Installation Manual (PDF)</div>
                <p className="text-[13px] text-slate-600 mt-0.5">10 illustrated sections — System requirements, Main Server install, Client PCs, First-time config, Excel import, Daily ops, Software updates, Backup/recovery, Troubleshooting, Appendix. Auto-generated with the current version so it always matches the running software.</p>
                <button
                  onClick={generateManual} disabled={genBusy}
                  data-testid="dc-generate-manual"
                  className="mt-3 h-9 px-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded text-sm font-semibold inline-flex items-center gap-1.5"
                >
                  {genBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />} {genBusy ? 'Generating…' : 'Generate & Download Manual'}
                </button>
              </div>
            </div>
          </div>

          <div className="bg-white border border-amber-200 rounded-xl p-4" data-testid="dc-purge-card">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-amber-500 text-white flex items-center justify-center flex-shrink-0"><Trash2 className="w-5 h-5" /></div>
              <div className="flex-1">
                <div className="font-heading font-semibold text-slate-900">Purge Demo Data (fresh install)</div>
                <p className="text-[13px] text-slate-600 mt-0.5">
                  Delete every transactional row (students, receipts, vouchers, adjustments, audit log, snapshots, updates) and reset all counters.
                  Master data (departments, classes, fee heads, receipt types, users, settings) is preserved. Requires Admin PIN + the exact phrase <code className="font-mono text-[11px] bg-slate-100 px-1 py-0.5 rounded">PURGE DEMO DATA</code>.
                </p>
                <div className="mt-3 flex gap-2 flex-wrap">
                  <button onClick={loadPurgePreview} data-testid="dc-purge-preview" className="h-9 px-3 border border-slate-300 rounded text-sm hover:bg-slate-50 inline-flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-amber-600" /> Preview what will be deleted
                  </button>
                  <button
                    onClick={doPurge} disabled={busy === 'purge'}
                    data-testid="dc-purge-execute"
                    className="h-9 px-3 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded text-sm font-semibold inline-flex items-center gap-1.5"
                  >
                    {busy === 'purge' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} {busy === 'purge' ? 'Purging…' : 'Purge Demo Data'}
                  </button>
                </div>
                {purgePreview && (
                  <div className="mt-3 border border-slate-200 rounded p-3 bg-slate-50 text-[12px]" data-testid="dc-purge-preview-panel">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <div className="text-[10px] uppercase tracking-widest text-red-700 font-semibold mb-1">Would delete</div>
                        <ul className="space-y-0.5">
                          {Object.entries(purgePreview.would_delete || {}).map(([k, v]) => (
                            <li key={k} className="flex justify-between font-mono text-[11px]">
                              <span className="text-slate-600">{k}</span><span className={Number(v) > 0 ? 'text-red-700 font-bold' : 'text-slate-400'}>{v}</span>
                            </li>
                          ))}
                          <li className="flex justify-between font-mono text-[11px] border-t border-slate-200 mt-1 pt-1">
                            <span className="text-slate-600">counters (reset)</span><span className="text-red-700 font-bold">{purgePreview.would_reset_counters}</span>
                          </li>
                        </ul>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase tracking-widest text-emerald-700 font-semibold mb-1">Would preserve</div>
                        <ul className="space-y-0.5">
                          {Object.entries(purgePreview.would_preserve || {}).map(([k, v]) => (
                            <li key={k} className="flex justify-between font-mono text-[11px]">
                              <span className="text-slate-600">{k}</span><span className="text-emerald-700 font-bold">{v}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        {manifest.sections.map((section) => {
          const Icon = ICONS[section.icon] || Package;
          return (
            <section key={section.title} className="bg-white rounded-xl border border-slate-200 overflow-hidden" data-testid={`dc-section-${section.title.replace(/\s+/g,'-').toLowerCase()}`}>
              <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2 bg-slate-50">
                <Icon className="w-4 h-4 text-slate-500" />
                <h2 className="text-sm font-semibold text-slate-800">{section.title}</h2>
              </div>
              <div className="divide-y divide-slate-100">
                {section.items.map((item, idx) => (
                  <div key={idx} className="px-4 py-3 flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-slate-900">{item.label}</div>
                      {item.note && <div className="text-[12px] text-slate-500 mt-0.5">{item.note}</div>}
                      <div className="text-[11px] text-slate-400 mt-1 flex items-center gap-2 flex-wrap">
                        {item.size_mb !== null && item.size_mb !== undefined && <span>{item.size_mb} MB</span>}
                        {item.modified_at && <span>· updated {new Date(item.modified_at).toLocaleDateString('en-IN')}</span>}
                        {item.method && <span>· HTTP {item.method}</span>}
                      </div>
                    </div>
                    {item.available === false ? (
                      <span className="text-[11px] uppercase font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">Pending</span>
                    ) : item.route ? (
                      <a
                        href={item.route}
                        target="_blank" rel="noreferrer"
                        className="h-9 px-3 bg-slate-900 hover:bg-slate-800 text-white rounded text-sm font-semibold inline-flex items-center gap-1.5"
                        data-testid={`dc-download-${section.title.replace(/\s+/g,'-').toLowerCase()}-${idx}`}
                      >
                        <ExternalLink className="w-4 h-4" /> Download
                      </a>
                    ) : (
                      <button
                        onClick={() => doDownload(item)}
                        disabled={busy === item.label}
                        className="h-9 px-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded text-sm font-semibold inline-flex items-center gap-1.5"
                        data-testid={`dc-download-${section.title.replace(/\s+/g,'-').toLowerCase()}-${idx}`}
                      >
                        {busy === item.label ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                        {busy === item.label ? 'Preparing…' : 'Download'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </section>
          );
        })}

        <section className="bg-slate-900 text-slate-100 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <h3 className="text-sm font-semibold">Ownership & Freedom</h3>
          </div>
          <ul className="text-[13px] text-slate-300 space-y-1 leading-relaxed">
            <li>· This software is the exclusive property of Balaji Convent & Junior College upon final payment.</li>
            <li>· No hidden dependencies, license locks, activation servers, subscription requirements or kill switches.</li>
            <li>· Every source file ships in its readable form. No obfuscation.</li>
            <li>· Balaji Convent can maintain, modify, enhance, rebuild, or continue development internally or through any third-party developer without permission.</li>
          </ul>
          <a
            href="#" onClick={(e) => { e.preventDefault(); doDownload({ label: 'License & Ownership', endpoint: '/api/deliverables/license' }); }}
            className="mt-3 inline-flex items-center gap-1.5 text-sm text-emerald-300 hover:text-emerald-200"
            data-testid="dc-license"
          >
            <FileText className="w-4 h-4" /> Download the signed License & Ownership document →
          </a>
        </section>
      </div>
    </>
  );
}
