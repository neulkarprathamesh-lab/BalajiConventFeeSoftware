import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import api, { API_BASE } from '@/lib/api';
import { PageHeader } from '@/components/Layout';
import AdminPinPrompt from '@/components/AdminPinPrompt';
import { Download, Upload, Shield, PackageOpen, CheckCircle2, AlertTriangle, HardDrive, RefreshCw } from 'lucide-react';

// Runtime-detected (never a build-time env var) - see lib/api.js.
const BACKEND = API_BASE;

const fmtBytes = (n) => n < 1024 ? `${n} B` : n < 1024*1024 ? `${(n/1024).toFixed(1)} KB` : `${(n/1048576).toFixed(2)} MB`;

export default function ConfigExportImport() {
  const [prompt, setPrompt] = useState(null);
  const [importResult, setImportResult] = useState(null);
  const [version, setVersion] = useState(null);
  const [replace, setReplace] = useState(false);
  const [backups, setBackups] = useState([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.get('/version').then(r => setVersion(r.data)).catch(()=>{});
    loadBackups();
  }, []);
  const loadBackups = () => api.get('/config/backups').then(r => setBackups(r.data)).catch(()=>{});

  const doExport = () => setPrompt({
    mode: 'pin', title: 'Export School Configuration',
    message: 'This will download a ZIP with all receipt types, departments, classes, fee heads, fee structures, bus routes and settings.',
    onOk: async (headers) => {
      try {
        const token = localStorage.getItem('bc.token');
        const r = await fetch(`${BACKEND}/api/config/export`, {
          headers: { 'Authorization': `Bearer ${token}`, ...headers }
        });
        if (!r.ok) throw new Error('Export failed');
        const blob = await r.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `balaji-config-${new Date().toISOString().slice(0,10)}.zip`;
        document.body.appendChild(a); a.click(); a.remove();
        toast.success('Configuration downloaded');
      } catch (e) { toast.error('Export failed'); }
    }
  });

  const doImport = (file) => setPrompt({
    mode: 'dual',
    title: 'Import School Configuration',
    message: 'This is a HIGH-RISK action that will change master data. Enter your PIN and Admin Password (dual authorisation).',
    onOk: async (headers) => {
      const token = localStorage.getItem('bc.token');
      const fd = new FormData();
      fd.append('file', file);
      try {
        const r = await fetch(`${BACKEND}/api/config/import?replace=${replace}`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, ...headers },
          body: fd,
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.detail || 'Import failed');
        setImportResult(j);
        toast.success('Configuration imported');
      } catch (e) { toast.error(e.message || 'Import failed'); }
    }
  });

  return (
    <>
      <PageHeader title="Configuration Export / Import"
        subtitle="Move school setup between PCs — receipt types, fees, departments, classes, settings"
      />
      <div className="p-6 space-y-4 max-w-4xl">
        {version && (
          <div className="bg-slate-900 text-white rounded-lg p-4 flex items-center justify-between">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">Current Version</div>
              <div className="font-heading text-2xl font-bold" data-testid="cfg-version">{version.app_version}</div>
            </div>
            <div className="grid grid-cols-3 gap-4 text-[11px] text-slate-300">
              <div><div className="text-slate-500 uppercase tracking-widest text-[9px]">Database</div><div className="font-mono font-bold text-white">v{version.database_version}</div></div>
              <div><div className="text-slate-500 uppercase tracking-widest text-[9px]">Templates</div><div className="font-mono font-bold text-white">v{version.receipt_template_version}</div></div>
              <div><div className="text-slate-500 uppercase tracking-widest text-[9px]">Build</div><div className="font-mono font-bold text-white">{version.build_date}</div></div>
            </div>
          </div>
        )}

        {/* Export card */}
        <div className="bg-white border border-slate-200 rounded-lg p-5 flex items-start gap-4">
          <div className="w-12 h-12 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center flex-shrink-0"><Download className="w-6 h-6" /></div>
          <div className="flex-1">
            <div className="font-heading font-semibold text-lg">Export Configuration</div>
            <div className="text-[12px] text-slate-600 mt-0.5">Downloads a portable ZIP with receipt types, departments, classes, fee heads & structures, settings, bus routes and users (passwords excluded).</div>
            <button data-testid="cfg-export" onClick={doExport} className="mt-3 h-9 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-sm flex items-center gap-1.5"><Download className="w-4 h-4" /> Export ZIP (requires PIN)</button>
          </div>
        </div>

        {/* Import card */}
        <div className="bg-white border border-slate-200 rounded-lg p-5 flex items-start gap-4">
          <div className="w-12 h-12 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center flex-shrink-0"><Upload className="w-6 h-6" /></div>
          <div className="flex-1">
            <div className="font-heading font-semibold text-lg">Import Configuration</div>
            <div className="text-[12px] text-slate-600 mt-0.5">Upload a configuration ZIP exported from another Balaji instance. Perfect for cloning a school's setup to a new site.</div>
            <div className="mt-3 flex items-center gap-4">
              <label className="inline-flex items-center gap-2 text-[12px] text-slate-700 bg-slate-50 border border-slate-200 rounded px-3 py-1.5">
                <input type="checkbox" checked={replace} onChange={e=>setReplace(e.target.checked)} />
                <b>Replace mode</b> (wipes existing rows first — DANGER)
              </label>
              <label className="inline-flex items-center gap-2">
                <input type="file" accept=".zip" data-testid="cfg-file" onChange={e => e.target.files?.[0] && doImport(e.target.files[0])} className="text-[12px]" />
              </label>
            </div>
            <div className="mt-2 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1 inline-flex items-center gap-1.5">
              <Shield className="w-3 h-3" /> Dual authorisation required — Admin PIN + Password.
            </div>
          </div>
        </div>

        {importResult && (
          <div className="bg-white border-2 border-emerald-500 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
              <div className="font-heading font-semibold">Import Summary</div>
            </div>
            {importResult.summary?.pre_backup && (
              <div className="mb-3 p-2 bg-emerald-50 border border-emerald-200 rounded text-[12px] text-emerald-900">
                <b>Auto-backup created before import</b>: <code className="font-mono">{importResult.summary.pre_backup.filename}</code> · {fmtBytes(importResult.summary.pre_backup.size)} · sha256 <span className="font-mono text-[10px]">{importResult.summary.pre_backup.checksum_sha256?.slice(0,16)}…</span>
              </div>
            )}
            <div className="text-[11px] text-slate-500 mb-2">From: {importResult.manifest?.exported_by} on {importResult.manifest?.exported_at?.slice(0,10)} · App v{importResult.manifest?.app_version} · Mode: {importResult.replace_mode ? 'REPLACE' : 'MERGE'}</div>
            <table className="w-full text-sm border border-slate-200">
              <thead className="bg-slate-50 text-[11px] uppercase text-slate-600"><tr className="text-left"><th className="px-2 py-1.5">Collection</th><th className="px-2 py-1.5 text-right">Added</th><th className="px-2 py-1.5 text-right">Updated</th><th className="px-2 py-1.5 text-right">Total in File</th></tr></thead>
              <tbody>{Object.entries(importResult.summary?.imported || {}).map(([k, v]) => (
                <tr key={k} className="border-t border-slate-100">
                  <td className="px-2 py-1.5">{k}</td>
                  <td className="px-2 py-1.5 text-right text-emerald-700 font-mono">{v.added}</td>
                  <td className="px-2 py-1.5 text-right text-blue-700 font-mono">{v.updated}</td>
                  <td className="px-2 py-1.5 text-right font-mono">{v.total_in_file}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}

        {/* Backups panel */}
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-slate-900 text-white flex items-center justify-center"><HardDrive className="w-5 h-5" /></div>
              <div>
                <div className="font-heading font-semibold text-lg">Database Backups</div>
                <div className="text-[12px] text-slate-600">Full-DB ZIP dumps · auto-created before any Replace-mode import · verified for integrity</div>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={loadBackups} className="h-9 px-3 border border-slate-300 rounded text-sm hover:bg-slate-50 flex items-center gap-1.5"><RefreshCw className="w-4 h-4" /> Refresh</button>
              <button data-testid="cfg-backup-now" disabled={busy} onClick={()=>setPrompt({ mode:'pin', title:'Create Backup Now',
                message:'Dumps every collection into a verified ZIP under /app/backups.',
                onOk: async (h) => { setBusy(true); try { const {data} = await api.post('/config/backup', {}, { headers: h }); toast.success(`Backup ${data.filename} created · ${fmtBytes(data.size)}`); loadBackups(); } catch { toast.error('Backup failed'); } finally { setBusy(false); } }
              })} className="h-9 px-3 bg-slate-900 text-white rounded text-sm flex items-center gap-1.5"><HardDrive className="w-4 h-4" /> Backup Now (PIN)</button>
            </div>
          </div>
          <table className="w-full text-sm border border-slate-200">
            <thead className="bg-slate-50 text-[11px] uppercase text-slate-600"><tr className="text-left"><th className="px-2 py-1.5">Created</th><th className="px-2 py-1.5">Kind</th><th className="px-2 py-1.5">Filename</th><th className="px-2 py-1.5 text-right">Size</th><th className="px-2 py-1.5">Collections</th><th className="px-2 py-1.5">By</th><th></th></tr></thead>
            <tbody>
              {backups.length === 0 && <tr><td colSpan="7" className="p-4 text-center text-slate-500 text-[13px]">No backups yet — click <b>Backup Now</b> to create the first one.</td></tr>}
              {backups.map(b => (
                <tr key={b.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-2 py-1.5 text-[12px]">{new Date(b.created_at).toLocaleString('en-IN')}</td>
                  <td className="px-2 py-1.5"><span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${b.kind==='pre-import' ? 'bg-amber-100 text-amber-800' : b.kind==='manual' ? 'bg-blue-100 text-blue-800' : 'bg-slate-200 text-slate-700'}`}>{b.kind}</span></td>
                  <td className="px-2 py-1.5 font-mono text-[11px] truncate max-w-xs">{b.filename}</td>
                  <td className="px-2 py-1.5 text-right font-mono text-[12px]">{fmtBytes(b.size || 0)}</td>
                  <td className="px-2 py-1.5 text-[11px] text-slate-600">{b.collections?.length || 0}</td>
                  <td className="px-2 py-1.5 text-[12px]">{b.created_by}</td>
                  <td className="px-2 py-1.5 text-right">
                    <button data-testid={`cfg-backup-dl-${b.id}`} onClick={()=>setPrompt({ mode:'pin', title:'Download Backup', message:`Download ${b.filename}?`,
                      onOk: async (h) => {
                        const token = localStorage.getItem('bc.token');
                        const r = await fetch(`${BACKEND}/api/config/backups/${b.id}/download`, { headers: { 'Authorization': `Bearer ${token}`, ...h } });
                        if (!r.ok) return toast.error('Download failed');
                        const blob = await r.blob();
                        const a = document.createElement('a');
                        a.href = URL.createObjectURL(blob); a.download = b.filename; a.click();
                      }
                    })} className="text-[12px] px-2 py-1 border border-slate-300 rounded hover:bg-white">Download</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <AdminPinPrompt prompt={prompt} onClose={()=>setPrompt(null)} />
    </>
  );
}
