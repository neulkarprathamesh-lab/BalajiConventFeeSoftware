import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '@/lib/api';
import { PageHeader, inr } from '@/components/Layout';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';

export default function Adjustments() {
  const [sp] = useSearchParams();
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState('');
  const [cap, setCap] = useState(5000);
  const [open, setOpen] = useState(!!sp.get('student'));
  const [f, setF] = useState({
    student_id: sp.get('student') || '',
    adjustment_type: 'scholarship',
    amount: sp.get('amount') || '',
    reason: sp.get('reason') || '',
    fee_head_id: '',
    reminder_id: sp.get('reminder') || null,
  });

  const load = () => { const p = status ? `?status=${status}` : ''; api.get(`/adjustments${p}`).then(r => setRows(r.data)); };
  useEffect(() => { load(); }, [status]);
  useEffect(() => { api.get('/settings').then(r => setCap(r.data.manager_waiver_cap ?? 5000)).catch(()=>{}); }, []);

  const submit = async (e) => {
    e.preventDefault();
    try { await api.post('/adjustments', { ...f, amount: parseFloat(f.amount) }); toast.success('Adjustment submitted'); setOpen(false); load(); }
    catch (ex) { toast.error(ex?.response?.data?.detail || 'Failed'); }
  };

  const approve = async (id) => { await api.post(`/adjustments/${id}/approve`); toast.success('Approved'); load(); };
  const reject = async (id) => { const r = window.prompt('Reason?')||''; await api.post(`/adjustments/${id}/reject`, { reason: r }); load(); };

  return (
    <>
      <PageHeader title="Fee Adjustments" subtitle="Scholarships, concessions, corrections — requires approval"
        actions={<button data-testid="adj-new" onClick={()=>setOpen(true)} className="h-9 px-3 bg-blue-600 text-white text-sm rounded hover:bg-blue-700">New Adjustment</button>} />
      <div className="p-6 space-y-4">
        <div className="flex gap-2">
          {['','pending','approved','rejected'].map(s => (
            <button key={s} onClick={()=>setStatus(s)} className={`text-xs px-3 py-1.5 rounded border ${status===s?'bg-slate-900 text-white border-slate-900':'border-slate-300 text-slate-700 hover:bg-white'}`}>{s || 'All'}</button>
          ))}
        </div>
        <div className="bg-white border border-slate-200 rounded overflow-hidden">
          <table className="w-full dense-table">
            <thead><tr className="text-left text-[11px] uppercase tracking-wide text-slate-600"><th>Type</th><th className="text-right">Amount</th><th>Reason</th><th>Requested By</th><th>Status</th><th>Date</th><th></th></tr></thead>
            <tbody>
              {rows.length===0 && <tr><td colSpan="7" className="text-center py-6 text-slate-500">No adjustments</td></tr>}
              {rows.map(a => (
                <tr key={a.id}>
                  <td className="capitalize">{a.adjustment_type.replace('_',' ')}</td>
                  <td className="text-right tabular font-medium">{inr(a.amount)}{a.status==='pending' && a.amount > cap && <div className="text-[10px] uppercase text-amber-700 font-semibold">Admin approval required</div>}</td>
                  <td className="text-slate-600 text-[12px] max-w-xs truncate">{a.reason}</td>
                  <td className="text-[12px]">{a.requested_by_name}</td>
                  <td><span className={`text-[11px] px-1.5 py-0.5 rounded ${a.status==='approved'?'bg-emerald-100 text-emerald-800':a.status==='rejected'?'bg-red-100 text-red-800':'bg-amber-100 text-amber-800'}`}>{a.status}</span></td>
                  <td className="text-[12px] text-slate-500">{new Date(a.created_at).toLocaleDateString('en-IN')}</td>
                  <td>{a.status==='pending' && ['administrator','manager'].includes(user?.role) && (
                    <div className="flex gap-1">
                      {(user.role === 'administrator' || a.amount <= cap) ? (
                        <button data-testid={`adj-approve-${a.id}`} onClick={()=>approve(a.id)} className="text-xs text-emerald-700 hover:underline">Approve</button>
                      ) : (
                        <span className="text-xs text-slate-400" title={`Managers can only approve up to ₹${cap.toLocaleString('en-IN')}`}>Admin only</span>
                      )}
                      <button onClick={()=>reject(a.id)} className="text-xs text-red-600 hover:underline">Reject</button>
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
          <form onSubmit={submit} className="bg-white rounded shadow-lg w-full max-w-lg">
            <div className="px-5 py-3 border-b border-slate-200 font-heading font-medium">New Fee Adjustment</div>
            <div className="p-5 space-y-3">
              <F label="Student ID *"><input required data-testid="adj-student" className={inp} value={f.student_id} onChange={e=>setF({...f, student_id:e.target.value})} placeholder="Paste student id from student page URL" /></F>
              <F label="Type *"><select className={inp} value={f.adjustment_type} onChange={e=>setF({...f, adjustment_type:e.target.value})}>{['scholarship','staff_child','management','financial_assistance','special','correction'].map(x=><option key={x}>{x}</option>)}</select></F>
              <F label="Amount (₹) *"><input required type="number" step="0.01" className={inp} value={f.amount} onChange={e=>setF({...f, amount:e.target.value})} /></F>
              <F label="Reason *"><textarea required rows="3" className={inp} value={f.reason} onChange={e=>setF({...f, reason:e.target.value})} /></F>
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
const inp = "w-full h-9 px-3 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-600 focus:border-blue-600 focus:outline-none bg-white";
const F = ({ label, children }) => <label className="block"><div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">{label}</div>{children}</label>;
