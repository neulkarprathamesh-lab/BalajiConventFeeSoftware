import React, { useEffect, useState } from 'react';
import api from '@/lib/api';
import { PageHeader } from '@/components/Layout';
import { toast } from 'sonner';
import { KeyRound, Check, X, Ban, RefreshCw } from 'lucide-react';

const STATUS_BADGE = {
  pending: 'bg-amber-100 text-amber-800',
  approved: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-slate-200 text-slate-600',
  revoked: 'bg-red-100 text-red-800',
};

function fmt(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN');
}

/**
 * Admin/Manager view of Cashier "Request Edit Access" requests (see
 * pages/LiveFeeUpdate.js and backend/routers/fee_edit_access.py). No push
 * notifications exist in this app - this list is polled, the same way the
 * existing Payment Extension approval queue works, so a new pending request
 * shows up here within a few seconds without a page reload.
 */
export default function FeeEditAccessRequests() {
  const [statusFilter, setStatusFilter] = useState('pending');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [pinFor, setPinFor] = useState(null); // request id awaiting PIN entry
  const [pin, setPin] = useState('');
  const [duration, setDuration] = useState(30);
  const [busy, setBusy] = useState(null);

  const load = () => {
    setLoading(true);
    api.get(`/fee-edit-access/requests?status=${statusFilter}`).then(r => setRows(r.data || []))
      .catch(() => toast.error('Could not load requests')).finally(() => setLoading(false));
  };
  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const openApprove = (req) => { setPinFor(req.id); setPin(''); setDuration(30); };

  const approve = async (e) => {
    e.preventDefault();
    if (!pin.trim()) return toast.error('Enter the Master PIN');
    setBusy(pinFor);
    try {
      await api.post(`/fee-edit-access/requests/${pinFor}/approve`, { duration_minutes: Number(duration) || 30 },
        { headers: { 'X-Fee-Edit-Access-Pin': pin } });
      toast.success('Approved — temporary access granted');
      setPinFor(null); setPin('');
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Invalid Master PIN'); }
    finally { setBusy(null); }
  };

  const reject = async (req) => {
    setBusy(req.id);
    try { await api.post(`/fee-edit-access/requests/${req.id}/reject`); toast.success('Rejected'); load(); }
    catch (e) { toast.error(e?.response?.data?.detail || 'Failed'); }
    finally { setBusy(null); }
  };

  const revoke = async (req) => {
    setBusy(req.id);
    try { await api.post(`/fee-edit-access/requests/${req.id}/revoke`); toast.success('Access revoked'); load(); }
    catch (e) { toast.error(e?.response?.data?.detail || 'Failed'); }
    finally { setBusy(null); }
  };

  return (
    <>
      <PageHeader title="Fee Edit Access Requests" subtitle="Cashier requests for temporary, class-scoped fee-edit permission"
        actions={<button onClick={load} className="h-9 px-3 border border-slate-300 rounded text-sm flex items-center gap-1.5 hover:bg-slate-50"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh</button>}
      />
      <div className="p-6 space-y-4">
        <div className="flex gap-2">
          {['pending', 'approved', 'rejected', 'revoked', 'all'].map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`h-8 px-3 rounded text-[12px] font-medium capitalize ${statusFilter === s ? 'bg-blue-600 text-white' : 'bg-white border border-slate-300 text-slate-600'}`}>
              {s}
            </button>
          ))}
        </div>
        <div className="bg-white border border-slate-200 rounded overflow-hidden">
          <table className="w-full dense-table">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-slate-600">
                <th className="pl-3 py-2">Requested</th><th>Cashier</th><th>PC</th><th>Class</th><th>Scope</th>
                <th>Reason</th><th>Status</th><th>Expires</th><th></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={9} className="text-center py-8 text-slate-500">No {statusFilter === 'all' ? '' : statusFilter} requests.</td></tr>}
              {rows.map(r => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="pl-3 py-1.5 text-[12px] text-slate-600">{fmt(r.created_at)}</td>
                  <td className="text-[12px] font-medium">{r.requested_by_name}</td>
                  <td className="text-[11px] font-mono text-slate-500">{r.device_id}</td>
                  <td className="text-[12px]">{r.class_name}{r.medium ? ` (${r.medium})` : ''}</td>
                  <td className="text-[12px] capitalize">{r.scope === 'both' ? 'School + Bus' : r.scope}</td>
                  <td className="text-[12px] text-slate-600 max-w-[200px] truncate" title={r.reason}>{r.reason}</td>
                  <td><span className={`text-[11px] px-1.5 py-0.5 rounded font-medium capitalize ${STATUS_BADGE[r.status] || ''}`}>{r.status}</span></td>
                  <td className="text-[12px] text-slate-600">{r.status === 'approved' ? fmt(r.expires_at) : '—'}</td>
                  <td className="pr-3 text-right whitespace-nowrap">
                    {r.status === 'pending' && (
                      <div className="inline-flex gap-1.5">
                        <button onClick={() => openApprove(r)} disabled={busy === r.id} title="Approve (Master PIN required)" className="h-7 px-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-[11px] inline-flex items-center gap-1"><Check className="w-3 h-3" /> Approve</button>
                        <button onClick={() => reject(r)} disabled={busy === r.id} title="Reject" className="h-7 px-2 border border-slate-300 rounded text-[11px] inline-flex items-center gap-1 hover:bg-slate-50"><X className="w-3 h-3" /> Reject</button>
                      </div>
                    )}
                    {r.status === 'approved' && (
                      <button onClick={() => revoke(r)} disabled={busy === r.id} title="Stop / Revoke immediately" className="h-7 px-2 bg-red-600 hover:bg-red-700 text-white rounded text-[11px] inline-flex items-center gap-1"><Ban className="w-3 h-3" /> Stop / Revoke</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="text-[11px] text-slate-500">Approved access is limited to exactly the class/medium and scope requested, on the requesting PC only, and expires automatically. It never grants the Master PIN itself.</div>
      </div>

      {pinFor && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setPinFor(null)}>
          <form onSubmit={approve} onClick={e => e.stopPropagation()} className="bg-white rounded-lg shadow-2xl w-full max-w-sm border-t-4 border-emerald-600">
            <div className="p-5 space-y-3">
              <div className="font-heading font-semibold text-lg flex items-center gap-2"><KeyRound className="w-5 h-5 text-emerald-700" /> Approve Fee Edit Access</div>
              <div className="text-[12px] text-slate-600">Enter the Master PIN to grant temporary access for this class/scope.</div>
              <label className="block">
                <div className="text-[11px] uppercase tracking-widest text-slate-600 font-bold mb-1">Duration (minutes)</div>
                <input type="number" min={1} max={240} value={duration} onChange={e => setDuration(e.target.value)} className="w-full h-10 px-3 border border-slate-300 rounded text-sm" data-testid="fea-duration" />
              </label>
              <label className="block">
                <div className="text-[11px] uppercase tracking-widest text-slate-600 font-bold mb-1">Master PIN</div>
                <input type="password" inputMode="numeric" autoFocus maxLength={8} value={pin} onChange={e => setPin(e.target.value)}
                  placeholder="••••" className="w-full h-11 px-3 border-2 border-slate-300 rounded font-mono text-lg tracking-widest text-center focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600 focus:outline-none" data-testid="fea-pin-input" />
              </label>
            </div>
            <div className="flex gap-2 p-4 border-t border-slate-100">
              <button type="button" onClick={() => setPinFor(null)} className="flex-1 h-9 border border-slate-300 rounded text-sm">Cancel</button>
              <button type="submit" disabled={busy === pinFor} className="flex-1 h-9 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-sm font-semibold" data-testid="fea-pin-approve">Approve</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
