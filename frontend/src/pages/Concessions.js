import React, { useEffect, useState } from 'react';
import api from '@/lib/api';
import { PageHeader, inr } from '@/components/Layout';
import { Printer } from 'lucide-react';

export default function Concessions() {
  const today = new Date().toISOString().slice(0,10);
  const firstOfMonth = today.slice(0,7)+'-01';
  const [from, setFrom] = useState(firstOfMonth);
  const [to, setTo] = useState(today);
  const [depts, setDepts] = useState([]);
  const [dept, setDept] = useState('');
  const [data, setData] = useState(null);

  const run = () => {
    const p = new URLSearchParams({ date_from: from, date_to: to });
    if (dept) p.set('department_id', dept);
    api.get(`/reports/concessions?${p.toString()}`).then(r => setData(r.data));
  };
  useEffect(() => { api.get('/departments').then(r => setDepts(r.data)); run(); }, []); // eslint-disable-line

  return (
    <>
      <PageHeader title="Concession Ledger" subtitle="Approved fee adjustments — monthly management report"
        actions={
          <button onClick={()=>window.print()} className="h-9 px-3 bg-slate-900 text-white text-sm rounded flex items-center gap-1.5 hover:bg-slate-800 no-print">
            <Printer className="w-4 h-4" /> Print
          </button>
        }
      />
      <div className="p-6 space-y-4">
        <div className="bg-white border border-slate-200 rounded p-4 flex gap-3 items-end no-print flex-wrap">
          <div><div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">From</div><input type="date" value={from} onChange={e=>setFrom(e.target.value)} className="h-9 px-3 border border-slate-300 rounded text-sm" /></div>
          <div><div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">To</div><input type="date" value={to} onChange={e=>setTo(e.target.value)} className="h-9 px-3 border border-slate-300 rounded text-sm" /></div>
          <div><div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">Department</div>
            <select value={dept} onChange={e=>setDept(e.target.value)} className="h-9 px-3 border border-slate-300 rounded text-sm bg-white"><option value="">All</option>{depts.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select>
          </div>
          <button onClick={run} className="h-9 px-4 bg-slate-900 text-white rounded text-sm">Run</button>
        </div>

        {data && (
          <div className="print-page bg-white border border-slate-300 rounded">
            <div className="p-6 border-b border-slate-300">
              <div className="text-center">
                <div className="font-heading text-xl font-bold tracking-tight">BALAJI CONVENT & JUNIOR COLLEGE</div>
                <div className="text-[12px] text-slate-700">Butibori, Nagpur</div>
                <div className="text-[13px] uppercase tracking-widest mt-2">Concession & Adjustment Ledger</div>
                <div className="text-[11px] text-slate-500 mt-1">{from} → {to}</div>
              </div>
              <div className="grid grid-cols-3 gap-4 mt-5">
                <div className="bg-slate-50 border border-slate-200 rounded p-3">
                  <div className="text-[10px] uppercase tracking-widest text-slate-500">Total Approved</div>
                  <div className="font-heading text-xl font-semibold tabular text-emerald-700 mt-1">{inr(data.total)}</div>
                </div>
                <div className="bg-slate-50 border border-slate-200 rounded p-3">
                  <div className="text-[10px] uppercase tracking-widest text-slate-500">Count</div>
                  <div className="font-heading text-xl font-semibold tabular mt-1">{data.count}</div>
                </div>
                <div className="bg-slate-50 border border-slate-200 rounded p-3">
                  <div className="text-[10px] uppercase tracking-widest text-slate-500">Months Covered</div>
                  <div className="font-heading text-xl font-semibold tabular mt-1">{Object.keys(data.by_month).length}</div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 mt-4">
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-1">By Type</div>
                  <table className="w-full text-sm border border-slate-200">
                    <tbody>
                      {Object.entries(data.by_type).map(([k,v]) => <tr key={k} className="border-b border-slate-100 last:border-0"><td className="px-2 py-1 capitalize">{k.replace('_',' ')}</td><td className="px-2 py-1 text-right tabular font-medium">{inr(v)}</td></tr>)}
                    </tbody>
                  </table>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-1">By Month</div>
                  <table className="w-full text-sm border border-slate-200">
                    <tbody>
                      {Object.entries(data.by_month).map(([k,v]) => <tr key={k} className="border-b border-slate-100 last:border-0"><td className="px-2 py-1 font-mono">{k}</td><td className="px-2 py-1 text-right tabular font-medium">{inr(v)}</td></tr>)}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
            <table className="w-full dense-table" data-testid="cn-table">
              <thead><tr className="text-left text-[11px] uppercase tracking-wide text-slate-600"><th>#</th><th>Student</th><th>Adm No</th><th>Type</th><th>Reason</th><th className="text-right">Amount</th><th>Approved By</th><th>Date</th></tr></thead>
              <tbody>
                {data.rows.length === 0 && <tr><td colSpan="8" className="text-center py-6 text-slate-500">No approved concessions in this period</td></tr>}
                {data.rows.map((a, i) => (
                  <tr key={a.id}>
                    <td>{i+1}</td>
                    <td>{a.student?.name || '-'}</td>
                    <td className="font-mono text-[12px]">{a.student?.admission_no || '-'}</td>
                    <td className="capitalize text-[12px]">{a.adjustment_type?.replace('_',' ')}</td>
                    <td className="text-[12px] text-slate-700 max-w-xs">{a.reason}</td>
                    <td className="text-right tabular font-medium">{inr(a.amount)}</td>
                    <td className="text-[12px]">{a.approved_by_name}</td>
                    <td className="text-[12px] text-slate-500">{a.approved_at ? new Date(a.approved_at).toLocaleDateString('en-IN') : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="grid grid-cols-3 gap-8 mt-16 p-6 text-[11px] text-slate-600">
              <div className="border-t border-slate-400 pt-1 text-center">Accountant</div>
              <div className="border-t border-slate-400 pt-1 text-center">Manager</div>
              <div className="border-t border-slate-400 pt-1 text-center">Principal / Administrator</div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
