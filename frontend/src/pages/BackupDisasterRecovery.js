import React, { useEffect, useState } from 'react';
import api from '@/lib/api';
import { PageHeader } from '@/components/Layout';
import { toast } from 'sonner';
import { RefreshCw, DatabaseBackup, Cloud, CloudOff, ShieldCheck, History, AlertTriangle } from 'lucide-react';

const STATUS_BADGE = {
  idle: { label: 'Idle', cls: 'bg-slate-100 text-slate-700' },
  running: { label: 'Running…', cls: 'bg-blue-100 text-blue-800 animate-pulse' },
  completed: { label: 'Completed & Verified', cls: 'bg-emerald-100 text-emerald-800' },
  upload_failed_local_preserved: { label: 'Local OK — Cloud Upload Failed', cls: 'bg-amber-100 text-amber-800' },
  failed: { label: 'Failed', cls: 'bg-red-100 text-red-800' },
};

function fmt(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN');
}
function fmtSize(bytes) {
  if (!bytes && bytes !== 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function BackupDisasterRecovery() {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => api.get('/system-backup/admin/status').then(r => setData(r.data)).catch(() => toast.error('Could not load backup status'));

  useEffect(() => {
    load();
    const t = setInterval(load, 10000); // backup can run for minutes — keep status fresh without a manual reload
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

  const retryUpload = async () => {
    setBusy(true);
    try {
      const { data: r } = await api.post('/system-backup/admin/retry-upload');
      toast.success(r.message || 'Retry started');
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Failed to retry upload'); }
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

  return (
    <>
      <PageHeader title="Backup / Disaster Recovery" subtitle="Daily encrypted database backup, verified on Google Drive"
        actions={<button onClick={load} className="h-9 px-3 border border-slate-300 rounded text-sm flex items-center gap-1.5 hover:bg-slate-50"><RefreshCw className="w-4 h-4" /> Refresh</button>}
      />
      <div className="p-6 space-y-4">
        <div className="bg-white border border-slate-200 rounded p-5">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center"><DatabaseBackup className="w-5 h-5 text-slate-600" /></div>
              <div>
                <div className="font-heading font-semibold text-slate-900">Current Status</div>
                <div className="text-[12px] text-slate-500">{data.date ? `Cycle: ${data.date}` : 'No backup has run yet'}</div>
              </div>
            </div>
            <span className={`text-[12px] px-2.5 py-1 rounded-full font-medium ${badge.cls}`} data-testid="backup-status-badge">{badge.label}</span>
          </div>
          {data.message && <div className="mt-3 text-[13px] text-slate-700 bg-slate-50 border border-slate-200 rounded px-3 py-2">{data.message}</div>}
          <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div><div className="text-[11px] uppercase tracking-wide text-slate-500">Last Success (any cycle)</div><div className="font-medium mt-0.5">{data.last_success_date || '—'}</div></div>
            <div><div className="text-[11px] uppercase tracking-wide text-slate-500">Started</div><div className="font-medium mt-0.5">{fmt(data.started_at)}</div></div>
            <div><div className="text-[11px] uppercase tracking-wide text-slate-500">Completed</div><div className="font-medium mt-0.5">{fmt(data.completed_at)}</div></div>
            <div><div className="text-[11px] uppercase tracking-wide text-slate-500">Local Backup Size</div><div className="font-medium mt-0.5">{fmtSize(data.local_backup_size)}</div></div>
          </div>
          <div className="mt-4 flex items-center gap-4 text-[12px]">
            <span className="flex items-center gap-1.5">{data.gdrive_connected ? <Cloud className="w-3.5 h-3.5 text-emerald-600" /> : <CloudOff className="w-3.5 h-3.5 text-red-600" />} Google Drive: {data.gdrive_connected ? 'Connected' : 'Not connected yet'}</span>
            <span className="flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5 text-slate-500" /> Encryption key: {data.encryption_key_present ? 'Present' : 'Will be generated on first backup'}</span>
          </div>
          {!data.gdrive_connected && (
            <div className="mt-3 text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2 flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              Google Drive is not connected. Run <code className="font-mono">scripts/setup_google_drive_backup.py</code> once on the Main Server (see 10-backup-restore/BACKUP_DISASTER_RECOVERY.md) — local encrypted backups still complete normally without it.
            </div>
          )}
          <div className="mt-4 flex gap-2">
            <button onClick={runNow} disabled={busy || data.status === 'running'} data-testid="backup-run-now" className="h-9 px-4 bg-blue-600 text-white rounded text-sm disabled:opacity-60">Backup Now</button>
            {data.status === 'upload_failed_local_preserved' && (
              <button onClick={retryUpload} disabled={busy} data-testid="backup-retry-upload" className="h-9 px-4 border border-amber-400 text-amber-800 rounded text-sm hover:bg-amber-50 disabled:opacity-60">Retry Pending Upload</button>
            )}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 font-heading font-medium text-sm">Local Encrypted Backups</div>
          <table className="w-full dense-table">
            <thead><tr className="text-left text-[11px] uppercase tracking-wide text-slate-600"><th className="pl-3 py-2">File</th><th>Size</th><th>Modified</th><th></th></tr></thead>
            <tbody>
              {(!data.local_backups || data.local_backups.length === 0) && <tr><td colSpan={4} className="text-center py-6 text-slate-500">No local backups yet.</td></tr>}
              {data.local_backups?.map(b => (
                <tr key={b.filename} className="border-t border-slate-100">
                  <td className="pl-3 py-1.5 font-mono text-[12px]">{b.filename}</td>
                  <td className="text-[12px]">{fmtSize(b.size)}</td>
                  <td className="text-[12px] text-slate-500">{fmt(b.modified)}</td>
                  <td className="pr-3 text-right"><button onClick={() => verify(b.filename)} disabled={busy} data-testid={`verify-${b.filename}`} className="text-[12px] text-blue-700 hover:underline disabled:opacity-60">Verify Backup</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="bg-white border border-slate-200 rounded overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 font-heading font-medium text-sm flex items-center gap-1.5"><History className="w-4 h-4" /> History</div>
          <div className="p-4 max-h-80 overflow-y-auto space-y-1.5">
            {(!data.history || data.history.length === 0) && <div className="text-sm text-slate-500">No events yet.</div>}
            {data.history?.map((h, i) => (
              <div key={i} className="text-[12px] border-b border-slate-50 pb-1.5 flex justify-between gap-3">
                <span><span className="font-medium capitalize">{h.event.replace(/_/g, ' ')}</span>{h.detail ? ` — ${h.detail}` : ''}</span>
                <span className="text-slate-400 whitespace-nowrap">{fmt(h.at)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="text-[11px] text-slate-500">
          No automatic restore is provided here — restoring is a deliberate, Master-PIN-protected administrator action, not a self-service click.
          Backups are never deleted automatically; retention stays manual unless explicitly configured later.
        </div>
      </div>
    </>
  );
}
