import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '@/lib/api';
import { PageHeader, inr } from '@/components/Layout';
import { Receipt as ReceiptIcon, FileEdit, CalendarClock, Bus, History, X, Landmark, FileDown } from 'lucide-react';
import { toast } from 'sonner';
import BusStopPicker from '@/components/BusStopPicker';
import { useAuth } from '@/context/AuthContext';

export default function StudentDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [busStops, setBusStops] = useState([]);
  const [busEdit, setBusEdit] = useState(false);
  const [busSel, setBusSel] = useState({ mainArea: null, stopNo: null, monthlyFee: null });
  const [busBusy, setBusBusy] = useState(false);
  const [showBusHistory, setShowBusHistory] = useState(false);
  const [obBusy, setObBusy] = useState(false);
  const [showObHistory, setShowObHistory] = useState(false);
  const [obHistory, setObHistory] = useState(null);
  const canManageOb = user?.role === 'administrator' || user?.role === 'manager';
  const canRecordObPayment = canManageOb || user?.role === 'accountant';

  const load = () => api.get(`/students/${id}/ledger`).then(r => setData(r.data));
  useEffect(() => { load(); }, [id]);
  useEffect(() => { api.get('/bus-stops').then(r => setBusStops(r.data || [])).catch(() => {}); }, []);

  // ---- Payment Receipt History (active 2-session retention; see backend
  // routers/receipt_archives.py) — a SEPARATE fetch from the ledger above,
  // reusing the exact same db.receipts records, never recomputed/duplicated.
  const [history, setHistory] = useState(null);
  const [historyYear, setHistoryYear] = useState('');
  const [historyType, setHistoryType] = useState('');
  const [historyMode, setHistoryMode] = useState('');
  const loadHistory = () => {
    const p = new URLSearchParams();
    if (historyYear) p.set('academic_year', historyYear);
    if (historyType) p.set('receipt_type', historyType);
    if (historyMode) p.set('payment_mode', historyMode);
    api.get(`/students/${id}/receipt-history?${p.toString()}`).then(r => setHistory(r.data)).catch(() => setHistory(null));
  };
  useEffect(() => { loadHistory(); /* eslint-disable-next-line */ }, [id, historyYear, historyType, historyMode]);

  if (!data) return <div className="p-8 text-sm text-slate-500">Loading…</div>;
  const s = data.student;

  const saveBusAssignment = async () => {
    if (!busSel.stopNo) return toast.error('Select a sub stop first');
    setBusBusy(true);
    try {
      await api.post(`/students/${id}/bus-assignment`, { stop_no: busSel.stopNo, academic_year: '2026-27' });
      toast.success('Bus stop assigned');
      setBusEdit(false); load();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Failed'); }
    setBusBusy(false);
  };
  const removeBusAssignment = async () => {
    if (!window.confirm(`Remove ${s.name}'s bus assignment? The historical record is kept.`)) return;
    setBusBusy(true);
    try {
      await api.post(`/students/${id}/bus-assignment/remove`);
      toast.success('Bus assignment removed');
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Failed'); }
    setBusBusy(false);
  };

  const setOpeningBalance = async () => {
    const ay = s.academic_year || '2026-27';
    const amountStr = window.prompt(`Previous-year balance carried INTO ${ay} for ${s.name} (Rs.):`, data.opening_balance || 0);
    if (amountStr === null) return;
    const amount = parseFloat(amountStr);
    if (isNaN(amount) || amount < 0) return toast.error('Enter a valid non-negative amount');
    const reason = window.prompt('Reason (required) — e.g. "Carried forward from 2025-26 fee register" or "Correction":');
    if (!reason || !reason.trim()) return toast.error('A reason is required');
    setObBusy(true);
    try {
      await api.post(`/students/${id}/opening-balance/set`, { academic_year: ay, amount, reason: reason.trim() });
      toast.success('Previous-year balance updated');
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Failed'); }
    setObBusy(false);
  };

  const recordOpeningBalancePayment = async () => {
    const ay = s.academic_year || '2026-27';
    const amountStr = window.prompt(`Payment amount to record against the previous-year balance (Rs.) — current outstanding: ${data.opening_balance}:`);
    if (amountStr === null) return;
    const amount = parseFloat(amountStr);
    if (isNaN(amount) || amount <= 0) return toast.error('Enter a valid positive amount');
    const reason = window.prompt('Reason / reference (required) — e.g. "Cash collected, receipt #1234":');
    if (!reason || !reason.trim()) return toast.error('A reason is required');
    setObBusy(true);
    try {
      await api.post(`/students/${id}/opening-balance/record-payment`, { academic_year: ay, amount, reason: reason.trim() });
      toast.success('Payment recorded against previous-year balance');
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Failed'); }
    setObBusy(false);
  };

  const loadObHistory = async () => {
    const ay = s.academic_year || '2026-27';
    try {
      const { data: h } = await api.get(`/students/${id}/opening-balance`, { params: { academic_year: ay } });
      setObHistory(h);
      setShowObHistory(true);
    } catch (e) { toast.error('Could not load history'); }
  };

  return (
    <>
      <PageHeader title={s.name} subtitle={`Admission No: ${s.admission_no}`}
        actions={
          <div className="flex gap-2">
            <button data-testid="sd-new-receipt" onClick={() => nav(`/new-receipt/entry?student=${id}`)} className="h-9 px-3 bg-blue-600 text-white rounded text-sm flex items-center gap-1.5 hover:bg-blue-700"><ReceiptIcon className="w-4 h-4" /> New Receipt</button>
            <button onClick={() => nav(`/adjustments?student=${id}`)} className="h-9 px-3 border border-slate-300 rounded text-sm flex items-center gap-1.5 hover:bg-slate-100"><FileEdit className="w-4 h-4" /> Adjustment</button>
            <button onClick={() => nav(`/extensions?student=${id}`)} className="h-9 px-3 border border-slate-300 rounded text-sm flex items-center gap-1.5 hover:bg-slate-100"><CalendarClock className="w-4 h-4" /> Extension</button>
          </div>
        }
      />
      <div className="p-6 space-y-6">
        <div className="bg-white border border-slate-200 rounded px-4 py-2.5 flex flex-wrap gap-x-6 gap-y-1 text-sm" data-testid="student-academic-identity">
          {s.department_name && <span><span className="text-slate-500">Department:</span> <span className="font-medium">{s.department_name}</span></span>}
          {s.class_name && <span><span className="text-slate-500">Class:</span> <span className="font-medium">{s.class_name}</span></span>}
          {s.stream && <span><span className="text-slate-500">Stream:</span> <span className="font-medium">{s.stream}</span></span>}
          {s.medium && <span><span className="text-slate-500">Medium:</span> <span className="font-medium">{s.medium}</span></span>}
          {s.section && <span><span className="text-slate-500">Section:</span> <span className="font-medium">{s.section}</span></span>}
        </div>

        <div className="grid grid-cols-5 gap-4">
          <Card label="Total Fees" value={inr(data.fee_structure?.total || 0)} />
          <Card label="Paid" value={inr(data.total_paid)} tone="text-emerald-700" />
          <Card label="Adjustments" value={inr(data.total_adjusted)} />
          <Card label="Prev. Year Balance" value={inr(data.opening_balance || 0)} tone={data.opening_balance > 0 ? 'text-amber-700' : undefined} />
          <Card label="Outstanding" value={inr(data.outstanding)} tone="text-red-700" />
        </div>

        <FeeAdjustmentHistoryPanel studentId={id} nav={nav} />

        <FeeInstallmentPanel studentId={id} academicYear={s.academic_year} feeItems={data.fee_items} overrides={data.fee_overrides} canManage={canManageOb} onChanged={load} />

        <div className="bg-white border border-slate-200 rounded" data-testid="student-bus-card">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
            <h3 className="font-heading font-medium flex items-center gap-1.5"><Bus className="w-4 h-4" /> Transportation / Bus</h3>
            <div className="flex items-center gap-2">
              {data.bus_assignments?.length > 0 && (
                <button onClick={() => setShowBusHistory(true)} className="text-[12px] text-slate-500 hover:text-slate-800 inline-flex items-center gap-1" data-testid="student-bus-history-btn">
                  <History className="w-3.5 h-3.5" /> History
                </button>
              )}
              {!busEdit && (
                <button
                  onClick={() => { setBusEdit(true); setBusSel({ mainArea: s.bus_main_area || null, stopNo: s.bus_stop_no || null, monthlyFee: s.bus_stop_monthly_fee || null }); }}
                  className="h-8 px-3 border border-slate-300 rounded text-[12px] hover:bg-slate-50"
                  data-testid="student-bus-edit"
                >{s.bus_required ? 'Change Stop' : 'Assign Bus Stop'}</button>
              )}
            </div>
          </div>
          <div className="p-4">
            {busEdit ? (
              <div className="space-y-3">
                <BusStopPicker stops={busStops} mainArea={busSel.mainArea} stopNo={busSel.stopNo} onChange={setBusSel} />
                <div className="flex gap-2">
                  <button onClick={() => setBusEdit(false)} className="h-8 px-3 border border-slate-300 rounded text-sm">Cancel</button>
                  <button onClick={saveBusAssignment} disabled={busBusy} data-testid="student-bus-save" className="h-8 px-4 bg-blue-600 text-white rounded text-sm disabled:opacity-60">
                    {busBusy ? 'Saving…' : 'Save Assignment'}
                  </button>
                </div>
              </div>
            ) : s.bus_required ? (
              <div className="flex items-center justify-between">
                <div className="text-sm">
                  <span className="font-medium">{s.bus_main_area}</span> — {s.bus_stop_name}
                  <div className="text-[12px] text-slate-500 mt-0.5">Monthly fee: <span className="font-mono">{inr(s.bus_stop_monthly_fee || 0)}</span></div>
                </div>
                <button onClick={removeBusAssignment} className="text-[12px] text-red-600 hover:text-red-800 inline-flex items-center gap-1" data-testid="student-bus-remove"><X className="w-3.5 h-3.5" /> Remove</button>
              </div>
            ) : (
              <div className="text-sm text-slate-500">No bus stop assigned.</div>
            )}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded" data-testid="student-opening-balance-card">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
            <h3 className="font-heading font-medium flex items-center gap-1.5"><Landmark className="w-4 h-4" /> Previous Year Balance</h3>
            <div className="flex items-center gap-2">
              <button onClick={loadObHistory} className="text-[12px] text-slate-500 hover:text-slate-800 inline-flex items-center gap-1" data-testid="student-ob-history-btn">
                <History className="w-3.5 h-3.5" /> History
              </button>
              {canRecordObPayment && data.opening_balance > 0 && (
                <button onClick={recordOpeningBalancePayment} disabled={obBusy} className="h-8 px-3 border border-slate-300 rounded text-[12px] hover:bg-slate-50" data-testid="student-ob-record-payment">
                  Record Payment
                </button>
              )}
              {canManageOb && (
                <button onClick={setOpeningBalance} disabled={obBusy} className="h-8 px-3 border border-slate-300 rounded text-[12px] hover:bg-slate-50" data-testid="student-ob-set">
                  {data.opening_balance > 0 ? 'Correct Balance' : 'Set Balance'}
                </button>
              )}
            </div>
          </div>
          <div className="p-4">
            {data.opening_balance > 0 ? (
              <div className="text-sm">
                <span className="font-heading font-semibold text-amber-700">{inr(data.opening_balance)}</span>
                <span className="text-slate-500"> carried forward into {s.academic_year || '2026-27'} — included in Outstanding above.</span>
              </div>
            ) : (
              <div className="text-sm text-slate-500">No previous-year balance recorded for {s.academic_year || '2026-27'}.</div>
            )}
          </div>
        </div>

        {showObHistory && obHistory && (
          <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50 p-4" onClick={() => setShowObHistory(false)}>
            <div className="bg-white rounded shadow-lg w-full max-w-lg" onClick={e => e.stopPropagation()}>
              <div className="px-5 py-3 border-b border-slate-200 font-heading font-medium">Previous Year Balance History — {s.name}</div>
              <div className="p-4 max-h-96 overflow-y-auto space-y-2">
                <div className="text-sm mb-2">Current: <span className="font-mono font-semibold">{inr(obHistory.amount)}</span> for {obHistory.academic_year}</div>
                {(!obHistory.history || obHistory.history.length === 0) && <div className="text-sm text-slate-500">No changes recorded yet.</div>}
                {(obHistory.history || []).slice().reverse().map((h, i) => (
                  <div key={i} className={`border rounded p-2.5 text-sm ${h.type === 'payment' ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200'}`}>
                    <div className="font-medium">{h.type === 'payment' ? `Payment recorded: ${inr(Math.abs(h.amount))}` : `Balance set to: ${inr(h.amount)}`}</div>
                    <div className="text-[12px] text-slate-500 mt-0.5">{h.reason}</div>
                    <div className="text-[11px] text-slate-400 mt-0.5">{h.by} · {new Date(h.at).toLocaleString('en-IN')}</div>
                  </div>
                ))}
              </div>
              <div className="flex justify-end px-5 py-3 border-t border-slate-200 bg-slate-50">
                <button onClick={() => setShowObHistory(false)} className="h-8 px-3 border border-slate-300 rounded text-sm">Close</button>
              </div>
            </div>
          </div>
        )}

        {showBusHistory && (
          <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50 p-4" onClick={() => setShowBusHistory(false)}>
            <div className="bg-white rounded shadow-lg w-full max-w-lg" onClick={e => e.stopPropagation()}>
              <div className="px-5 py-3 border-b border-slate-200 font-heading font-medium">Bus Assignment History — {s.name}</div>
              <div className="p-4 max-h-96 overflow-y-auto space-y-2">
                {data.bus_assignments.map(a => (
                  <div key={a.id} className={`border rounded p-2.5 text-sm ${a.status === 'active' ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200'}`}>
                    <div className="font-medium">{a.main_area} — {a.stop_name}</div>
                    <div className="text-[12px] text-slate-500 flex flex-wrap gap-x-3 mt-0.5">
                      <span>{inr(a.monthly_fee)}/mo</span>
                      <span>{a.academic_year}</span>
                      <span>{a.effective_from}{a.effective_to ? ` → ${a.effective_to}` : ' → present'}</span>
                      <span className={a.status === 'active' ? 'text-emerald-700 font-medium' : ''}>{a.status}</span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex justify-end px-5 py-3 border-t border-slate-200 bg-slate-50">
                <button onClick={() => setShowBusHistory(false)} className="h-9 px-3 border border-slate-300 rounded text-sm">Close</button>
              </div>
            </div>
          </div>
        )}

        <div className="bg-white border border-slate-200 rounded" data-testid="payment-receipt-history">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between flex-wrap gap-2">
            <div>
              <h3 className="font-heading font-medium">Payment Receipt History</h3>
              {history && (
                <div className="text-[12px] text-slate-500 mt-0.5">
                  {history.student.name} &middot; <span className="font-mono">{history.student.admission_no}</span>
                  {history.student.class_name && <> &middot; {history.student.class_name}</>}
                  {history.student.stream && <> &middot; {history.student.stream}</>}
                  {history.student.medium && <> &middot; {history.student.medium}</>}
                  {history.student.section && <> &middot; Sec {history.student.section}</>}
                </div>
              )}
            </div>
            {history && (
              <div className="text-right">
                <div className="text-[11px] uppercase tracking-widest text-slate-500">Total Receipts: <b className="text-slate-800">{history.total_receipts}</b></div>
                <div className="text-[11px] uppercase tracking-widest text-slate-500">Total Amount Paid: <b className="text-slate-800">{inr(history.total_amount_paid)}</b></div>
              </div>
            )}
          </div>
          <div className="px-4 py-2 border-b border-slate-100 bg-slate-50 flex flex-wrap gap-2 items-center">
            <select data-testid="history-year" value={historyYear} onChange={e=>setHistoryYear(e.target.value)} className="h-8 px-2 border border-slate-300 rounded text-[12px] bg-white">
              <option value="">Academic Year: All</option>
              {(history?.active_academic_years || []).map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <select data-testid="history-type" value={historyType} onChange={e=>setHistoryType(e.target.value)} className="h-8 px-2 border border-slate-300 rounded text-[12px] bg-white">
              <option value="">Receipt Type: All</option>
              <option value="school">School</option>
              <option value="bus">Bus</option>
              <option value="misc">Misc</option>
              <option value="debit_voucher">Debit Voucher</option>
            </select>
            <select data-testid="history-mode" value={historyMode} onChange={e=>setHistoryMode(e.target.value)} className="h-8 px-2 border border-slate-300 rounded text-[12px] bg-white">
              <option value="">Payment Mode: All</option>
              <option value="cash">Cash</option>
              <option value="cheque">Cheque</option>
              <option value="online">Online</option>
              <option value="upi">UPI</option>
              <option value="card">Card</option>
            </select>
            {history?.archived_years?.length > 0 && (
              <div className="ml-auto flex items-center gap-1.5 text-[11px] text-slate-500">
                {history.archived_years.map(a => (
                  <span key={a.academic_year} className="px-2 py-0.5 rounded bg-slate-200 text-slate-700" title={a.archived ? 'Archived — see Receipt Archives (Admin)' : 'Older session, not yet archived'}>
                    {a.academic_year} &middot; {a.archived ? 'ARCHIVED' : 'inactive'}
                  </span>
                ))}
              </div>
            )}
          </div>
          <table className="w-full dense-table">
            <thead><tr className="text-left text-[11px] uppercase tracking-wide text-slate-600">
              <th>Number</th><th>Date</th><th>Academic Year</th><th>Type</th><th>Fee Head(s)</th><th className="text-right">Amount</th><th>Mode</th><th>Txn ID</th><th>Issued By</th><th>Status</th>
            </tr></thead>
            <tbody>
              {(!history || history.receipts.length === 0) && <tr><td colSpan="10" className="text-center py-6 text-slate-500">No receipts in the active sessions</td></tr>}
              {history?.receipts.map(r => {
                const heads = (r.lines || []).map(l => l.fee_head_name).filter(Boolean).join(', ') || r.purpose || '—';
                return (
                  <tr key={r.id} className="cursor-pointer" onClick={() => nav(`/receipts/${r.id}`)} data-testid={`history-row-${r.number}`}>
                    <td className="font-mono text-[12px]">{r.number}</td>
                    <td className="text-[12px] text-slate-500">{new Date(r.created_at).toLocaleString('en-IN')}</td>
                    <td className="text-[12px]">{r.academic_year}</td>
                    <td className="capitalize text-slate-600">{r.receipt_type?.replace('_',' ')}</td>
                    <td className="text-[12px] max-w-[220px] truncate" title={heads}>{heads}</td>
                    <td className="text-right tabular font-medium">{inr(r.total)}</td>
                    <td className="uppercase text-[11px]">{r.payment_mode}</td>
                    <td className="font-mono text-[11px] text-slate-500">{r.payment_reference || '—'}</td>
                    <td className="text-[12px] text-slate-500">{r.cashier_name || '—'}</td>
                    <td>
                      {r.status === 'cancelled' ? (
                        <span className="text-[11px] px-1.5 py-0.5 rounded bg-red-100 text-red-800 font-semibold" title={r.cancel_reason ? `Voided: ${r.cancel_reason}` : 'Voided'}>VOIDED</span>
                      ) : (
                        <span className="text-[11px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800">{r.status}</span>
                      )}
                      {r.reprint_count > 0 && <span className="ml-1 text-[10px] text-amber-700">(reprint #{r.reprint_count})</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
const FA_STATUS_TONE = {
  pending_approval: 'bg-amber-100 text-amber-800',
  approved_pending_entry: 'bg-blue-100 text-blue-800',
  rejected: 'bg-red-100 text-red-800',
  active: 'bg-indigo-100 text-indigo-800',
  completed: 'bg-emerald-100 text-emerald-800',
};
const FA_STATUS_LABEL = {
  pending_approval: 'Pending Approval',
  approved_pending_entry: 'Awaiting Data Entry',
  rejected: 'Rejected',
  active: 'Active',
  completed: 'Completed',
};

// Option A — per-student fee/installment overrides. Purely a data-entry
// overlay: never creates a receipt, never touches fee_structures (the shared
// class template stays the default for every other student), and every
// paid/outstanding/status figure shown here comes straight from the ledger's
// backend-computed fee_items (derived live from real receipts) — nothing
// here is a manually-editable "paid" flag.
function FeeInstallmentPanel({ studentId, academicYear, feeItems, overrides, canManage, onChanged }) {
  const [editing, setEditing] = useState(null); // null = closed, {} = new, {...override} = edit
  if (!feeItems) return null;

  const startNew = () => setEditing({ fee_head_name: '', total_amount: '', installments: [{ amount: '', due_date: '' }] });

  const remove = async (ov) => {
    if (!window.confirm(`Remove the installment override for "${ov.fee_head_name}"? This student will go back to the shared fee structure for this head. No existing receipts are affected.`)) return;
    try { await api.delete(`/students/${studentId}/fee-overrides/${ov.id}`); toast.success('Override removed'); onChanged(); }
    catch (e) { toast.error(e?.response?.data?.detail || 'Failed'); }
  };

  return (
    <div className="bg-white border border-slate-200 rounded" data-testid="student-installment-panel">
      <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
        <h3 className="font-heading font-medium">Fee Heads / Installments</h3>
        {canManage && <button onClick={startNew} className="text-[12px] text-blue-700 hover:underline" data-testid="sd-add-installment">+ Add per-student installment plan</button>}
      </div>
      <table className="w-full text-[13px]">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-100">
            <th className="px-4 py-2">Fee Head</th>
            <th className="text-right">Total</th>
            <th className="text-right">Paid</th>
            <th className="text-right">Outstanding</th>
            <th>Due Date</th>
            <th>Status</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody>
          {feeItems.map((it, i) => (
            <tr key={i} className="border-b border-slate-50">
              <td className="px-4 py-1.5">{it.fee_head_name}</td>
              <td className="text-right font-mono">{inr(it.total)}</td>
              <td className="text-right font-mono text-emerald-700">{inr(it.paid)}</td>
              <td className="text-right font-mono">{inr(it.outstanding)}</td>
              <td className="text-slate-500">{it.due_date || '—'}</td>
              <td>
                <span className={`text-[11px] px-2 py-0.5 rounded-full ${it.status === 'paid' ? 'bg-emerald-100 text-emerald-800' : it.status === 'partial' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>
                  {it.status}
                </span>
              </td>
              <td className="text-slate-400 text-[11px]">{it.source === 'override' ? 'per-student' : 'shared'}</td>
            </tr>
          ))}
          {feeItems.length === 0 && <tr><td colSpan={7} className="py-4 text-center text-slate-500">Nothing outstanding.</td></tr>}
        </tbody>
      </table>
      {overrides?.length > 0 && canManage && (
        <div className="px-4 py-2 border-t border-slate-100 flex flex-wrap gap-2">
          {overrides.map(ov => (
            <button key={ov.id} onClick={() => remove(ov)} className="text-[11px] text-red-600 hover:underline">
              Remove override: {ov.fee_head_name}
            </button>
          ))}
        </div>
      )}
      {editing && (
        <InstallmentEditor
          studentId={studentId} academicYear={academicYear} initial={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); onChanged(); }}
        />
      )}
    </div>
  );
}

function InstallmentEditor({ studentId, academicYear, initial, onClose, onSaved }) {
  const [feeHeadName, setFeeHeadName] = useState(initial.fee_head_name || '');
  const [totalAmount, setTotalAmount] = useState(initial.total_amount || '');
  const [rows, setRows] = useState(initial.installments?.length ? initial.installments : [{ amount: '', due_date: '' }]);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const setRow = (i, field, val) => setRows(prev => prev.map((r, ix) => ix === i ? { ...r, [field]: val } : r));
  const addRow = () => rows.length < 4 && setRows(prev => [...prev, { amount: '', due_date: '' }]);
  const removeRow = (i) => setRows(prev => prev.filter((_, ix) => ix !== i));
  const rowsTotal = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);

  const save = async () => {
    if (!feeHeadName.trim()) return toast.error('Fee head name is required');
    if (!totalAmount || Number(totalAmount) <= 0) return toast.error('Total amount must be positive');
    const useInstallments = rows.length > 1 || rows[0].amount || rows[0].due_date;
    setBusy(true);
    try {
      await api.post(`/students/${studentId}/fee-overrides`, {
        fee_head_name: feeHeadName.trim(),
        academic_year: academicYear,
        total_amount: Number(totalAmount),
        installments: useInstallments ? rows.map(r => ({ amount: Number(r.amount), due_date: r.due_date })) : [],
        reason: reason || undefined,
      });
      toast.success('Saved');
      onSaved();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Failed'); }
    finally { setBusy(false); }
  };

  return (
    <div className="p-4 border-t border-slate-200 bg-slate-50" data-testid="sd-installment-editor">
      <div className="grid grid-cols-2 gap-3 mb-3">
        <label className="block">
          <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">Fee Head</div>
          <input data-testid="ie-fee-head" value={feeHeadName} onChange={e => setFeeHeadName(e.target.value)} placeholder="e.g. Tuition Fee"
            className="w-full h-9 px-2 border border-slate-300 rounded text-sm bg-white" />
        </label>
        <label className="block">
          <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">Total Amount (₹)</div>
          <input data-testid="ie-total" type="number" min="0" value={totalAmount} onChange={e => setTotalAmount(e.target.value)}
            className="w-full h-9 px-2 border border-slate-300 rounded text-sm bg-white" />
        </label>
      </div>
      <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">Installments (1–4, must total the amount above)</div>
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-2 mb-1.5">
          <input data-testid={`ie-inst-amt-${i}`} type="number" min="0" placeholder="Amount" value={r.amount} onChange={e => setRow(i, 'amount', e.target.value)}
            className="h-9 w-32 px-2 border border-slate-300 rounded text-sm bg-white" />
          <input data-testid={`ie-inst-due-${i}`} type="date" value={r.due_date} onChange={e => setRow(i, 'due_date', e.target.value)}
            className="h-9 px-2 border border-slate-300 rounded text-sm bg-white" />
          {rows.length > 1 && <button onClick={() => removeRow(i)} className="text-[11px] text-red-600 hover:underline">Remove</button>}
        </div>
      ))}
      <div className="flex items-center gap-3 mb-3">
        {rows.length < 4 && <button onClick={addRow} className="text-[12px] text-blue-700 hover:underline">+ Add installment</button>}
        <span className={`text-[12px] ${Math.abs(rowsTotal - Number(totalAmount || 0)) > 0.01 ? 'text-red-600' : 'text-emerald-700'}`}>
          Installments total: {inr(rowsTotal)} {totalAmount ? `/ ${inr(Number(totalAmount))}` : ''}
        </span>
      </div>
      <input data-testid="ie-reason" value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason (optional, for audit)"
        className="w-full h-9 px-2 border border-slate-300 rounded text-sm bg-white mb-3" />
      <div className="flex gap-2">
        <button onClick={save} disabled={busy} data-testid="ie-save" className="h-9 px-4 bg-blue-600 text-white rounded text-sm disabled:opacity-50">{busy ? 'Saving…' : 'Save'}</button>
        <button onClick={onClose} className="h-9 px-4 border border-slate-300 rounded text-sm">Cancel</button>
      </div>
    </div>
  );
}

function FeeAdjustmentHistoryPanel({ studentId, nav }) {
  const [apps, setApps] = useState(null);
  useEffect(() => { api.get(`/students/${studentId}/fee-adjustments`).then(r => setApps(r.data)).catch(() => setApps([])); }, [studentId]);
  if (apps === null) return null;
  return (
    <div className="bg-white border border-slate-200 rounded" data-testid="student-fee-adjustment-history">
      <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
        <h3 className="font-heading font-medium flex items-center gap-1.5"><Landmark className="w-4 h-4" /> Previous Fee Adjustment Applications</h3>
        <button onClick={() => nav(`/fee-adjustment-applications?student=${studentId}`)} className="h-8 px-3 border border-slate-300 rounded text-[12px] hover:bg-slate-50">New Application</button>
      </div>
      <div className="p-4">
        {apps.length === 0 ? (
          <div className="text-sm text-slate-500">No fee adjustment applications on record for this student.</div>
        ) : (
          <div className="space-y-2">
            {apps.map(a => (
              <div key={a.id} className="border border-slate-200 rounded p-2.5 text-[12px] flex items-center justify-between">
                <div>
                  <div className="font-mono font-semibold">{a.application_no} <span className="text-slate-400 font-normal">· {a.snapshot.academic_year}</span></div>
                  <div className="text-slate-500 mt-0.5">
                    {a.financials ? (
                      <>Original {inr(a.financials.original_fee)} · Adjustment {inr(a.financials.adjustment_amount)} · Final {inr(a.financials.final_fee)} · Remaining {inr(a.financials.remaining_amount)}</>
                    ) : <>Requested: {a.requested_adjustment_amount != null ? inr(a.requested_adjustment_amount) : '—'}</>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${FA_STATUS_TONE[a.status]}`}>{FA_STATUS_LABEL[a.status]}</span>
                  <button onClick={async () => {
                    const win = window.open('', '_blank');
                    try {
                      const { data } = await api.get(`/fee-adjustments/${a.id}/pdf`, { responseType: 'blob' });
                      if (win) win.location.href = URL.createObjectURL(new Blob([data], { type: 'application/pdf' }));
                    } catch { if (win) win.close(); toast.error('Failed to generate PDF'); }
                  }} className="text-slate-400 hover:text-blue-700"><FileDown className="w-4 h-4" /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const Card = ({ label, value, tone='text-slate-900' }) => (
  <div className="bg-white border border-slate-200 rounded p-4">
    <div className="text-[11px] tracking-widest uppercase text-slate-500">{label}</div>
    <div className={`font-heading text-2xl font-semibold tabular mt-1 ${tone}`}>{value}</div>
  </div>
);
