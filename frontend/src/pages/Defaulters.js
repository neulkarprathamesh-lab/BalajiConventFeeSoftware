import React, { useEffect, useState } from 'react';
import api from '@/lib/api';
import { PageHeader, inr } from '@/components/Layout';
import { Printer, AlertTriangle } from 'lucide-react';

export default function Defaulters() {
  const [depts, setDepts] = useState([]);
  const [classes, setClasses] = useState([]);
  const [quarter, setQuarter] = useState('Q1');
  const [dept, setDept] = useState('');
  const [cls, setCls] = useState('');
  const [data, setData] = useState(null);

  useEffect(() => {
    api.get('/departments').then(r => setDepts(r.data));
    api.get('/classes').then(r => setClasses(r.data));
  }, []);

  const run = () => {
    const p = new URLSearchParams({ quarter });
    if (dept) p.set('department_id', dept);
    if (cls) p.set('class_id', cls);
    api.get(`/reports/defaulters?${p.toString()}`).then(r => setData(r.data));
  };
  useEffect(() => { run(); /* eslint-disable-next-line */ }, [quarter, dept, cls]);

  const availClasses = classes.filter(c => !dept || c.department_id === dept);

  return (
    <>
      <PageHeader title="Fee Defaulters Report" subtitle="Students with unpaid quarterly tuition — one-page principal handout"
        actions={
          <button data-testid="def-print" onClick={()=>window.print()} className="h-9 px-3 bg-slate-900 text-white text-sm rounded flex items-center gap-1.5 hover:bg-slate-800 no-print">
            <Printer className="w-4 h-4" /> Print
          </button>
        }
      />
      <div className="p-6 space-y-4">
        <div className="bg-white border border-slate-200 rounded p-4 flex flex-wrap gap-3 items-end no-print">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">Quarter</div>
            <div className="flex gap-1">
              {['Q1','Q2','Q3','total'].map(q => (
                <button key={q} data-testid={`def-q-${q}`} onClick={()=>setQuarter(q)} className={`h-9 px-3 text-xs rounded border ${quarter===q ? 'bg-slate-900 border-slate-900 text-white' : 'border-slate-300 hover:bg-white'}`}>{q === 'total' ? 'Annual' : q}</button>
              ))}
            </div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">Department</div>
            <select value={dept} onChange={e=>{setDept(e.target.value); setCls('');}} className="h-9 px-3 border border-slate-300 rounded text-sm bg-white"><option value="">All</option>{depts.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">Class</div>
            <select value={cls} onChange={e=>setCls(e.target.value)} className="h-9 px-3 border border-slate-300 rounded text-sm bg-white"><option value="">All</option>{availClasses.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>
          </div>
        </div>

        {data && (
          <div className="print-page bg-white border border-slate-300 rounded" data-testid="def-report">
            <div className="p-6 border-b border-slate-300 text-center">
              <div className="font-heading text-xl font-bold tracking-tight">BALAJI CONVENT & JUNIOR COLLEGE</div>
              <div className="text-[12px] text-slate-700">Butibori, Nagpur</div>
              <div className="text-[13px] uppercase tracking-widest mt-2 font-bold">Fee Defaulters Report — {quarter === 'total' ? 'Annual' : `${quarter} Tuition`}</div>
              <div className="text-[11px] text-slate-500 mt-1">{new Date().toLocaleDateString('en-IN')}</div>
              <div className="grid grid-cols-2 gap-6 mt-4 max-w-md mx-auto">
                <div className="bg-slate-50 border border-slate-200 rounded p-3">
                  <div className="text-[10px] uppercase tracking-widest text-slate-500">Defaulters</div>
                  <div className="font-heading text-2xl font-bold text-red-700">{data.count}</div>
                </div>
                <div className="bg-slate-50 border border-slate-200 rounded p-3">
                  <div className="text-[10px] uppercase tracking-widest text-slate-500">Total Outstanding</div>
                  <div className="font-heading text-2xl font-bold text-red-700 tabular">{inr(data.total_outstanding)}</div>
                </div>
              </div>
            </div>
            <table className="w-full dense-table">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-600 border-b-2 border-slate-400">
                  <th>#</th><th>Adm No</th><th>Student</th><th>Dept</th><th>Class</th><th>Guardian</th><th className="text-right">{quarter==='total'?'Annual Fee':`${quarter} Fee`}</th><th className="text-right">Paid</th><th className="text-right">Outstanding</th>
                </tr>
              </thead>
              <tbody>
                {data.students.length === 0 && <tr><td colSpan="9" className="text-center py-8 text-emerald-700"><AlertTriangle className="w-4 h-4 inline mr-1" /> No defaulters! 🎉</td></tr>}
                {data.students.map((s, i) => (
                  <tr key={s.student_id}>
                    <td>{i+1}</td>
                    <td className="font-mono text-[12px]">{s.admission_no}</td>
                    <td className="font-medium">{s.name}</td>
                    <td className="text-[11px]">{s.department_name}</td>
                    <td className="text-[11px]">{s.class_name}</td>
                    <td className="text-[11px]">{s.guardian_name} · <span className="font-mono">{s.guardian_mobile}</span></td>
                    <td className="text-right tabular text-[12px]">{inr(s.fee)}</td>
                    <td className="text-right tabular text-[12px] text-emerald-700">{inr(s.paid)}</td>
                    <td className="text-right tabular font-bold text-red-700">{inr(s.outstanding)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="grid grid-cols-3 gap-8 p-6 mt-10 text-[11px] text-slate-600">
              <div className="border-t border-slate-500 pt-1 text-center">Prepared By</div>
              <div className="border-t border-slate-500 pt-1 text-center">Accountant</div>
              <div className="border-t border-slate-500 pt-1 text-center">Principal / Administrator</div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
