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
            <button data-testid="sd-new-receipt" onClick={() => nav(`/new-receipt?student=${id}`)} className="h-9 px-3 bg-blue-600 text-white rounded text-sm flex items-center gap-1.5 hover:bg-blue-700"><ReceiptIcon className="w-4 h-4" /> New Receipt</button>
            <button onClick={() => nav(`/adjustments?student=${id}`)} className="h-9 px-3 border border-slate-300 rounded text-sm flex items-center gap-1.5 hover:bg-slate-100"><FileEdit className="w-4 h-4" /> Adjustment</button>
            <button onClick={() => nav(`/extensions?student=${id}`)} className="h-9 px-3 border border-slate-300 rounded text-sm flex items-center gap-1.5 hover:bg-slate-100"><CalendarClock className="w-4 h-4" /> Extension</button>
          </div>
        }
      />
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-5 gap-4">
          <Card label="Total Fees" value={inr(data.fee_structure?.total || 0)} />
          <Card label="Paid" value={inr(data.total_paid)} tone="text-emerald-700" />
          <Card label="Adjustments" value={inr(data.total_adjusted)} />
          <Card label="Prev. Year Balance" value={inr(data.opening_balance || 0)} tone={data.opening_balance > 0 ? 'text-amber-700' : undefined} />
          <Card label="Outstanding" value={inr(data.outstanding)} tone="text-red-700" />
        </div>

        <FeeAdjustmentHistoryPanel studentId={id} nav={nav} />

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

        <div className="bg-white border border-slate-200 rounded">
          <div className="px-4 py-3 border-b border-slate-200"><h3 className="font-heading font-medium">Receipts</h3></div>
          <table className="w-full dense-table">
            <thead><tr className="text-left text-[11px] uppercase tracking-wide text-slate-600"><th>Number</th><th>Type</th><th>Mode</th><th className="text-right">Amount</th><th>Status</th><th>Date</th></tr></thead>
            <tbody>
              {data.receipts.length === 0 && <tr><td colSpan="6" className="text-center py-6 text-slate-500">No receipts yet</td></tr>}
              {data.receipts.map(r => (
                <tr key={r.id} className="cursor-pointer" onClick={() => nav(`/receipts/${r.id}`)}>
                  <td className="font-mono text-[12px]">{r.number}</td>
                  <td className="capitalize text-slate-600">{r.receipt_type?.replace('_',' ')}</td>
                  <td className="uppercase text-[11px]">{r.payment_mode}</td>
                  <td className="text-right tabular font-medium">{inr(r.total)}</td>
                  <td><span className={`text-[11px] px-1.5 py-0.5 rounded ${r.status==='cancelled'?'bg-red-100 text-red-800':'bg-emerald-100 text-emerald-800'}`}>{r.status}</span></td>
                  <td className="text-[12px] text-slate-500">{new Date(r.created_at).toLocaleString('en-IN')}</td>
                </tr>
              ))}
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
