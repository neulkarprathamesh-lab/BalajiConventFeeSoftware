import React, { useEffect, useState } from 'react';
import api from '@/lib/api';
import { PageHeader, inr } from '@/components/Layout';

export default function Reports() {
  const today = new Date().toISOString().slice(0,10);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [depts, setDepts] = useState([]);
  const [dept, setDept] = useState('');
  const [data, setData] = useState(null);

  useEffect(() => { api.get('/departments').then(r => setDepts(r.data)); }, []);

  const run = () => {
    const p = new URLSearchParams({ date_from: from, date_to: to });
    if (dept) p.set('department_id', dept);
    api.get(`/reports/collection?${p.toString()}`).then(r => setData(r.data));
  };
  useEffect(() => { run(); }, []); // eslint-disable-line

  return (
    <>
      <PageHeader title="Reports" subtitle="Collection reports · reconcile with cash / bank" />
      <div className="p-6 space-y-4">
        <div className="bg-white border border-slate-200 rounded p-4 flex flex-wrap gap-3 items-end">
          <div><div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">From</div><input type="date" value={from} onChange={e=>setFrom(e.target.value)} className="h-9 px-3 border border-slate-300 rounded text-sm" /></div>
          <div><div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">To</div><input type="date" value={to} onChange={e=>setTo(e.target.value)} className="h-9 px-3 border border-slate-300 rounded text-sm" /></div>
          <div><div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">Department</div>
            <select value={dept} onChange={e=>setDept(e.target.value)} className="h-9 px-3 border border-slate-300 rounded text-sm bg-white"><option value="">All</option>{depts.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select>
          </div>
          <button onClick={run} className="h-9 px-4 bg-slate-900 text-white rounded text-sm">Run</button>
        </div>

        {data && <>
          <div className="grid grid-cols-4 gap-4">
            <Card label="Gross Collection" value={inr(data.gross_collection)} tone="text-emerald-700" />
            <Card label="Refunds" value={inr(data.refunds)} tone="text-red-700" />
            <Card label="Vouchers Out" value={inr(data.vouchers)} tone="text-red-700" />
            <Card label="Net" value={inr(data.net)} tone="text-blue-700" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="bg-white border border-slate-200 rounded">
              <div className="px-4 py-2 border-b border-slate-200 font-heading font-medium text-sm">By Payment Mode</div>
              <table className="w-full dense-table"><tbody>
                {Object.entries(data.by_mode).map(([k,v]) => <tr key={k}><td className="uppercase text-[12px]">{k}</td><td className="text-right tabular font-medium">{inr(v)}</td></tr>)}
                {Object.keys(data.by_mode).length===0 && <tr><td colSpan="2" className="text-center py-4 text-slate-500 text-sm">No data</td></tr>}
              </tbody></table>
            </div>
            <div className="bg-white border border-slate-200 rounded">
              <div className="px-4 py-2 border-b border-slate-200 font-heading font-medium text-sm">By Receipt Type</div>
              <table className="w-full dense-table"><tbody>
                {Object.entries(data.by_type).map(([k,v]) => <tr key={k}><td className="capitalize text-[12px]">{k.replace('_',' ')}</td><td className="text-right tabular font-medium">{inr(v)}</td></tr>)}
                {Object.keys(data.by_type).length===0 && <tr><td colSpan="2" className="text-center py-4 text-slate-500 text-sm">No data</td></tr>}
              </tbody></table>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 font-heading font-medium">Transactions ({data.count})</div>
            <table className="w-full dense-table">
              <thead><tr className="text-left text-[11px] uppercase tracking-wide text-slate-600"><th>Receipt</th><th>Type</th><th>Payer</th><th>Dept</th><th>Mode</th><th className="text-right">Amount</th><th>Cashier</th></tr></thead>
              <tbody>
                {data.rows.map(r => (
                  <tr key={r.id}><td className="font-mono text-[12px]">{r.number}</td><td className="capitalize text-[12px]">{r.receipt_type?.replace('_',' ')}</td><td>{r.payer_name}</td><td>{r.department_code}</td><td className="uppercase text-[11px]">{r.payment_mode}</td><td className="text-right tabular font-medium">{inr(r.total)}</td><td className="text-[12px]">{r.cashier_name}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </>}
      </div>
    </>
  );
}
const Card = ({ label, value, tone }) => (
  <div className="bg-white border border-slate-200 rounded p-4">
    <div className="text-[11px] tracking-widest uppercase text-slate-500">{label}</div>
    <div className={`font-heading text-2xl font-semibold tabular mt-1 ${tone||'text-slate-900'}`}>{value}</div>
  </div>
);
