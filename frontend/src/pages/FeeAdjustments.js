import React, { useEffect, useRef, useState } from 'react';
import api from '@/lib/api';
import { PageHeader, inr } from '@/components/Layout';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { Plus, FileDown, CheckCircle2, XCircle, Clock, IndianRupee, Bell } from 'lucide-react';

const STATUS_TONE = {
  pending_approval: 'bg-amber-100 text-amber-800',
  approved_pending_entry: 'bg-blue-100 text-blue-800',
  rejected: 'bg-red-100 text-red-800',
  active: 'bg-indigo-100 text-indigo-800',
  completed: 'bg-emerald-100 text-emerald-800',
};
const STATUS_LABEL = {
  pending_approval: 'Pending Approval',
  approved_pending_entry: 'Approved — Waiting for Data Entry',
  rejected: 'Rejected',
  active: 'Active (Installments in progress)',
  completed: 'Completed',
};
const REMINDER_TONE = {
  UPCOMING: 'bg-slate-100 text-slate-700',
  'DUE TODAY': 'bg-amber-100 text-amber-800',
  OVERDUE: 'bg-red-100 text-red-800',
  PAID: 'bg-emerald-100 text-emerald-800',
};

async function openApplicationPdf(id) {
  // Open the tab synchronously (inside the click's user-activation window), then point it at
  // the blob once the authenticated fetch resolves — window.open() after an await can be
  // silently popup-blocked since the async gap breaks the browser's user-gesture link.
  const win = window.open('', '_blank');
  try {
    const { data } = await api.get(`/fee-adjustments/${id}/pdf`, { responseType: 'blob' });
    const blobUrl = URL.createObjectURL(new Blob([data], { type: 'application/pdf' }));
    if (win) win.location.href = blobUrl;
  } catch (e) {
    if (win) win.close();
    toast.error('Failed to generate PDF');
  }
}

export default function FeeAdjustments() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'administrator';
  const [tab, setTab] = useState('all');
  const [apps, setApps] = useState([]);
  const [reminders, setReminders] = useState([]);
  const [showNew, setShowNew] = useState(false);
  const [detail, setDetail] = useState(null);
  const [showReminders, setShowReminders] = useState(false);

  const reload = () => {
    const status = tab === 'all' ? undefined : tab;
    api.get('/fee-adjustments', { params: status ? { status } : {} }).then(r => setApps(r.data));
  };
  useEffect(() => { reload(); }, [tab]); // eslint-disable-line
  useEffect(() => { api.get('/fee-adjustments/reminders').then(r => setReminders(r.data)); }, []);

  const openDetail = async (id) => {
    const { data } = await api.get(`/fee-adjustments/${id}`);
    setDetail(data);
  };

  const overdueCount = reminders.filter(r => r.status === 'OVERDUE').length;

  return (
    <>
      <PageHeader title="Fee Adjustment Applications" subtitle="Waiver / concession applications — approval workflow, installments, real receipts"
        actions={
          <div className="flex gap-2">
            <button onClick={() => { api.get('/fee-adjustments/reminders').then(r => setReminders(r.data)); setShowReminders(true); }}
              className="h-9 px-3 border border-slate-300 rounded text-sm hover:bg-white flex items-center gap-1.5 relative">
              <Bell className="w-4 h-4" /> Reminders
              {overdueCount > 0 && <span className="absolute -top-1.5 -right-1.5 bg-red-600 text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center">{overdueCount}</span>}
            </button>
            <button data-testid="fa-new" onClick={() => setShowNew(true)} className="h-9 px-3 bg-blue-600 text-white rounded text-sm flex items-center gap-1.5 hover:bg-blue-700">
              <Plus className="w-4 h-4" /> New Application
            </button>
          </div>
        }
      />
      <div className="p-6 space-y-4">
        <div className="flex gap-2 flex-wrap">
          {[['all','All'],['pending_approval','Pending Approval'],['approved_pending_entry','Awaiting Data Entry'],['active','Active'],['completed','Completed'],['rejected','Rejected']].map(([k,l]) => (
            <button key={k} onClick={() => setTab(k)} className={`text-xs px-3 py-1.5 rounded border ${tab===k?'bg-slate-900 text-white border-slate-900':'border-slate-300 text-slate-700 hover:bg-white'}`}>{l}</button>
          ))}
        </div>
        <div className="bg-white border border-slate-200 rounded overflow-hidden">
          <table className="w-full dense-table">
            <thead>
              <tr className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-600 text-left">
                <th className="pl-3 py-2">Application No.</th><th>Student</th><th>Class</th><th>Academic Year</th>
                <th className="text-right">Original Fee</th><th className="text-right">Adjustment</th><th className="text-right">Remaining</th><th>Status</th><th></th>
              </tr>
            </thead>
            <tbody>
              {apps.length === 0 && <tr><td colSpan={9} className="text-center py-8 text-sm text-slate-500">No applications</td></tr>}
              {apps.map(a => (
                <tr key={a.id} className="border-t border-slate-100 cursor-pointer hover:bg-slate-50" onClick={() => openDetail(a.id)}>
                  <td className="pl-3 py-1.5 font-mono text-[12px] font-semibold">{a.application_no}</td>
                  <td className="font-medium">{a.snapshot.student_name} <span className="text-slate-400 font-mono text-[11px]">({a.snapshot.admission_no})</span></td>
                  <td>{a.snapshot.class_name}{a.snapshot.section ? ` / ${a.snapshot.section}` : ''}</td>
                  <td>{a.snapshot.academic_year}</td>
                  <td className="text-right font-mono tabular">{a.financials ? inr(a.financials.original_fee) : '—'}</td>
                  <td className="text-right font-mono tabular text-amber-700">{a.financials ? inr(a.financials.adjustment_amount) : (a.requested_adjustment_amount ? inr(a.requested_adjustment_amount) + ' (requested)' : '—')}</td>
                  <td className="text-right font-mono tabular font-semibold">{a.financials ? inr(a.financials.remaining_amount) : '—'}</td>
                  <td><span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${STATUS_TONE[a.status]}`}>{STATUS_LABEL[a.status]}</span></td>
                  <td className="pr-3 text-right"><button onClick={e=>{e.stopPropagation(); openApplicationPdf(a.id);}} className="text-slate-400 hover:text-blue-700"><FileDown className="w-4 h-4" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showNew && <NewApplicationModal onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); reload(); }} />}
      {detail && <DetailModal app={detail} isAdmin={isAdmin} onClose={() => setDetail(null)} onChanged={async () => { const { data } = await api.get(`/fee-adjustments/${detail.id}`); setDetail(data); reload(); }} />}
      {showReminders && <RemindersModal reminders={reminders} onClose={() => setShowReminders(false)} onOpenApp={(id)=>{ setShowReminders(false); openDetail(id); }} />}
    </>
  );
}

function RemindersModal({ reminders, onClose, onOpenApp }) {
  const order = { OVERDUE: 0, 'DUE TODAY': 1, UPCOMING: 2, PAID: 3 };
  const sorted = [...reminders].sort((a,b) => (order[a.status]-order[b.status]) || a.due_date.localeCompare(b.due_date));
  return (
    <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded shadow-lg w-full max-w-2xl max-h-[80vh] flex flex-col" onClick={e=>e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-slate-200 font-heading font-medium flex justify-between items-center">
          <span>Installment Reminders</span>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-xl leading-none">×</button>
        </div>
        <div className="overflow-y-auto p-4 space-y-2">
          {sorted.length === 0 && <div className="text-sm text-slate-500 text-center py-6">No installments scheduled.</div>}
          {sorted.map((r,i) => (
            <div key={i} onClick={() => onOpenApp(r.application_id)} className="border border-slate-200 rounded p-2.5 text-sm flex items-center justify-between cursor-pointer hover:bg-slate-50">
              <div>
                <div className="font-medium">{r.student_name} <span className="text-slate-400 font-mono text-[11px]">({r.admission_no})</span></div>
                <div className="text-[12px] text-slate-500">{r.application_no} · Installment {r.installment_no} · Due {r.due_date}</div>
              </div>
              <div className="text-right">
                <div className="font-mono tabular font-semibold">{inr(r.amount)}</div>
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${REMINDER_TONE[r.status]}`}>{r.status}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function NewApplicationModal({ onClose, onCreated }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [student, setStudent] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const [reason, setReason] = useState('');
  const [requestedAmount, setRequestedAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const debounceRef = useRef(0);

  useEffect(() => {
    if (!q || q.length < 2) { setResults([]); return; }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try { const { data } = await api.get(`/students?q=${encodeURIComponent(q)}&limit=8`); setResults(data); }
      catch { setResults([]); }
    }, 220);
  }, [q]);

  const selectStudent = async (s) => {
    setStudent(s); setResults([]); setQ('');
    const { data } = await api.get(`/students/${s.id}/fee-adjustment-snapshot`);
    setSnapshot(data);
  };

  const submit = async () => {
    if (!student) return toast.error('Select a student');
    if (!reason.trim()) return toast.error('A reason is required');
    setBusy(true);
    try {
      await api.post('/fee-adjustments', { student_id: student.id, reason: reason.trim(), requested_adjustment_amount: requestedAmount ? parseFloat(requestedAmount) : null });
      toast.success('Application created');
      onCreated();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Failed'); }
    setBusy(false);
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded shadow-lg w-full max-w-lg" onClick={e=>e.stopPropagation()} data-testid="fa-new-modal">
        <div className="px-5 py-3 border-b border-slate-200 font-heading font-medium">New Fee Adjustment Application</div>
        <div className="p-5 space-y-3">
          <label className="block relative">
            <div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">Student *</div>
            {student ? (
              <div className="flex items-center justify-between h-9 px-3 border border-slate-300 rounded text-sm bg-slate-50">
                <span>{student.name} <span className="text-slate-400 font-mono text-[12px]">({student.admission_no})</span></span>
                <button onClick={() => { setStudent(null); setSnapshot(null); }} className="text-slate-400 hover:text-slate-700 text-xs">change</button>
              </div>
            ) : (
              <>
                <input autoFocus value={q} onChange={e=>setQ(e.target.value)} placeholder="Search name or admission no…" className="w-full h-9 px-3 border border-slate-300 rounded text-sm" />
                {results.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded shadow-lg max-h-56 overflow-y-auto">
                    {results.map(r => (
                      <button key={r.id} onClick={() => selectStudent(r)} className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex justify-between">
                        <span>{r.name}</span><span className="text-slate-400 font-mono text-[12px]">{r.admission_no}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </label>
          {snapshot && (
            <div className="bg-slate-50 border border-slate-200 rounded p-3 text-[12px] grid grid-cols-2 gap-x-3 gap-y-1">
              <div><span className="text-slate-500">Class:</span> {snapshot.class_name}{snapshot.section ? ` / ${snapshot.section}` : ''}</div>
              <div><span className="text-slate-500">Medium:</span> {snapshot.medium}{snapshot.stream ? ` · ${snapshot.stream}` : ''}</div>
              <div><span className="text-slate-500">Academic Year:</span> {snapshot.academic_year}</div>
              <div><span className="text-slate-500">Total Fee:</span> {inr(snapshot.total_fee)}</div>
              <div><span className="text-slate-500">Total Paid:</span> {inr(snapshot.total_paid)}</div>
              <div><span className="text-slate-500">Prev. Year Balance:</span> {inr(snapshot.previous_year_outstanding)}</div>
              <div className="col-span-2 font-semibold"><span className="text-slate-500 font-normal">Current Balance (Outstanding):</span> {inr(snapshot.current_balance)}</div>
            </div>
          )}
          <label className="block"><div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">Reason for Adjustment *</div>
            <textarea rows={3} value={reason} onChange={e=>setReason(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded text-sm" placeholder="e.g. Financial hardship, staff child, scholarship…" />
          </label>
          <label className="block"><div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">Requested Adjustment Amount (₹) <span className="text-slate-400 normal-case">— optional, Admin decides the actual approved amount</span></div>
            <input type="number" value={requestedAmount} onChange={e=>setRequestedAmount(e.target.value)} className="w-full h-9 px-3 border border-slate-300 rounded text-sm text-right font-mono" />
          </label>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-200 bg-slate-50">
          <button onClick={onClose} className="h-9 px-3 border border-slate-300 rounded text-sm">Cancel</button>
          <button onClick={submit} disabled={busy} data-testid="fa-submit" className="h-9 px-4 bg-blue-600 text-white rounded text-sm disabled:opacity-60">{busy ? 'Submitting…' : 'Submit Application'}</button>
        </div>
      </div>
    </div>
  );
}

function DetailModal({ app, isAdmin, onClose, onChanged }) {
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [busy, setBusy] = useState(false);

  const approve = async () => {
    setBusy(true);
    try { await api.post(`/fee-adjustments/${app.id}/approve`); toast.success('Approved'); onChanged(); }
    catch (e) { toast.error(e?.response?.data?.detail || 'Failed'); }
    setBusy(false);
  };
  const reject = async () => {
    if (!rejectReason.trim()) return toast.error('A rejection reason is required');
    setBusy(true);
    try { await api.post(`/fee-adjustments/${app.id}/reject`, { reason: rejectReason.trim() }); toast.success('Rejected'); onChanged(); }
    catch (e) { toast.error(e?.response?.data?.detail || 'Failed'); }
    setBusy(false);
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded shadow-lg w-full max-w-2xl max-h-[88vh] flex flex-col" onClick={e=>e.stopPropagation()} data-testid="fa-detail-modal">
        <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between">
          <div>
            <div className="font-heading font-semibold">{app.application_no}</div>
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${STATUS_TONE[app.status]}`}>{STATUS_LABEL[app.status]}</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={()=>openApplicationPdf(app.id)} className="h-8 px-3 border border-slate-300 rounded text-xs hover:bg-slate-50 flex items-center gap-1.5"><FileDown className="w-3.5 h-3.5" /> Print Application</button>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-xl leading-none">×</button>
          </div>
        </div>
        <div className="overflow-y-auto p-5 space-y-4">
          <div className="bg-slate-50 border border-slate-200 rounded p-3 text-[12px] grid grid-cols-2 gap-x-3 gap-y-1">
            <div className="col-span-2 font-semibold text-[13px] mb-1">{app.snapshot.student_name} <span className="text-slate-400 font-mono">({app.snapshot.admission_no})</span></div>
            <div><span className="text-slate-500">Class:</span> {app.snapshot.class_name}{app.snapshot.section ? ` / ${app.snapshot.section}` : ''}</div>
            <div><span className="text-slate-500">Medium:</span> {app.snapshot.medium}{app.snapshot.stream ? ` · ${app.snapshot.stream}` : ''}</div>
            <div><span className="text-slate-500">Academic Year:</span> {app.snapshot.academic_year}</div>
            <div><span className="text-slate-500">Requested By:</span> {app.requested_by.name}</div>
          </div>

          <div>
            <div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">Reason for Adjustment</div>
            <div className="text-sm bg-white border border-slate-200 rounded p-2">{app.reason}</div>
          </div>

          {app.admin_decision && (
            <div className={`text-[12px] rounded p-2 border ${app.admin_decision.decision==='approved' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
              {app.admin_decision.decision === 'approved' ? 'Approved' : 'Rejected'} by {app.admin_decision.by.name} on {new Date(app.admin_decision.at).toLocaleString('en-IN')}
              {app.admin_decision.rejection_reason && <div className="mt-1">Reason: {app.admin_decision.rejection_reason}</div>}
            </div>
          )}

          {app.status === 'pending_approval' && isAdmin && (
            <div className="border border-amber-300 bg-amber-50 rounded p-3 space-y-2">
              <div className="text-[12px] font-semibold text-amber-800">Admin Decision Required</div>
              {!rejecting ? (
                <div className="flex gap-2">
                  <button onClick={approve} disabled={busy} data-testid="fa-approve" className="h-8 px-3 bg-emerald-600 text-white rounded text-xs disabled:opacity-60 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> Approve</button>
                  <button onClick={() => setRejecting(true)} className="h-8 px-3 border border-red-300 text-red-700 rounded text-xs flex items-center gap-1"><XCircle className="w-3.5 h-3.5" /> Reject</button>
                </div>
              ) : (
                <div className="space-y-2">
                  <textarea value={rejectReason} onChange={e=>setRejectReason(e.target.value)} placeholder="Reason for rejection…" rows={2} className="w-full px-2 py-1.5 border border-slate-300 rounded text-sm" />
                  <div className="flex gap-2">
                    <button onClick={reject} disabled={busy} className="h-8 px-3 bg-red-600 text-white rounded text-xs disabled:opacity-60">Confirm Reject</button>
                    <button onClick={() => setRejecting(false)} className="h-8 px-3 border border-slate-300 rounded text-xs">Cancel</button>
                  </div>
                </div>
              )}
            </div>
          )}
          {app.status === 'pending_approval' && !isAdmin && (
            <div className="text-[12px] text-slate-500 bg-slate-50 border border-slate-200 rounded p-2">Waiting for Admin/Sir approval.</div>
          )}

          {app.status === 'approved_pending_entry' && <OperatorEntryForm app={app} onDone={onChanged} />}

          {app.financials && (
            <div>
              <div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">Financial Details</div>
              <table className="w-full dense-table text-[12px]">
                <tbody>
                  <tr><td className="text-slate-500 py-1">Original Fee</td><td className="text-right font-mono">{inr(app.financials.original_fee)}</td></tr>
                  <tr><td className="text-slate-500 py-1">Adjustment / Waiver</td><td className="text-right font-mono text-amber-700">{inr(app.financials.adjustment_amount)}</td></tr>
                  <tr><td className="text-slate-500 py-1 font-semibold">Final Fee After Adjustment</td><td className="text-right font-mono font-semibold">{inr(app.financials.final_fee)}</td></tr>
                  <tr><td className="text-slate-500 py-1">Amount Already Paid</td><td className="text-right font-mono text-emerald-700">{inr(app.financials.amount_already_paid)}</td></tr>
                  <tr><td className="text-slate-500 py-1 font-semibold">Remaining Amount</td><td className="text-right font-mono font-semibold text-red-700">{inr(app.financials.remaining_amount)}</td></tr>
                </tbody>
              </table>
            </div>
          )}

          {app.installments.length > 0 && (
            <div>
              <div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">Installments</div>
              <div className="space-y-1.5">
                {app.installments.map(inst => <InstallmentRow key={inst.installment_no} inst={inst} appId={app.id} onPaid={onChanged} />)}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function OperatorEntryForm({ app, onDone }) {
  const [originalFee, setOriginalFee] = useState(app.snapshot.current_balance || app.snapshot.total_fee || 0);
  const [adjustment, setAdjustment] = useState(app.requested_adjustment_amount || '');
  const [alreadyPaid, setAlreadyPaid] = useState(app.snapshot.total_paid || 0);
  const [numInstallments, setNumInstallments] = useState(0);
  const [installments, setInstallments] = useState([]);
  const [busy, setBusy] = useState(false);

  const finalFee = (parseFloat(originalFee) || 0) - (parseFloat(adjustment) || 0);
  const remaining = Math.max(0, finalFee - (parseFloat(alreadyPaid) || 0));
  const installmentTotal = installments.reduce((s,i) => s + (parseFloat(i.amount) || 0), 0);

  const setCount = (n) => {
    setNumInstallments(n);
    const arr = Array.from({ length: n }, (_, i) => installments[i] || { amount: '', due_date: '' });
    setInstallments(arr);
  };

  const submit = async () => {
    if (adjustment === '' || isNaN(parseFloat(adjustment))) return toast.error('Enter the approved adjustment amount');
    if (installmentTotal - remaining > 0.01) return toast.error('Installment total cannot exceed the remaining amount');
    for (const i of installments) {
      if (!i.due_date || !i.amount) return toast.error('Every installment needs an amount and due date');
    }
    setBusy(true);
    try {
      await api.post(`/fee-adjustments/${app.id}/financials`, {
        original_fee: parseFloat(originalFee), adjustment_amount: parseFloat(adjustment),
        amount_already_paid: parseFloat(alreadyPaid) || 0,
        installments: installments.map(i => ({ amount: parseFloat(i.amount), due_date: i.due_date })),
      });
      toast.success('Financial details recorded');
      onDone();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Failed'); }
    setBusy(false);
  };

  return (
    <div className="border border-blue-300 bg-blue-50 rounded p-3 space-y-2.5" data-testid="fa-operator-form">
      <div className="text-[12px] font-semibold text-blue-800 flex items-center gap-1.5"><IndianRupee className="w-3.5 h-3.5" /> Enter Approved Financial Details</div>
      <div className="grid grid-cols-2 gap-2">
        <label className="block"><div className="text-[10px] uppercase text-slate-600 mb-0.5">Original Fee</div>
          <input type="number" value={originalFee} onChange={e=>setOriginalFee(e.target.value)} className="w-full h-8 px-2 border border-slate-300 rounded text-sm text-right font-mono bg-white" /></label>
        <label className="block"><div className="text-[10px] uppercase text-slate-600 mb-0.5">Approved Adjustment</div>
          <input type="number" value={adjustment} onChange={e=>setAdjustment(e.target.value)} className="w-full h-8 px-2 border border-slate-300 rounded text-sm text-right font-mono bg-white" /></label>
        <label className="block"><div className="text-[10px] uppercase text-slate-600 mb-0.5">Amount Already Paid</div>
          <input type="number" value={alreadyPaid} onChange={e=>setAlreadyPaid(e.target.value)} className="w-full h-8 px-2 border border-slate-300 rounded text-sm text-right font-mono bg-white" /></label>
        <div className="bg-white border border-slate-200 rounded px-2 flex flex-col justify-center">
          <div className="text-[10px] uppercase text-slate-500">Final Fee / Remaining</div>
          <div className="text-sm font-mono font-semibold">{inr(finalFee)} / {inr(remaining)}</div>
        </div>
      </div>
      <label className="block"><div className="text-[10px] uppercase text-slate-600 mb-0.5">Number of Installments (0-4)</div>
        <select value={numInstallments} onChange={e=>setCount(parseInt(e.target.value))} className="h-8 px-2 border border-slate-300 rounded text-sm bg-white">
          {[0,1,2,3,4].map(n => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      {installments.map((inst, i) => (
        <div key={i} className="grid grid-cols-3 gap-2 items-center">
          <div className="text-[12px] font-medium">Installment {i+1}</div>
          <input type="number" placeholder="Amount" value={inst.amount} onChange={e=>{ const c=[...installments]; c[i]={...c[i], amount:e.target.value}; setInstallments(c); }} className="h-8 px-2 border border-slate-300 rounded text-sm text-right font-mono bg-white" />
          <input type="date" value={inst.due_date} onChange={e=>{ const c=[...installments]; c[i]={...c[i], due_date:e.target.value}; setInstallments(c); }} className="h-8 px-2 border border-slate-300 rounded text-sm bg-white" />
        </div>
      ))}
      {numInstallments > 0 && <div className="text-[11px] text-slate-600">Installment total: <span className="font-mono font-semibold">{inr(installmentTotal)}</span> of remaining <span className="font-mono">{inr(remaining)}</span></div>}
      <button onClick={submit} disabled={busy} data-testid="fa-financials-submit" className="h-8 px-4 bg-blue-600 text-white rounded text-sm disabled:opacity-60">{busy ? 'Saving…' : 'Save & Activate'}</button>
    </div>
  );
}

function InstallmentRow({ inst, appId, onPaid }) {
  const [paying, setPaying] = useState(false);
  const [mode, setMode] = useState('cash');
  const [txn, setTxn] = useState('');
  const [busy, setBusy] = useState(false);

  const pay = async () => {
    setBusy(true);
    try {
      await api.post(`/fee-adjustments/${appId}/installments/${inst.installment_no}/pay`, { payment_mode: mode, transaction_id: txn || null });
      toast.success('Payment recorded — real receipt generated');
      setPaying(false);
      onPaid();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Failed'); }
    setBusy(false);
  };

  return (
    <div className="border border-slate-200 rounded p-2 text-[12px]">
      <div className="flex items-center justify-between">
        <div>
          <span className="font-medium">Installment {inst.installment_no}</span> — {inr(inst.amount)} — Due {inst.due_date}
        </div>
        {inst.status === 'paid' ? (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-800 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Paid · Receipt {inst.receipt_number}</span>
        ) : (
          <button onClick={() => setPaying(!paying)} data-testid={`fa-pay-inst-${inst.installment_no}`} className="h-7 px-2 border border-slate-300 rounded text-[11px] hover:bg-slate-50 flex items-center gap-1"><Clock className="w-3 h-3" /> Record Payment</button>
        )}
      </div>
      {paying && (
        <div className="mt-2 flex gap-2 items-center">
          <select value={mode} onChange={e=>setMode(e.target.value)} className="h-7 px-2 border border-slate-300 rounded text-[11px] bg-white">
            {['cash','cheque','dd','upi','neft','card','other'].map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <input placeholder="Transaction ID (optional)" value={txn} onChange={e=>setTxn(e.target.value)} className="h-7 px-2 border border-slate-300 rounded text-[11px] flex-1" />
          <button onClick={pay} disabled={busy} className="h-7 px-3 bg-emerald-600 text-white rounded text-[11px] disabled:opacity-60">{busy ? '…' : 'Confirm'}</button>
        </div>
      )}
    </div>
  );
}
