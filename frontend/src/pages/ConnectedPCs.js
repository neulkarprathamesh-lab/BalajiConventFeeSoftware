import React, { useEffect, useState } from 'react';
import api from '@/lib/api';
import { PageHeader } from '@/components/Layout';
import { toast } from 'sonner';
import { Pencil, RefreshCw, AlertTriangle } from 'lucide-react';

const STATUS_BADGE = {
  online: { label: '🟢 Online', cls: 'bg-emerald-100 text-emerald-800' },
  offline: { label: '🔴 Offline', cls: 'bg-red-100 text-red-800' },
};

function fmt(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN');
}

export default function ConnectedPCs() {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [renaming, setRenaming] = useState(null); // device id being renamed
  const [nameInput, setNameInput] = useState('');
  const [failedOps, setFailedOps] = useState([]);

  const load = () => {
    setLoading(true);
    // online_only=true - a PC that has gone quiet past the heartbeat timeout
    // must disappear from this screen entirely, not just show a red badge;
    // it reappears automatically the moment its heartbeat resumes.
    api.get('/devices?online_only=true').then((r) => setDevices(r.data || [])).catch(() => toast.error('Could not load Connected PCs')).finally(() => setLoading(false));
    api.get('/sync/failed-operations').then((r) => setFailedOps(r.data || [])).catch(() => {});
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 20000); // auto-refresh so status stays current without a manual reload
    return () => clearInterval(t);
  }, []);

  const openRename = (d) => { setRenaming(d.id); setNameInput(d.friendly_name || ''); };
  const saveRename = async (id) => {
    if (!nameInput.trim()) return toast.error('Enter a name');
    try {
      await api.patch(`/devices/${id}`, { friendly_name: nameInput.trim() });
      toast.success('PC name updated');
      setRenaming(null);
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Failed'); }
  };

  return (
    <>
      <PageHeader title="Connected PCs" subtitle="Client/Cashier devices synchronized with this Main Server"
        actions={<button onClick={load} className="h-9 px-3 border border-slate-300 rounded text-sm flex items-center gap-1.5 hover:bg-slate-50"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh</button>}
      />
      <div className="p-6 space-y-4">
        <div className="bg-white border border-slate-200 rounded overflow-hidden">
          <table className="w-full dense-table">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-slate-600">
                <th className="pl-3 py-2">PC Name</th><th>Status</th><th>IP Address</th><th>Last Seen</th><th>Last Sync</th>
                <th className="text-right">Pending</th><th>Current User</th><th></th>
              </tr>
            </thead>
            <tbody>
              {devices.length === 0 && <tr><td colSpan={8} className="text-center py-8 text-slate-500">No devices have synchronized yet.</td></tr>}
              {devices.map((d) => {
                const badge = STATUS_BADGE[d.status] || STATUS_BADGE.offline;
                return (
                  <tr key={d.id} className="border-t border-slate-100">
                    <td className="pl-3 py-1.5 font-medium">
                      {renaming === d.id ? (
                        <div className="flex items-center gap-1.5">
                          <input autoFocus value={nameInput} onChange={(e) => setNameInput(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && saveRename(d.id)}
                            className="h-8 px-2 border border-slate-300 rounded text-sm w-32" />
                          <button onClick={() => saveRename(d.id)} className="text-xs text-blue-700 hover:underline">Save</button>
                          <button onClick={() => setRenaming(null)} className="text-xs text-slate-500 hover:underline">Cancel</button>
                        </div>
                      ) : (
                        <span>{d.friendly_name || <span className="text-slate-400 italic">Unnamed device</span>}</span>
                      )}
                    </td>
                    <td><span className={`text-[11px] px-1.5 py-0.5 rounded font-medium ${badge.cls}`}>{badge.label}</span></td>
                    <td className="text-[12px] font-mono text-slate-600">{d.ip_address || '—'}</td>
                    <td className="text-[12px] text-slate-600">{fmt(d.last_seen)}</td>
                    <td className="text-[12px] text-slate-600">{fmt(d.last_sync_at)}</td>
                    <td className="text-right tabular font-medium">{d.pending_count ?? 0}</td>
                    <td className="text-[12px] text-slate-600">{d.current_user_name || '—'}</td>
                    <td className="pr-3 text-right">
                      {renaming !== d.id && (
                        <button onClick={() => openRename(d)} title="Assign a friendly name" className="text-slate-400 hover:text-blue-700"><Pencil className="w-4 h-4" /></button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="text-[11px] text-slate-500">
          A device's underlying identity never changes even if you rename it — renaming only updates the label shown here and in sync/audit records.
          Only PCs heard from within the last 90 seconds are listed — a PC drops off this list automatically when it goes quiet, and reappears the moment its heartbeat resumes. IP Address reflects that PC's current LAN address and updates automatically if it reconnects from a different one.
        </div>

        {failedOps.length > 0 && (
          <div className="bg-white border border-red-200 rounded overflow-hidden" data-testid="sync-failures">
            <div className="px-4 py-2 border-b border-red-100 bg-red-50 font-heading font-medium text-sm text-red-800 flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4" /> Sync Issues — offline transactions still failing to reach this server
            </div>
            <table className="w-full dense-table">
              <thead><tr className="text-left text-[11px] uppercase tracking-wide text-slate-600"><th className="pl-3 py-2">PC</th><th>Type</th><th>Error</th><th>Retries</th><th>Last Attempt</th></tr></thead>
              <tbody>
                {failedOps.map((f) => (
                  <tr key={f.local_id} className="border-t border-slate-100">
                    <td className="pl-3 py-1.5">{f.device_name}</td>
                    <td className="text-[12px] capitalize">{(f.op_type || '').replace('_', ' ')}</td>
                    <td className="text-[12px] text-red-700">{typeof f.error === 'string' ? f.error : JSON.stringify(f.error)}</td>
                    <td className="text-[12px]">{f.retry_count || 0}</td>
                    <td className="text-[12px] text-slate-600">{fmt(f.applied_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-4 py-2 text-[11px] text-slate-500 bg-slate-50">These are automatically retried on the Client PC's next sync — they only stop retrying once resolved or after 20 attempts.</div>
          </div>
        )}
      </div>
    </>
  );
}
