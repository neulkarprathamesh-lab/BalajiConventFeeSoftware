import React, { useEffect, useState } from 'react';
import api from '@/lib/api';
import { PageHeader, inr } from '@/components/Layout';
import { Printer } from 'lucide-react';

export default function Cancellations() {
  const today = new Date().toISOString().slice(0,10);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState(today);
  const [data, setData] = useState(null);

  const run = () => {
    const p = new URLSearchParams();
    if (from) p.set('date_from', from);
    if (to) p.set('date_to', to);
    api.get(`/reports/cancellations?${p.toString()}`).then(r => setData(r.data));
  };
  useEffect(() => { run(); }, []); // eslint-disable-line

  return (
    <>
      <PageHeader title="Cancellation Register" subtitle="All cancelled receipts with reason & approver — printable"
        actions={
          <button data-testid="cx-print" onClick={()=>window.print()} className="h-9 px-3 bg-slate-900 text-white text-sm rounded flex items-center gap-1.5 hover:bg-slate-800 no-print">
            <Printer className="w-4 h-4" /> Print
          </button>
        }
      />
      <div className="p-6 space-y-4">
        <div className="bg-white border border-slate-200 rounded p-4 flex gap-3 items-end no-print">
          <div><div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">From</div><input type="date" value={from} onChange={e=>setFrom(e.target.value)} className="h-9 px-3 border border-slate-300 rounded text-sm" /></div>
          <div><div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">To</div><input type="date" value={to} onChange={e=>setTo(e.target.value)} className="h-9 px-3 border border-slate-300 rounded text-sm" /></div>
          <button onClick={run} className="h-9 px-4 bg-slate-900 text-white rounded text-sm">Run</button>
        </div>

        {data && (
          <div className="print-page bg-white border border-slate-300 rounded">
            <div className="p-6 border-b border-slate-300">
              <div className="text-center">
                <div className="font-heading text-xl font-bold tracking-tight">BALAJI CONVENT & JUNIOR COLLEGE</div>
                <div className="text-[12px] text-slate-700">Butibori, Nagpur</div>
                <div className="text-[13px] uppercase tracking-widest mt-2">Cancellation Register</div>
                <div className="text-[11px] text-slate-500 mt-1">{from || 'All time'} → {to}</div>
              </div>
              <div className="flex justify-around mt-4 text-sm">
                <div><span className="text-slate-500">Total Cancelled: </span><span className="font-mono tabular font-semibold">{data.count}</span></div>
                <div><span className="text-slate-500">Value: </span><span className="font-mono tabular font-semibold">{inr(data.total_cancelled)}</span></div>
              </div>
            </div>
            <table className="w-full dense-table" data-testid="cx-table">
              <thead><tr className="text-left text-[11px] uppercase tracking-wide text-slate-600"><th>#</th><th>Receipt No</th><th>Type</th><th>Payer</th><th>Dept</th><th className="text-right">Amount</th><th>Reason</th><th>Cancelled By</th><th>Cancelled At</th></tr></thead>
              <tbody>
                {data.rows.length === 0 && <tr><td colSpan="9" className="text-center py-6 text-slate-500">No cancellations</td></tr>}
                {data.rows.map((r, i) => (
                  <tr key={r.id}>
                    <td>{i+1}</td>
                    <td className="font-mono text-[12px]">{r.number}</td>
                    <td className="capitalize text-[12px]">{r.receipt_type?.replace('_',' ')}</td>
                    <td>{r.payer_name || '-'}</td>
                    <td>{r.department_code}</td>
                    <td className="text-right tabular font-medium">{inr(r.total)}</td>
                    <td className="text-[12px] text-slate-700 max-w-xs">{r.cancel_reason}</td>
                    <td className="text-[12px]">{r.cancelled_by}</td>
                    <td className="text-[12px] text-slate-500">{r.cancelled_at ? new Date(r.cancelled_at).toLocaleString('en-IN') : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="grid grid-cols-3 gap-8 mt-16 p-6 text-[11px] text-slate-600">
              <div className="border-t border-slate-400 pt-1 text-center">Prepared By</div>
              <div className="border-t border-slate-400 pt-1 text-center">Verified By</div>
              <div className="border-t border-slate-400 pt-1 text-center">Authorised Signatory</div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
