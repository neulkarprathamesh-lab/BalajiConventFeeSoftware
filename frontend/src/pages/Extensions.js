import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '@/lib/api';
import { PageHeader, inr } from '@/components/Layout';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { Trash2, Plus } from 'lucide-react';

export default function Extensions() {
  const [sp] = useSearchParams();
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState(!!sp.get('student'));
  const [studentId, setStudentId] = useState(sp.get('student')||'');
  const [outstanding, setOutstanding] = useState('');
  const [note, setNote] = useState('');
  const [insts, setInsts] = useState([{ name:'Installment 1', amount: '', due_date: '' }]);

  const load = () => { const p = status?`?status=${status}`:''; api.get(`/extensions${p}`).then(r => setRows(r.data)); };
  useEffect(() => { load(); }, [status]);

  const total = insts.reduce((s,i)=>s+(parseFloat(i.amount)||0),0);
  const addInst = () => insts.length < 4 && setInsts([...insts, { name:`Installment ${insts.length+1}`, amount:'', due_date:'' }]);

  const submit = async (e) => {
    e.preventDefault();
    try {
      await api.post('/extensions', { student_id: studentId, outstanding_amount: parseFloat(outstanding), installments: insts.map(i => ({...i, amount: parseFloat(i.amount)})), application_note: note });
      toast.success('Extension submitted'); setOpen(false); load();
    } catch (ex) { toast.error(ex?.response?.data?.detail || 'Failed'); }
  };

  const approve = async (id) => { await api.post(`/extensions/${id}/approve`); toast.success('Approved'); load(); };
  const reject  = async (id) => { const r = window.prompt('Reason?')||''; await api.post(`/extensions/${id}/reject`, {reason: r}); load(); };

  return (
    <>
      <PageHeader title="Payment Extensions" subtitle="Up to 4 installments — total must match outstanding"
        actions={<button data-testid="ext-new" onClick={()=>setOpen(true)} className="h-9 px-3 bg-blue-600 text-white rounded text-sm hover:bg-blue-700">New Extension</button>} />
      <div className="p-6 space-y-4">
        <div className="flex gap-2">
          {['','pending','approved','rejected'].map(s => (
            <button key={s} onClick={()=>setStatus(s)} className={`text-xs px-3 py-1.5 rounded border ${status===s?'bg-slate-900 text-white border-slate-900':'border-slate-300 text-slate-700 hover:bg-white'}`}>{s||'All'}</button>
          ))}
        </div>
        <div className="bg-white border border-slate-200 rounded overflow-hidden">
          <table className="w-full dense-table">
            <thead><tr className="text-left text-[11px] uppercase tracking-wide text-slate-600"><th>Student ID</th><th className="text-right">Outstanding</th><th>Installments</th><th>Requested By</th><th>Status</th><th>Date</th><th></th></tr></thead>
            <tbody>
              {rows.length===0 && <tr><td colSpan="7" className="text-center py-6 text-slate-500">No extensions</td></tr>}
              {rows.map(e => (
                <tr key={e.id}>
                  <td className="font-mono text-[11px]">{e.student_id.slice(0,8)}…</td>
                  <td className="text-right tabular font-medium">{inr(e.outstanding_amount)}</td>
                  <td className="text-[12px]">{e.installments?.length} instalments</td>
                  <td className="text-[12px]">{e.requested_by_name}</td>
                  <td><span className={`text-[11px] px-1.5 py-0.5 rounded ${e.status==='approved'?'bg-emerald-100 text-emerald-800':e.status==='rejected'?'bg-red-100 text-red-800':'bg-amber-100 text-amber-800'}`}>{e.status}</span></td>
                  <td className="text-[12px] text-slate-500">{new Date(e.created_at).toLocaleDateString('en-IN')}</td>
                  <td>{e.status==='pending' && ['administrator','manager'].includes(user?.role) && (
                    <div className="flex gap-1">
                      <button onClick={()=>approve(e.id)} className="text-xs text-emerald-700 hover:underline">Approve</button>
                      <button onClick={()=>reject(e.id)} className="text-xs text-red-600 hover:underline">Reject</button>
                    </div>
                  )}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {open && (
        <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50 p-4">
          <form onSubmit={submit} className="bg-white rounded shadow-lg w-full max-w-xl">
            <div className="px-5 py-3 border-b border-slate-200 font-heading font-medium">New Payment Extension</div>
            <div className="p-5 space-y-3">
              <F label="Student ID *"><input required className={inp} value={studentId} onChange={e=>setStudentId(e.target.value)} /></F>
              <F label="Outstanding Amount (₹) *"><input required type="number" step="0.01" className={inp} value={outstanding} onChange={e=>setOutstanding(e.target.value)} /></F>
              <div>
                <div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1 flex justify-between">
                  <span>Installments (max 4)</span>
                  {insts.length<4 && <button type="button" onClick={addInst} className="text-blue-700 hover:underline flex items-center gap-1"><Plus className="w-3 h-3" />Add</button>}
                </div>
                {insts.map((i, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 mb-2">
                    <input className={`${inp} col-span-5`} placeholder="Name" value={i.name} onChange={e=>{const c=[...insts]; c[idx].name=e.target.value; setInsts(c);}} />
                    <input className={`${inp} col-span-3 text-right`} type="number" placeholder="Amount" value={i.amount} onChange={e=>{const c=[...insts]; c[idx].amount=e.target.value; setInsts(c);}} />
                    <input className={`${inp} col-span-3`} type="date" value={i.due_date} onChange={e=>{const c=[...insts]; c[idx].due_date=e.target.value; setInsts(c);}} />
                    <button type="button" onClick={()=>setInsts(insts.filter((_,x)=>x!==idx))} className="text-red-600 col-span-1 flex items-center justify-center"><Trash2 className="w-4 h-4" /></button>
                  </div>
                ))}
                <div className={`text-xs text-right ${Math.abs(total - (parseFloat(outstanding)||0))<0.01?'text-emerald-700':'text-red-700'}`}>Total: <span className="font-mono">{inr(total)}</span> {outstanding && ` / ${inr(outstanding)}`}</div>
              </div>
              <F label="Application Note"><textarea rows="2" className={inp} value={note} onChange={e=>setNote(e.target.value)} /></F>
            </div>
            <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-200 bg-slate-50">
              <button type="button" onClick={()=>setOpen(false)} className="h-9 px-3 border border-slate-300 rounded text-sm">Cancel</button>
              <button className="h-9 px-4 bg-blue-600 text-white rounded text-sm">Submit</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
const inp = "h-9 px-3 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-600 focus:border-blue-600 focus:outline-none bg-white w-full";
const F = ({ label, children }) => <label className="block"><div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">{label}</div>{children}</label>;
