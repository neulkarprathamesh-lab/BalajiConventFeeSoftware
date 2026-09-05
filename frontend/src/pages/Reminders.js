import React, { useEffect, useState } from 'react';
import api from '@/lib/api';
import { PageHeader, inr } from '@/components/Layout';
import { toast } from 'sonner';
import { AlertCircle, Calendar, CalendarCheck, FileEdit } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const REMARK_TYPES = [
  { v:'will_pay_today', l:'Will pay today' },
  { v:'will_pay_tomorrow', l:'Will pay tomorrow' },
  { v:'contacted', l:'Contacted' },
  { v:'not_reachable', l:'Not reachable' },
  { v:'visited', l:'Visited' },
  { v:'payment_received', l:'Payment received' },
  { v:'other', l:'Other' },
];

export default function Reminders() {
  const [rows, setRows] = useState([]);
  const [bucket, setBucket] = useState('all');
  const nav = useNavigate();
  const load = () => api.get('/reminders?status=pending').then(r => setRows(r.data));
  useEffect(() => { load(); }, []);

  const filtered = bucket==='all' ? rows : rows.filter(r => r.bucket === bucket);
  const counts = { overdue:0, today:0, tomorrow:0, future:0 };
  rows.forEach(r => counts[r.bucket]++);

  const submitFollowup = async (rem_id, remark_type) => {
    let details = '';
    if (remark_type === 'other') { details = window.prompt('Enter details') || ''; if (!details) return; }
    await api.post('/reminders/followup', { reminder_id: rem_id, remark_type, details });
    toast.success('Follow-up saved');
    load();
  };

  return (
    <>
      <PageHeader title="Reminders" subtitle="Cashiers must record a follow-up before logout" />
      <div className="p-6 space-y-4">
        <div className="grid grid-cols-4 gap-4">
          <Card active={bucket==='overdue'} onClick={()=>setBucket('overdue')} label="Overdue" value={counts.overdue} icon={AlertCircle} tone="text-red-700" />
          <Card active={bucket==='today'} onClick={()=>setBucket('today')} label="Due Today" value={counts.today} icon={CalendarCheck} tone="text-amber-700" />
          <Card active={bucket==='tomorrow'} onClick={()=>setBucket('tomorrow')} label="Due Tomorrow" value={counts.tomorrow} icon={Calendar} tone="text-slate-900" />
          <Card active={bucket==='all'} onClick={()=>setBucket('all')} label="All Pending" value={rows.length} icon={Calendar} />
        </div>

        <div className="bg-white border border-slate-200 rounded overflow-hidden">
          <table className="w-full dense-table">
            <thead><tr className="text-left text-[11px] uppercase tracking-wide text-slate-600"><th>Student</th><th>Installment</th><th className="text-right">Amount</th><th>Due Date</th><th>Bucket</th><th>Last Followup</th><th className="w-64">Actions</th></tr></thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan="7" className="text-center py-6 text-slate-500">Nothing pending</td></tr>}
              {filtered.map(r => (
                <tr key={r.id}>
                  <td>
                    <div className="font-medium">{r.student?.name || '-'}</div>
                    <div className="font-mono text-[11px] text-slate-500">{r.student?.admission_no}</div>
                  </td>
                  <td className="text-[12px]">{r.installment_name}</td>
                  <td className="text-right tabular font-medium">{inr(r.amount)}</td>
                  <td className="text-[12px]">{r.due_date}</td>
                  <td><span className={`text-[11px] px-1.5 py-0.5 rounded uppercase ${r.bucket==='overdue'?'bg-red-100 text-red-800':r.bucket==='today'?'bg-amber-100 text-amber-800':'bg-slate-100 text-slate-700'}`}>{r.bucket}</span></td>
                  <td className="text-[11px] text-slate-500">{r.followups?.length ? r.followups[r.followups.length-1].remark_type : '-'}</td>
                  <td>
                    <div className="flex items-center gap-2">
                      <select onChange={e => e.target.value && submitFollowup(r.id, e.target.value)} defaultValue="" className="h-8 px-2 border border-slate-300 rounded text-xs bg-white">
                        <option value="">+ Add follow-up</option>
                        {REMARK_TYPES.map(x => <option key={x.v} value={x.v}>{x.l}</option>)}
                      </select>
                      <button
                        data-testid={`rem-waiver-${r.id}`}
                        onClick={() => nav(`/adjustments?student=${r.student_id}&amount=${r.amount}&reason=${encodeURIComponent(`Waiver request for ${r.installment_name} (due ${r.due_date})`)}&reminder=${r.id}`)}
                        title="Request a waiver / concession for this student"
                        className="h-8 px-2 border border-amber-300 rounded text-xs text-amber-800 hover:bg-amber-50 flex items-center gap-1"
                      ><FileEdit className="w-3 h-3" /> Waiver</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

const Card = ({ label, value, icon:Icon, tone='text-slate-900', active, onClick }) => (
  <button onClick={onClick} className={`text-left bg-white border rounded p-4 transition-colors duration-150 ${active?'border-blue-600 ring-2 ring-blue-100':'border-slate-200 hover:border-slate-400'}`}>
    <div className="flex justify-between items-start mb-1">
      <div className="text-[11px] tracking-widest uppercase text-slate-500">{label}</div>
      <Icon className="w-4 h-4 text-slate-400" strokeWidth={1.75} />
    </div>
    <div className={`font-heading text-3xl font-semibold tabular ${tone}`}>{value}</div>
  </button>
);
