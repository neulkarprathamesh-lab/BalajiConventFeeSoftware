import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '@/lib/api';
import { ArrowLeft, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import ReceiptEngine from '@/components/receipt/ReceiptEngine';

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
  // Balance Remaining is a frozen snapshot taken by the backend at the moment this
  // receipt was created (r.balance_after) — never a live ledger fetch, so an old
  // receipt always shows the balance as it stood right after THAT payment, not
  // today's balance. Receipts issued before this field existed simply have none.
  const balance = r && r.balance_after != null ? { amount: r.balance_after, loading: false } : null;

  if (!r) return <div className="p-8 text-sm text-slate-500">Loading…</div>;

  const canCancel = ['administrator','manager'].includes(user?.role) && r.status !== 'cancelled';
  const bumpReprint = async () => {
    try { await api.post(`/receipts/${id}/reprint`); await load(); } catch {}
  };
  const doCancel = async () => {
    const reason = window.prompt('Enter cancellation reason'); if (!reason) return;
    try { await api.post(`/receipts/${id}/cancel`, { reason }); toast.success('Cancelled'); load(); }
    catch (e) { toast.error(e?.response?.data?.detail || 'Failed'); }
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
    </>
  );

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-5xl mx-auto p-6">
        <ReceiptEngine r={r} receiptType={rt} onPrint={bumpReprint} extraActions={extraActions} balance={balance} settings={settings} />
      </div>
    </div>
  );
}
