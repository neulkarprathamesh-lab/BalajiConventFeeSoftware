import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '@/lib/api';
import { ArrowLeft, XCircle, Trash2, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { inr } from '@/components/Layout';
import ReceiptEngine from '@/components/receipt/ReceiptEngine';
import useLiveRefresh from '@/lib/useLiveRefresh';

/**
 * ReceiptView — thin page wrapper. All layout / print / export lives in the
 * universal engine so every printable doc renders identically.
 */
export default function ReceiptView() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const [r, setR] = useState(null);
  const [rt, setRt] = useState(null);
  const [settings, setSettings] = useState(null);
  const [deleteStage, setDeleteStage] = useState(null); // null | 'pin' | 'confirm'
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data } = await api.get(`/receipts/${id}`);
    setR(data);
    api.get('/settings').then(res => setSettings(res.data)).catch(() => {});
    try {
      if (data.receipt_type_id) {
        const rtr = await api.get(`/receipt-types/${data.receipt_type_id}`);
        setRt(rtr.data);
      } else {
        const prefix = (data.number || '').split('-')[0];
        if (prefix) {
          const rtr = await api.get(`/receipt-types?include_disabled=true`);
          setRt((rtr.data || []).find(t => t.code === prefix) || null);
        }
      }
    } catch {}
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);
  useLiveRefresh(load, 10000);
  // Balance Remaining is a frozen snapshot taken by the backend at the moment this
  // receipt was created (r.balance_after) — never a live ledger fetch, so an old
  // receipt always shows the balance as it stood right after THAT payment, not
  // today's balance. Receipts issued before this field existed simply have none.
  const balance = r && r.balance_after != null ? { amount: r.balance_after, loading: false } : null;

  if (!r) return <div className="p-8 text-sm text-slate-500">Loading…</div>;

  const canCancel = ['administrator','manager'].includes(user?.role) && r.status !== 'cancelled';
  const canPrint = ['administrator','cashier'].includes(user?.role);
  // Same role as Cancel above - the backend independently re-checks this AND the
  // deletion PIN on every call; this only controls whether the button is shown.
  const canDelete = ['administrator','manager'].includes(user?.role);
  const bumpReprint = async () => {
    try { await api.post(`/receipts/${id}/reprint`); await load(); } catch {}
  };
  const doCancel = async () => {
    const reason = window.prompt('Enter cancellation reason'); if (!reason) return;
    try { await api.post(`/receipts/${id}/cancel`, { reason }); toast.success('Cancelled'); load(); }
    catch (e) { toast.error(e?.response?.data?.detail || 'Failed'); }
  };

  const closeDelete = () => { setDeleteStage(null); setPin(''); };
  const submitPin = (e) => {
    e?.preventDefault();
    if (!pin.trim()) return toast.error('Enter the deletion PIN');
    setDeleteStage('confirm');
  };
  const confirmDelete = async () => {
    setBusy(true);
    try {
      await api.delete(`/receipts/${id}`, { headers: { 'X-Receipt-Delete-Pin': pin } });
      toast.success(`Receipt ${r.number} permanently deleted`);
      closeDelete();
      nav('/receipts');
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Invalid deletion PIN.');
      setDeleteStage('pin');
    }
    setPin('');
    setBusy(false);
  };

  const extraActions = (
    <>
      <button onClick={() => nav(-1)} className="h-9 px-3 border border-slate-300 rounded text-[13px] inline-flex items-center gap-1.5 hover:bg-white" data-testid="rv-back">
        <ArrowLeft className="w-4 h-4" /> Back
      </button>
      {canCancel && (
        <button onClick={doCancel} className="h-9 px-3 border border-red-300 text-red-700 rounded text-[13px] inline-flex items-center gap-1.5 hover:bg-red-50" data-testid="rv-cancel">
          <XCircle className="w-4 h-4" /> Cancel Receipt
        </button>
      )}
      {canDelete && (
        <button onClick={() => setDeleteStage('pin')} className="h-9 px-3 border border-red-600 bg-red-50 text-red-800 rounded text-[13px] inline-flex items-center gap-1.5 hover:bg-red-100" data-testid="rv-delete">
          <Trash2 className="w-4 h-4" /> Delete Receipt
        </button>
      )}
    </>
  );

  // A5 is the only physical media this printer's driver natively supports
  // that's large enough for the 210x142.8mm receipt artwork — see the Option E
  // investigation. outerPaper letterboxes the UNCHANGED receipt design inside
  // it; only applies when this receipt's own paper is the tight 142.8mm one.
  const outerPaperForA5 = rt?.paper_size === 'RECEIPT_142' ? 'A5_LANDSCAPE' : null;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-5xl mx-auto p-6">
        <ReceiptEngine r={r} receiptType={rt} onPrint={bumpReprint} extraActions={extraActions} balance={balance} settings={settings} outerPaper={outerPaperForA5} canPrint={canPrint} />
      </div>

      {deleteStage === 'pin' && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4" onClick={closeDelete}>
          <form onSubmit={submitPin} onClick={e => e.stopPropagation()} className="bg-white rounded-lg shadow-2xl w-full max-w-sm border-t-4 border-red-600">
            <div className="p-5 border-b border-slate-200">
              <div className="font-heading font-bold text-slate-900">Delete Receipt</div>
              <div className="text-[12px] text-slate-600 mt-1">Enter the Receipt Deletion PIN to permanently delete this receipt.</div>
            </div>
            <div className="p-5 space-y-3">
              <label className="block">
                <div className="text-[11px] uppercase tracking-widest text-slate-600 font-bold mb-1 flex items-center gap-1"><Lock className="w-3 h-3" /> Deletion PIN</div>
                <input data-testid="rv-delete-pin-input" type="password" inputMode="numeric" autoFocus maxLength={8} value={pin} onChange={e => setPin(e.target.value)} placeholder="••••" className="w-full h-11 px-3 border-2 border-slate-300 rounded font-mono text-lg tracking-widest text-center focus:ring-2 focus:ring-red-600 focus:border-red-600 focus:outline-none" />
              </label>
              <div className="flex items-center gap-2 pt-1">
                <button type="button" onClick={closeDelete} className="h-9 px-4 border border-slate-300 rounded text-sm hover:bg-slate-50">Cancel</button>
                <button type="submit" data-testid="rv-delete-pin-next" className="flex-1 h-9 bg-red-600 hover:bg-red-700 text-white rounded text-sm font-semibold">Delete Receipt</button>
              </div>
            </div>
          </form>
        </div>
      )}

      {deleteStage === 'confirm' && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4" onClick={closeDelete}>
          <div onClick={e => e.stopPropagation()} className="bg-white rounded-lg shadow-2xl w-full max-w-sm border-t-4 border-red-600">
            <div className="p-5 border-b border-slate-200">
              <div className="font-heading font-bold text-red-700">WARNING</div>
              <div className="text-[12px] text-slate-700 mt-1">This will permanently delete the receipt and cannot be undone.</div>
            </div>
            <div className="p-5 space-y-2 text-[13px]">
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 bg-slate-50 border border-slate-200 rounded p-3">
                <div className="text-slate-500">Receipt No.</div><div className="font-mono font-medium">{r.number}</div>
                <div className="text-slate-500">Student/Payer</div><div className="font-medium">{r.payer_name || r.student_snapshot?.name || '-'}</div>
                <div className="text-slate-500">Amount</div><div className="font-mono font-medium">{inr(r.total)}</div>
                <div className="text-slate-500">Date</div><div>{new Date(r.created_at).toLocaleDateString('en-IN')}</div>
              </div>
              <div className="flex items-center gap-2 pt-3">
                <button type="button" onClick={closeDelete} className="h-9 px-4 border border-slate-300 rounded text-sm hover:bg-slate-50">Cancel</button>
                <button onClick={confirmDelete} disabled={busy} data-testid="rv-delete-confirm" className="flex-1 h-9 bg-red-700 hover:bg-red-800 disabled:opacity-60 text-white rounded text-sm font-semibold">
                  {busy ? 'Deleting…' : 'PERMANENTLY DELETE'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
