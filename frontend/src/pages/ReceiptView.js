import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '@/lib/api';
import { ArrowLeft, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import ReceiptEngine from '@/components/receipt/ReceiptEngine';
import { printTestReceiptA5 } from '@/components/receipt/receiptExporter';

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
  // TEMPORARY, dev-only: direct-to-P1007 test print for the Option E physical
  // printing investigation. Hardcodes the Main Server's test printer name —
  // deliberately NOT the final Settings-driven architecture (see
  // printReceiptDirect for that) — this exists only to physically verify the
  // A5-letterboxed receipt renders and prints correctly before that
  // architecture is built out. Remove once physical printing is verified.
  const [testPrintBusy, setTestPrintBusy] = useState(false);
  const [testPrintResult, setTestPrintResult] = useState(null);

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

  const runTestPrint = async () => {
    setTestPrintBusy(true);
    setTestPrintResult(null);
    const res = await printTestReceiptA5('HP LaserJet P1007');
    setTestPrintResult(res);
    setTestPrintBusy(false);
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
      <button
        onClick={runTestPrint}
        disabled={testPrintBusy}
        data-testid="rv-print-test-a5"
        className="h-9 px-3 bg-amber-500 hover:bg-amber-600 text-white rounded text-[13px] inline-flex items-center gap-1.5 disabled:opacity-50"
        title="TEMPORARY dev action: direct silent print to HP LaserJet P1007 on A5 media"
      >
        {testPrintBusy ? 'Printing…' : 'PRINT TEST RECEIPT (A5 dev)'}
      </button>
      {testPrintResult && (
        <span className={`text-[12px] font-semibold ${testPrintResult.ok ? 'text-emerald-600' : 'text-red-600'}`}>
          {testPrintResult.ok ? 'Sent to printer — inspect the physical sheet.' : `FAIL: ${testPrintResult.error}`}
        </span>
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
        <ReceiptEngine r={r} receiptType={rt} onPrint={bumpReprint} extraActions={extraActions} balance={balance} settings={settings} outerPaper={outerPaperForA5} />
      </div>
    </div>
  );
}
