import React, { useEffect, useState } from 'react';
import api from '@/lib/api';
import { PageHeader } from '@/components/Layout';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { Pencil, RefreshCw, AlertTriangle, KeyRound, Trash2, Shield, Lock, X } from 'lucide-react';

const STATUS_BADGE = {
  online: { label: '🟢 Online', cls: 'bg-emerald-100 text-emerald-800' },
  offline: { label: '🔴 Offline', cls: 'bg-red-100 text-red-800' },
};

function fmt(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN');
}

export default function ConnectedPCs() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'administrator';
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [renaming, setRenaming] = useState(null); // device id being renamed
  const [nameInput, setNameInput] = useState('');
  const [failedOps, setFailedOps] = useState([]);
  const [showAll, setShowAll] = useState(false); // management needs to see offline/registered-but-quiet devices too
  const [pwTarget, setPwTarget] = useState(null); // device being given a new password
  const [deleteTarget, setDeleteTarget] = useState(null); // device pending PIN-confirmed deletion

  const load = () => {
    setLoading(true);
    // online_only=true by default on this screen for the "who's active right
    // now" view; "Show all registered devices" switches to every
    // non-revoked device (incl. quiet/offline ones) so Admin can manage a PC
    // that isn't currently running.
    api.get(`/devices${showAll ? '' : '?online_only=true'}`).then((r) => setDevices(r.data || [])).catch(() => toast.error('Could not load Connected PCs')).finally(() => setLoading(false));
    api.get('/sync/failed-operations').then((r) => setFailedOps(r.data || [])).catch(() => {});
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 20000); // auto-refresh so status stays current without a manual reload
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAll]);

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
        actions={
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-[12px] text-slate-600">
              <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
              Show all registered devices (incl. offline)
            </label>
            <button onClick={load} className="h-9 px-3 border border-slate-300 rounded text-sm flex items-center gap-1.5 hover:bg-slate-50"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh</button>
          </div>
        }
      />
      <div className="p-6 space-y-4">
        <div className="bg-white border border-slate-200 rounded overflow-hidden">
          <table className="w-full dense-table">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-slate-600">
                <th className="pl-3 py-2">PC Name</th><th>Client ID</th><th>Status</th><th>IP Address</th><th>Last Seen</th><th>Last Sync</th>
                <th className="text-right">Pending</th><th>Current User</th><th></th>
              </tr>
            </thead>
            <tbody>
              {devices.length === 0 && <tr><td colSpan={9} className="text-center py-8 text-slate-500">No devices have synchronized yet.</td></tr>}
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
                    <td className="font-mono text-[11px] text-slate-500" title={d.id}>{d.id.slice(0, 8)}…</td>
                    <td><span className={`text-[11px] px-1.5 py-0.5 rounded font-medium ${badge.cls}`}>{badge.label}</span></td>
                    <td className="text-[12px] font-mono text-slate-600">{d.ip_address || '—'}</td>
                    <td className="text-[12px] text-slate-600">{fmt(d.last_seen)}</td>
                    <td className="text-[12px] text-slate-600">{fmt(d.last_sync_at)}</td>
                    <td className="text-right tabular font-medium">{d.pending_count ?? 0}</td>
                    <td className="text-[12px] text-slate-600">{d.current_user_name || '—'}</td>
                    <td className="pr-3 text-right whitespace-nowrap">
                      {renaming !== d.id && (
                        <button onClick={() => openRename(d)} title="Assign a friendly name" className="text-slate-400 hover:text-blue-700 mr-2"><Pencil className="w-4 h-4" /></button>
                      )}
                      {isAdmin && (
                        <>
                          <button onClick={() => setPwTarget(d)} title="Set/change this device's credential" data-testid={`device-setpw-${d.id}`} className="text-slate-400 hover:text-blue-700 mr-2"><KeyRound className="w-4 h-4" /></button>
                          <button onClick={() => setDeleteTarget(d)} title="Delete/revoke this device" data-testid={`device-delete-${d.id}`} className="text-slate-400 hover:text-red-700"><Trash2 className="w-4 h-4" /></button>
                        </>
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
          By default only PCs heard from within the last 90 seconds are listed — check "Show all registered devices" to also see offline/quiet ones for management. IP Address reflects that PC's current LAN address and updates automatically if it reconnects from a different one.
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

      {pwTarget && (
        <SetDevicePasswordModal device={pwTarget} onClose={() => setPwTarget(null)} />
      )}
      {deleteTarget && (
        <DeleteDeviceModal device={deleteTarget} onClose={() => setDeleteTarget(null)} onDeleted={() => { setDeleteTarget(null); load(); }} />
      )}
    </>
  );
}

function SetDevicePasswordModal({ device, onClose }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [newlySet, setNewlySet] = useState(null); // shown once after a successful save

  const save = async (e) => {
    e.preventDefault();
    if (password.length < 6) return toast.error('Password must be at least 6 characters');
    setBusy(true);
    try {
      await api.post(`/devices/${device.id}/set-password`, { password });
      setNewlySet(password);
      toast.success('Device credential updated');
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Failed to set password');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-white rounded-lg shadow-2xl w-full max-w-sm">
        <div className="p-5 border-b border-slate-200 flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-700 flex items-center justify-center flex-shrink-0"><KeyRound className="w-5 h-5" /></div>
          <div className="flex-1">
            <div className="font-heading font-bold text-slate-900">Set Device Credential</div>
            <div className="text-[12px] text-slate-600 mt-0.5">{device.friendly_name || 'Unnamed device'} ({device.id.slice(0, 8)}…)</div>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700"><X className="w-4 h-4" /></button>
        </div>
        {newlySet ? (
          <div className="p-5 space-y-3">
            <div className="text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">
              This password is shown only once. Relay it to whoever operates this PC — it is stored only as a hash and cannot be recovered later.
            </div>
            <div className="font-mono text-sm bg-slate-100 border border-slate-300 rounded px-3 py-2 select-all" data-testid="device-new-password">{newlySet}</div>
            <button onClick={onClose} className="h-9 px-4 bg-blue-600 text-white rounded text-sm w-full">Done</button>
          </div>
        ) : (
          <form onSubmit={save} className="p-5 space-y-3">
            <label className="block">
              <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">New Password (min 6 characters)</div>
              <input data-testid="device-pw-input" type="text" autoFocus value={password} onChange={e => setPassword(e.target.value)}
                className="w-full h-10 px-3 border border-slate-300 rounded text-sm font-mono" />
            </label>
            <div className="flex items-center gap-2 pt-2">
              <button type="button" onClick={onClose} className="h-9 px-4 border border-slate-300 rounded text-sm">Cancel</button>
              <button type="submit" disabled={busy} data-testid="device-pw-save" className="flex-1 h-9 bg-blue-600 text-white rounded text-sm font-semibold disabled:opacity-60">
                {busy ? 'Saving…' : 'Save Credential'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function DeleteDeviceModal({ device, onClose, onDeleted }) {
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);

  const confirmDelete = async (e) => {
    e.preventDefault();
    if (pin.length < 4) return toast.error('Master PIN is required');
    setBusy(true);
    try {
      await api.delete(`/devices/${device.id}`, { headers: { 'X-Device-Delete-Pin': pin } });
      toast.success(`${device.friendly_name || 'Device'} removed — it can no longer sync until registered again`);
      onDeleted();
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Delete failed — no changes were made');
      setPin('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <form onSubmit={confirmDelete} onClick={e => e.stopPropagation()} className="bg-white rounded-lg shadow-2xl w-full max-w-sm border-t-4 border-red-600">
        <div className="p-5 border-b border-slate-200 flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-red-50 text-red-700 flex items-center justify-center flex-shrink-0"><Shield className="w-5 h-5" /></div>
          <div className="flex-1">
            <div className="font-heading font-bold text-slate-900">Delete / Revoke Client Device</div>
            <div className="text-[12px] text-slate-600 mt-0.5">
              {device.friendly_name || 'Unnamed device'} ({device.id.slice(0, 8)}…) will no longer be able to authenticate or sync. Students, receipts, payments and other production data are never affected.
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-3">
          <label className="block">
            <div className="text-[11px] uppercase tracking-widest text-slate-600 font-bold mb-1 flex items-center gap-1"><Lock className="w-3 h-3" /> Master PIN</div>
            <input data-testid="device-delete-pin" type="password" inputMode="numeric" maxLength={8} value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
              placeholder="••••" className="w-full h-11 px-3 border-2 border-slate-300 rounded font-mono text-lg tracking-widest text-center focus:ring-2 focus:ring-blue-600 focus:border-blue-600 focus:outline-none" />
          </label>
          <div className="flex items-center gap-2 pt-2">
            <button type="button" onClick={onClose} className="h-9 px-4 border border-slate-300 rounded text-sm hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={busy} data-testid="device-delete-confirm" className="flex-1 h-9 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white rounded text-sm font-semibold">
              {busy ? 'Deleting…' : 'Verify PIN & Delete'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
