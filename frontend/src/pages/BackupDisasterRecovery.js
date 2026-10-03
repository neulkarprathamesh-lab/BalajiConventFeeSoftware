import React, { useEffect, useState } from 'react';
import api from '@/lib/api';
import { PageHeader } from '@/components/Layout';
import { toast } from 'sonner';
import { RefreshCw, DatabaseBackup, FolderSync, ShieldCheck, History, AlertTriangle, CheckCircle2, Circle, XCircle, Loader2, Info } from 'lucide-react';

const STATUS_BADGE = {
  idle: { label: 'No backup yet', cls: 'bg-slate-100 text-slate-700' },
  running: { label: 'In progress', cls: 'bg-blue-100 text-blue-800' },
  completed: { label: 'Placed in JioAICloud sync folder', cls: 'bg-emerald-100 text-emerald-800' },
  upload_failed_local_preserved: { label: 'Sync failed — local backup kept', cls: 'bg-amber-100 text-amber-800' },
  failed: { label: 'Backup failed', cls: 'bg-red-100 text-red-800' },
};

const DATA_CATEGORIES = [
  ['Students & profiles', ['students', 'student_fee_overrides', 'student_opening_balances', 'import_batches']],
  ['Fees & classes', ['fee_structures', 'fee_heads', 'fee_details', 'classes', 'departments']],
  ['Payments & receipts', ['receipts', 'receipt_types', 'receipt_archives', 'receipt_format_default', 'counters']],
  ['Adjustments & extensions', ['adjustments', 'extensions', 'fee_adjustment_applications', 'fee_edit_access_requests']],
  ['Bus', ['bus_stops', 'bus_assignments', 'bus_charges', 'bus_charging_state']],
  ['Accounting (bills, expenses, vouchers)', ['bills', 'bill_categories', 'bill_schools', 'expenses', 'expense_categories']],
  ['Users, roles & security', ['users', 'security_config']],
  ['Audit, devices & sync', ['audit_log', 'devices', 'sync_operations', 'client_updates', 'client_update_reports', 'diagnostic_reports']],
  ['Settings & other', ['settings', 'reminders', 'backups']],
];

function fmt(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) + ' IST';
}
function fmtSize(bytes) {
  if (!bytes && bytes !== 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function dataGroups(collections) {
  const present = new Set(collections || []);
  const used = new Set();
  const groups = DATA_CATEGORIES.map(([label, names]) => {
    const hit = names.filter(n => present.has(n));
    hit.forEach(n => used.add(n));
    return { label, count: hit.length };
  });
  const other = [...present].filter(n => !used.has(n)).length;
  if (other) groups.push({ label: 'Other application data', count: other });
  return groups.filter(g => g.count > 0);
}

function buildSteps(d) {
  const attempt = d.attempt || 0;
  const max = d.max_attempts || 3;
  const backedUp = !!d.local_backup_name;
  const syncing = d.phase === 'placing_in_sync_folder' || d.phase === 'retry_wait';
  const placed = d.sync_state === 'placed_in_sync_folder';
  const failed = d.status === 'upload_failed_local_preserved' || d.status === 'failed';
  const running = d.status === 'running';

  const steps = [
    { label: 'Folder accessible and writable', state: d.sync_folder_accessible ? 'done' : (failed ? 'failed' : 'pending') },
    { label: 'Backup created', state: backedUp ? 'done' : (running && d.phase === 'backing_up' ? 'active' : 'pending') },
    { label: 'Encrypted (Fernet / AES)', state: backedUp ? 'done' : 'pending' },
  ];
  if (syncing) steps.push({ label: `Copying to JioAICloud folder — attempt ${attempt} of ${max}`, state: 'active' });
  else if (attempt > 0) steps.push({ label: `Copying to JioAICloud folder — ${attempt} of ${max} attempts used`, state: placed ? 'done' : 'failed' });
  else steps.push({ label: `Copying to JioAICloud folder (up to ${max} attempts, 10 min each)`, state: 'pending' });
  steps.push({ label: 'SHA-256 verified (copy matches local encrypted file)', state: d.sha256_verified ? 'done' : (failed ? 'failed' : 'pending') });
  steps.push({ label: 'Placed in JioAICloud sync folder', state: placed ? 'done' : (failed ? 'failed' : 'pending') });
  return steps;
}

function StepIcon({ state }) {
  if (state === 'done') return <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />;
  if (state === 'active') return <Loader2 className="w-4 h-4 text-blue-600 animate-spin flex-shrink-0" />;
  if (state === 'failed') return <XCircle className="w-4 h-4 text-red-600 flex-shrink-0" />;
  return <Circle className="w-4 h-4 text-slate-300 flex-shrink-0" />;
}

export default function BackupDisasterRecovery() {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showLegacy, setShowLegacy] = useState(false);

  const load = () => api.get('/system-backup/admin/status').then(r => setData(r.data)).catch(() => toast.error('Could not load backup status'));

  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, []);

  const runNow = async () => {
    setBusy(true);
    try {
      const { data: r } = await api.post('/system-backup/admin/run-now');
      toast.success(r.message || 'Backup started');
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Failed to start backup'); }
    setBusy(false);
  };

  const retrySync = async () => {
    setBusy(true);
    try {
      const { data: r } = await api.post('/system-backup/admin/retry-upload');
      toast.success(r.message || 'Retry started');
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Failed to retry'); }
    setBusy(false);
  };

  const verify = async (filename) => {
    setBusy(true);
    try {
      const { data: r } = await api.post(`/system-backup/admin/verify/${encodeURIComponent(filename)}`);
      toast.success(r.message || 'Verified');
    } catch (e) { toast.error(e?.response?.data?.detail || 'Verification failed'); }
    setBusy(false);
  };

  if (!data) return <div className="p-8 text-sm text-slate-500">Loading…</div>;
  const badge = STATUS_BADGE[data.status] || STATUS_BADGE.idle;
  const steps = buildSteps(data);
  const groups = dataGroups(data.collections_list);

  return (
    <>
      <PageHeader title="Backup / Disaster Recovery" subtitle="Encrypted full FeeHub database backup, placed in the JioAICloud synced folder"
        actions={<button onClick={load} className="h-9 px-3 border border-slate-300 rounded text-sm flex items-center gap-1.5 hover:bg-slate-50"><RefreshCw className="w-4 h-4" /> Refresh</button>}
      />
      <div className="p-6 space-y-4">
        <div className="bg-white border border-slate-200 rounded p-5" data-testid="backup-destination">
          <div className="text-[11px] uppercase tracking-wide text-slate-500">Backup destination</div>
          <div className="flex items-center gap-2 mt-1 font-heading font-semibold text-slate-900"><FolderSync className="w-4 h-4" /> JioAICloud synced folder</div>
          <div className="mt-2 text-[11px] uppercase tracking-wide text-slate-500">Path</div>
          <div className="font-mono text-[12px] text-slate-800 break-all" data-testid="sync-folder-path">{data.sync_folder || '—'}</div>
          <div className="mt-2 text-[12px] flex items-center gap-1.5" data-testid="sync-folder-access">
            {data.sync_folder_accessible
              ? <><CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Folder accessible and writable</>
              : <><AlertTriangle className="w-3.5 h-3.5 text-red-600" /> Folder not accessible — backups cannot be placed until it is available</>}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded p-5">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center"><DatabaseBackup className="w-5 h-5 text-slate-600" /></div>
              <div>
                <div className="font-heading font-semibold text-slate-900">Latest backup</div>
                <div className="text-[12px] text-slate-500">{data.date ? `Backup date ${data.date} (IST)` : 'No backup has run yet'}</div>
              </div>
            </div>
            <span className={`text-[12px] px-2.5 py-1 rounded-full font-medium ${badge.cls}`} data-testid="backup-status-badge">{badge.label}</span>
          </div>

          {data.message && <div className="mt-3 text-[13px] text-slate-700 bg-slate-50 border border-slate-200 rounded px-3 py-2" data-testid="backup-message">{data.message}</div>}

          <div className="mt-4">
            <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-2">Progress</div>
            <ol className="space-y-1.5" data-testid="backup-steps">
              {steps.map((s, i) => (
                <li key={i} className="flex items-start gap-2 text-[13px]">
                  <StepIcon state={s.state} />
                  <span className={s.state === 'pending' ? 'text-slate-400' : 'text-slate-800'}>{s.label}</span>
                </li>
              ))}
            </ol>
          </div>

          <div className="mt-4 grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
            <div><div className="text-[11px] uppercase tracking-wide text-slate-500">Backup filename</div><div className="font-medium mt-0.5 font-mono text-[12px] break-all" data-testid="backup-filename">{data.local_backup_name || '—'}</div></div>
            <div><div className="text-[11px] uppercase tracking-wide text-slate-500">Encrypted size</div><div className="font-medium mt-0.5">{fmtSize(data.local_backup_size_bytes)}</div></div>
            <div><div className="text-[11px] uppercase tracking-wide text-slate-500">Attempt</div><div className="font-medium mt-0.5">{data.attempt ? `${data.attempt} of ${data.max_attempts}` : '—'}</div></div>
            <div><div className="text-[11px] uppercase tracking-wide text-slate-500">Started</div><div className="font-medium mt-0.5">{fmt(data.started_at)}</div></div>
            <div><div className="text-[11px] uppercase tracking-wide text-slate-500">Completed</div><div className="font-medium mt-0.5">{fmt(data.completed_at)}</div></div>
            <div><div className="text-[11px] uppercase tracking-wide text-slate-500">SHA-256 check</div><div className="font-medium mt-0.5">{data.sha256_verified ? 'Matches local file' : (data.local_backup_name ? 'Not verified' : '—')}</div></div>
          </div>

          <div className="mt-4 flex gap-2">
            <button onClick={runNow} disabled={busy || data.status === 'running'} data-testid="backup-run-now" className="h-9 px-4 bg-blue-600 text-white rounded text-sm disabled:opacity-60">Backup Now</button>
            {(data.status === 'upload_failed_local_preserved' || data.status === 'failed') && data.local_backup_name && (
              <button onClick={retrySync} disabled={busy} data-testid="backup-retry-upload" className="h-9 px-4 border border-amber-400 text-amber-800 rounded text-sm hover:bg-amber-50 disabled:opacity-60">Retry Sync to JioAICloud</button>
            )}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded p-5" data-testid="data-included">
          <div className="font-heading font-medium text-sm">Data included</div>
          <div className="text-[12px] text-slate-600 mt-1">
            {data.collections_count
              ? <>{data.collections_count} MongoDB collections in this backup, covering the complete FeeHub database.</>
              : 'Collections are counted when a backup is created.'}
          </div>
          {groups.length > 0 && (
            <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-1 text-[12px]">
              {groups.map(g => <div key={g.label} className="flex justify-between border-b border-slate-100 py-1"><span>{g.label}</span><span className="text-slate-500">{g.count} collection{g.count === 1 ? '' : 's'}</span></div>)}
            </div>
          )}
        </div>

        <div className="bg-white border border-amber-200 rounded p-5" data-testid="cloud-confirmation-note">
          <div className="flex items-start gap-2 text-[12px] text-amber-900">
            <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <div>
              <div className="font-medium">What "Placed in sync folder" means</div>
              <div className="mt-1">FeeHub verified the local encrypted file: it was copied in completely and its SHA-256 matches. JioAICloud has no official confirmation API, so FeeHub cannot independently confirm that JioAICloud has uploaded it to the cloud. Cloud confirmation is unavailable through an official Jio API.</div>
              <div className="mt-1 flex items-center gap-1"><ShieldCheck className="w-3.5 h-3.5" /> The encrypted local copy is always kept, whatever the sync result.</div>
            </div>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 font-heading font-medium text-sm">Local encrypted backups</div>
          <table className="w-full dense-table">
            <thead><tr className="text-left text-[11px] uppercase tracking-wide text-slate-600"><th className="pl-3 py-2">File</th><th>Size</th><th>Created (IST)</th><th></th></tr></thead>
            <tbody>
              {(!data.local_backups || data.local_backups.length === 0) && <tr><td colSpan={4} className="text-center py-6 text-slate-500">No local backups yet.</td></tr>}
              {data.local_backups?.map(b => (
                <tr key={b.filename} className="border-t border-slate-100">
                  <td className="pl-3 py-1.5 font-mono text-[12px]">{b.filename}{b.legacy && <span className="ml-2 text-[10px] text-slate-500 font-sans">(previous system)</span>}</td>
                  <td className="text-[12px]">{fmtSize(b.size)}</td>
                  <td className="text-[12px] text-slate-500">{fmt(b.modified)}</td>
                  <td className="pr-3 text-right"><button onClick={() => verify(b.filename)} disabled={busy} data-testid={`verify-${b.filename}`} className="text-[12px] text-blue-700 hover:underline disabled:opacity-60">Verify Backup</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="bg-white border border-slate-200 rounded overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 font-heading font-medium text-sm flex items-center gap-1.5"><History className="w-4 h-4" /> Backup history</div>
          <div className="p-4 max-h-80 overflow-y-auto space-y-1.5">
            {(!data.history || data.history.length === 0) && <div className="text-sm text-slate-500">No events for the current JioAICloud backup system yet.</div>}
            {data.history?.map((h, i) => (
              <div key={i} className="text-[12px] border-b border-slate-50 pb-1.5 flex justify-between gap-3">
                <span><span className="font-medium capitalize">{h.event.replace(/_/g, ' ')}</span>{h.detail ? ` — ${h.detail}` : ''}</span>
                <span className="text-slate-400 whitespace-nowrap">{fmt(h.at)}</span>
              </div>
            ))}
          </div>
          {data.legacy_history?.length > 0 && (
            <div className="border-t border-slate-200">
              <button onClick={() => setShowLegacy(!showLegacy)} className="w-full px-4 py-2 text-left text-[12px] text-slate-600 hover:bg-slate-50" data-testid="legacy-toggle">
                {showLegacy ? '▾' : '▸'} Previous backup system — Google Drive era, historical audit records ({data.legacy_history.length})
              </button>
              {showLegacy && (
                <div className="p-4 max-h-64 overflow-y-auto space-y-1.5 bg-slate-50" data-testid="legacy-history">
                  {data.legacy_history.map((h, i) => (
                    <div key={i} className="text-[12px] text-slate-500 border-b border-slate-100 pb-1.5 flex justify-between gap-3">
                      <span>{h.event.replace(/_/g, ' ')}{h.detail ? ` — ${h.detail}` : ''}</span>
                      <span className="whitespace-nowrap">{fmt(h.at)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="text-[11px] text-slate-500">
          No automatic restore is provided here — restoring is a deliberate, Master-PIN-protected administrator action.
          Backups are never deleted automatically.
        </div>
      </div>
    </>
  );
}
