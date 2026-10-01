import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '@/lib/api';
import { PageHeader, inr } from '@/components/Layout';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { FileDown, Printer } from 'lucide-react';

const STATUS_TONE = {
  pending_approval: 'bg-amber-100 text-amber-800',
  approved: 'bg-emerald-100 text-emerald-800',
  cancelled: 'bg-red-100 text-red-800',
};
const STATUS_LABEL = {
  pending_approval: 'Pending Approval',
  approved: 'Approved',
  cancelled: 'Cancelled',
};

async function openExtensionPdf(id) {
  // Open the tab synchronously (inside the click's user-activation window) - see
  // the same pattern used for Fee Adjustment Application / Concession Letter PDFs.
  const win = window.open('', '_blank');
  try {
    const { data } = await api.get(`/extensions/${id}/pdf`, { responseType: 'blob' });
    const blobUrl = URL.createObjectURL(new Blob([data], { type: 'application/pdf' }));
    if (win) win.location.href = blobUrl;
  } catch (e) {
    if (win) win.close();
    toast.error('Failed to generate PDF');
  }
}

export default function Extensions() {
  const [sp] = useSearchParams();
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState('');
  const [showNew, setShowNew] = useState(!!sp.get('student') || sp.get('new') === '1');
  const [detailId, setDetailId] = useState(null);

  const load = () => { const p = status ? `?status=${status}` : ''; api.get(`/extensions${p}`).then(r => setRows(r.data)); };
  useEffect(() => { load(); }, [status]); // eslint-disable-line

  return (
    <>
      <PageHeader title="Payment Extension Applications" subtitle="Print → physical signature → transcribe approved installments"
        actions={<button data-testid="ext-new" onClick={() => setShowNew(true)} className="h-9 px-3 bg-blue-600 text-white rounded text-sm hover:bg-blue-700">New Extension</button>} />
      <div className="p-6 space-y-4">
        <div className="flex gap-2">
          {[['', 'All'], ['pending_approval', 'Pending Approval'], ['approved', 'Approved'], ['cancelled', 'Cancelled']].map(([v, l]) => (
            <button key={v} onClick={() => setStatus(v)} className={`text-xs px-3 py-1.5 rounded border ${status === v ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-300 text-slate-700 hover:bg-white'}`}>{l}</button>
          ))}
        </div>
        <div className="bg-white border border-slate-200 rounded overflow-hidden">
          <table className="w-full dense-table">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-slate-600">
                <th className="pl-3">Student Name</th><th>Adm No.</th><th>Class</th>
                <th className="text-right">Outstanding</th><th>Status</th><th>Application Date</th>
                <th>Approved Date</th><th>Next Installment</th><th></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan="9" className="text-center py-8 text-slate-500">No applications</td></tr>}
              {rows.map(e => (
                <tr key={e.id} className="border-t border-slate-100">
                  <td className="pl-3 py-1.5">
                    <button data-testid={`ext-open-${e.admission_no}`} onClick={() => setDetailId(e.id)} className="font-medium text-blue-700 hover:underline text-left">{e.student_name || '—'}</button>
                  </td>
                  <td className="font-mono text-[12px]">{e.admission_no}</td>
                  <td className="text-[12px]">{e.class_name}{e.section ? `-${e.section}` : ''}</td>
                  <td className="text-right tabular font-medium">{inr(e.outstanding_amount)}</td>
                  <td><span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${STATUS_TONE[e.status]}`}>{STATUS_LABEL[e.status] || e.status}</span></td>
                  <td className="text-[12px] text-slate-500">{new Date(e.created_at).toLocaleDateString('en-IN')}</td>
                  <td className="text-[12px] text-slate-500">{e.approved_at ? new Date(e.approved_at).toLocaleDateString('en-IN') : '—'}</td>
                  <td className="text-[12px]">{e.next_installment ? `${inr(e.next_installment.amount)} · ${e.next_installment.due_date}` : '—'}</td>
                  <td className="pr-3 text-right"><button onClick={() => openExtensionPdf(e.id)} title="Print / PDF" className="text-slate-400 hover:text-blue-700"><FileDown className="w-4 h-4" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showNew && <NewExtensionModal onClose={() => setShowNew(false)} onCreated={(id) => { setShowNew(false); load(); setDetailId(id); }} />}
      {detailId && <DetailModal id={detailId} user={user} onClose={() => setDetailId(null)} onChanged={load} />}
    </>
  );
}

function StudentPicker({ student, onSelect, onChange }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const debounceRef = useRef(0);

  useEffect(() => {
    if (!q || q.length < 2) { setResults([]); return; }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try { const { data } = await api.get(`/students?q=${encodeURIComponent(q)}&limit=8`); setResults(data); }
      catch { setResults([]); }
    }, 220);
  }, [q]);

  return (
    <label className="block relative">
      <div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">Student Name *</div>
      {student ? (
        <div className="flex items-center justify-between h-9 px-3 border border-slate-300 rounded text-sm bg-slate-50">
          <span>{student.name} <span className="text-slate-400 font-mono text-[12px]">({student.admission_no})</span></span>
          <button type="button" onClick={onChange} className="text-slate-400 hover:text-slate-700 text-xs">change</button>
        </div>
      ) : (
        <>
          <input autoFocus data-testid="ext-student-search" value={q} onChange={e => setQ(e.target.value)} placeholder="Search by student name or admission no…" className={inp} />
          {results.length > 0 && (
            <div className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded shadow-lg max-h-56 overflow-y-auto">
              {results.map(r => (
                <button type="button" key={r.id} onClick={() => { onSelect(r); setQ(''); setResults([]); }} className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex justify-between">
                  <span>{r.name}</span><span className="text-slate-400 font-mono text-[12px]">{r.admission_no}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </label>
  );
}

function SnapshotCard({ snapshot }) {
  if (!snapshot) return null;
  return (
    <div className="bg-slate-50 border border-slate-200 rounded p-3 text-[12px] grid grid-cols-2 gap-x-3 gap-y-1" data-testid="ext-snapshot">
      <div><span className="text-slate-500">Admission No.:</span> {snapshot.admission_no}</div>
      <div><span className="text-slate-500">Class:</span> {snapshot.class_name}{snapshot.section ? ` / ${snapshot.section}` : ''}</div>
      <div><span className="text-slate-500">Department/Medium:</span> {snapshot.medium}{snapshot.stream ? ` · ${snapshot.stream}` : ''}</div>
      <div><span className="text-slate-500">Academic Year:</span> {snapshot.academic_year}</div>
      <div><span className="text-slate-500">Total Fee:</span> {inr(snapshot.total_fee)}</div>
      <div><span className="text-slate-500">Fee Paid Till Now:</span> {inr(snapshot.total_paid)}</div>
      <div className="col-span-2"><span className="text-slate-500">Outstanding / Remaining Fee:</span> <span className="font-bold text-slate-900">{inr(snapshot.current_balance)}</span></div>
    </div>
  );
}

function NewExtensionModal({ onClose, onCreated }) {
  const [student, setStudent] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const selectStudent = async (s) => {
    setStudent(s);
    const { data } = await api.get(`/students/${s.id}/fee-adjustment-snapshot`);
    setSnapshot(data);
  };
  const changeStudent = () => { setStudent(null); setSnapshot(null); };

  const submit = async () => {
    if (!student) return toast.error('Select a student');
    if (!reason.trim()) return toast.error('A reason is required');
    setBusy(true);
    try {
      const { data } = await api.post('/extensions', { student_id: student.id, reason: reason.trim() });
      toast.success('Application created — Pending Approval. Opening the printable application…');
      await openExtensionPdf(data.id);
      onCreated(data.id);
    } catch (e) { toast.error(e?.response?.data?.detail || 'Failed'); }
    setBusy(false);
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded shadow-lg w-full max-w-lg" onClick={e => e.stopPropagation()} data-testid="ext-new-modal">
        <div className="px-5 py-3 border-b border-slate-200 font-heading font-medium">New Payment Extension</div>
        <div className="p-5 space-y-3">
          <StudentPicker student={student} onSelect={selectStudent} onChange={changeStudent} />
          <SnapshotCard snapshot={snapshot} />
          <label className="block"><div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">Reason for Payment Extension *</div>
            <textarea required rows={3} value={reason} onChange={e => setReason(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded text-sm" placeholder="e.g. Parent requested a delay in fee payment…" />
          </label>
          <div className="text-[11px] text-slate-500">Printing creates the application as <b>Pending Approval</b> — it does not approve it, mark any fee paid, or change the student's balance. Installment amounts are filled in later, once the physically signed paper returns.</div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-200 bg-slate-50">
          <button onClick={onClose} className="h-9 px-3 border border-slate-300 rounded text-sm">Cancel</button>
          <button onClick={submit} disabled={busy || !student} data-testid="ext-print" className="h-9 px-4 bg-blue-600 text-white rounded text-sm disabled:opacity-60 flex items-center gap-1.5"><Printer className="w-4 h-4" /> {busy ? 'Printing…' : 'Print'}</button>
        </div>
      </div>
    </div>
  );
}

function DetailModal({ id, user, onClose, onChanged }) {
  const [ext, setExt] = useState(null);
  const [liveSnapshot, setLiveSnapshot] = useState(null);
  const [insts, setInsts] = useState([{ amount: '', due_date: '' }, { amount: '', due_date: '' }, { amount: '', due_date: '' }, { amount: '', due_date: '' }]);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data } = await api.get(`/extensions/${id}`);
    setExt(data);
    const { data: snap } = await api.get(`/students/${data.student_id}/fee-adjustment-snapshot`);
    setLiveSnapshot(snap);
  };
  useEffect(() => { load(); }, [id]); // eslint-disable-line

  if (!ext || !liveSnapshot) return (
    <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50 p-4"><div className="bg-white rounded p-6 text-sm text-slate-500">Loading…</div></div>
  );

  const filled = insts.filter(i => i.amount !== '' || i.due_date !== '');
  const totalApproved = filled.reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);
  const outstanding = liveSnapshot.current_balance;
  const remainingAfterPlan = Math.round((outstanding - totalApproved) * 100) / 100;

  const confirmApproval = async () => {
    const usable = insts.filter(i => i.amount !== '' && i.due_date !== '');
    if (usable.length === 0) return toast.error('Enter at least one installment');
    for (const i of insts) {
      const hasAmt = i.amount !== ''; const hasDate = i.due_date !== '';
      if (hasAmt !== hasDate) return toast.error('Every entered installment needs both an amount and a date');
      if (hasAmt && parseFloat(i.amount) <= 0) return toast.error('Installment amounts must be positive');
    }
    if (Math.abs(remainingAfterPlan) > 0.01) return toast.error(`Total approved (${inr(totalApproved)}) must equal outstanding (${inr(outstanding)})`);
    if (!window.confirm('Signed approval received from school authority?')) return;
    setBusy(true);
    try {
      await api.post(`/extensions/${id}/approve-installments`, {
        installments: usable.map(i => ({ amount: parseFloat(i.amount), due_date: i.due_date })),
        confirmed: true,
      });
      toast.success('Application approved — reminders created');
      onChanged(); await load();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Failed'); }
    setBusy(false);
  };

  const snap = ext.snapshot || {};
  return (
    <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded shadow-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()} data-testid="ext-detail-modal">
        <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between">
          <div>
            <div className="font-heading font-semibold">{snap.student_name} <span className="text-slate-400 font-mono text-[13px]">({snap.admission_no})</span></div>
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${STATUS_TONE[ext.status]}`}>{STATUS_LABEL[ext.status] || ext.status}</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => openExtensionPdf(id)} className="h-8 px-3 border border-slate-300 rounded text-xs hover:bg-slate-50 flex items-center gap-1.5"><FileDown className="w-3.5 h-3.5" /> Print</button>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-xl leading-none">×</button>
          </div>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">Student Details</div>
            <div className="bg-slate-50 border border-slate-200 rounded p-3 text-[12px] grid grid-cols-2 gap-x-3 gap-y-1">
              <div><span className="text-slate-500">Class:</span> {snap.class_name}{snap.section ? ` / ${snap.section}` : ''}</div>
              <div><span className="text-slate-500">Department/Medium:</span> {snap.medium}{snap.stream ? ` · ${snap.stream}` : ''}</div>
              <div><span className="text-slate-500">Academic Year:</span> {snap.academic_year}</div>
              <div><span className="text-slate-500">Applied:</span> {new Date(ext.created_at).toLocaleDateString('en-IN')}</div>
            </div>
          </div>

          <div>
            <div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">Current Fee Details (live)</div>
            <table className="w-full dense-table text-[12px]">
              <tbody>
                <tr><td className="text-slate-500 py-1">Total Fee</td><td className="text-right font-mono">{inr(liveSnapshot.total_fee)}</td></tr>
                <tr><td className="text-slate-500 py-1">Fee Paid Till Now</td><td className="text-right font-mono text-emerald-700">{inr(liveSnapshot.total_paid)}</td></tr>
                <tr><td className="text-slate-500 py-1 font-semibold">Outstanding / Remaining Fee</td><td className="text-right font-mono font-bold text-slate-900">{inr(outstanding)}</td></tr>
              </tbody>
            </table>
          </div>

          <div>
            <div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">Reason for Payment Extension</div>
            <div className="text-sm bg-white border border-slate-200 rounded p-2">{ext.reason}</div>
          </div>

          {ext.status === 'pending_approval' && (
            <div className="border border-amber-300 bg-amber-50 rounded p-3 space-y-2.5" data-testid="ext-approve-form">
              <div className="text-[12px] font-semibold text-amber-800">Approved Installment Plan (from the signed physical paper)</div>
              <div className="text-[11px] text-amber-700">Enter exactly what the school authority wrote and signed on the printed application. Unused slots stay blank.</div>
              {insts.map((inst, i) => (
                <div key={i} className="grid grid-cols-3 gap-2 items-center">
                  <div className="text-[12px] font-medium">Installment {i + 1}</div>
                  <input type="number" placeholder="Amount" value={inst.amount} onChange={e => { const c = [...insts]; c[i] = { ...c[i], amount: e.target.value }; setInsts(c); }} className="h-8 px-2 border border-slate-300 rounded text-sm text-right font-mono bg-white" />
                  <input type="date" value={inst.due_date} onChange={e => { const c = [...insts]; c[i] = { ...c[i], due_date: e.target.value }; setInsts(c); }} className="h-8 px-2 border border-slate-300 rounded text-sm bg-white" />
                </div>
              ))}
              <table className="w-full text-[12px] mt-2">
                <tbody>
                  <tr><td className="text-slate-600 py-0.5">Total Approved</td><td className="text-right font-mono">{inr(totalApproved)}</td></tr>
                  <tr><td className="text-slate-600 py-0.5">Outstanding</td><td className="text-right font-mono">{inr(outstanding)}</td></tr>
                  <tr><td className={`py-0.5 font-semibold ${Math.abs(remainingAfterPlan) > 0.01 ? 'text-red-700' : 'text-emerald-700'}`}>Remaining After Plan</td><td className={`text-right font-mono font-semibold ${Math.abs(remainingAfterPlan) > 0.01 ? 'text-red-700' : 'text-emerald-700'}`}>{inr(remainingAfterPlan)}</td></tr>
                </tbody>
              </table>
              <button onClick={confirmApproval} disabled={busy} data-testid="ext-confirm-approval" className="h-9 px-4 bg-emerald-600 text-white rounded text-sm disabled:opacity-60 w-full">
                {busy ? 'Saving…' : 'Confirm Signed Approval'}
              </button>
            </div>
          )}

          {ext.status === 'approved' && (
            <div>
              <div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">Approved Installment Plan</div>
              <table className="w-full dense-table text-[12px]">
                <thead><tr className="text-left text-[11px] uppercase text-slate-500"><th>#</th><th className="text-right">Amount</th><th>Due Date</th><th>Reminder</th></tr></thead>
                <tbody>
                  {(ext.approved_installments || []).map((inst, i) => {
                    const rem = (ext.reminders || [])[i];
                    return (
                      <tr key={i}>
                        <td>{inst.installment_no}</td>
                        <td className="text-right font-mono">{inr(inst.amount)}</td>
                        <td>{inst.due_date}</td>
                        <td className="text-[11px]">{rem ? (rem.status === 'paid' ? <span className="text-emerald-700">Paid</span> : <span className="text-amber-700">Pending</span>) : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="text-[11px] text-slate-500 mt-1">Approved by {ext.approved_by_name} on {new Date(ext.approved_at).toLocaleString('en-IN')}. Reminders for these installments appear in the Reminders screen.</div>
            </div>
          )}

          {ext.status === 'cancelled' && (
            <div className="text-[12px] text-red-700 bg-red-50 border border-red-200 rounded p-2">Cancelled{ext.reject_reason ? `: ${ext.reject_reason}` : ''}.</div>
          )}
        </div>
      </div>
    </div>
  );
}
const inp = "w-full h-9 px-3 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-600 focus:border-blue-600 focus:outline-none bg-white";
