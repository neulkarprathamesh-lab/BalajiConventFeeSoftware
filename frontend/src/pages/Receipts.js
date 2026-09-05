import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '@/lib/api';
import { PageHeader, inr } from '@/components/Layout';
import { Calendar, CalendarDays, CalendarRange, XCircle, RotateCcw } from 'lucide-react';

const startOfDay = (d) => { const x = new Date(d); x.setHours(0,0,0,0); return x; };
const endOfDay = (d) => { const x = new Date(d); x.setHours(23,59,59,999); return x; };
const isoDate = (d) => d.toISOString().slice(0,10);

const CHIPS = [
  { v: 'today', label: 'Today', icon: Calendar, range: () => { const t = new Date(); return [startOfDay(t), endOfDay(t)]; } },
  { v: 'week', label: 'This Week', icon: CalendarDays, range: () => {
      const t = new Date(); const dow = (t.getDay() + 6) % 7; // Monday=0
      const start = new Date(t); start.setDate(t.getDate() - dow);
      return [startOfDay(start), endOfDay(t)];
    } },
  { v: 'month', label: 'This Month', icon: CalendarRange, range: () => {
      const t = new Date(); const start = new Date(t.getFullYear(), t.getMonth(), 1);
      return [startOfDay(start), endOfDay(t)];
    } },
];

export default function Receipts() {
  const [rows, setRows] = useState([]);
  const [type, setType] = useState('');
  const [q, setQ] = useState('');
  const [df, setDf] = useState('');
  const [dt, setDt] = useState('');
  const [statusFilter, setStatusFilter] = useState(''); // '', 'cancelled', 'issued'
  const [chip, setChip] = useState('');
  const nav = useNavigate();

  const load = () => {
    const p = new URLSearchParams();
    if (type) p.set('receipt_type', type);
    if (q) p.set('q', q);
    if (df) p.set('date_from', df);
    if (dt) p.set('date_to', dt);
    api.get(`/receipts?${p.toString()}`).then(r => setRows(r.data));
  };
  useEffect(() => { load(); }, [df, dt, type]);

  const applyChip = (c) => {
    if (chip === c.v) { // toggle off
      setChip(''); setDf(''); setDt(''); return;
    }
    const [s, e] = c.range();
    setChip(c.v); setDf(isoDate(s)); setDt(isoDate(e)); setStatusFilter('');
  };
  const applyCancelled = () => { setChip('cancelled'); setStatusFilter('cancelled'); setDf(''); setDt(''); };
  const clearFilters = () => { setChip(''); setStatusFilter(''); setDf(''); setDt(''); setType(''); setQ(''); };

  const visibleRows = useMemo(() => {
    if (!statusFilter) return rows;
    return rows.filter(r => (r.status || 'issued') === statusFilter);
  }, [rows, statusFilter]);

  const totals = useMemo(() => {
    const total = visibleRows.reduce((s, r) => s + (r.status === 'cancelled' ? 0 : Number(r.total || 0)), 0);
    return { count: visibleRows.length, total };
  }, [visibleRows]);

  return (
    <>
      <PageHeader title="Receipts" subtitle={`${totals.count} receipts · ${inr(totals.total)} collected`} />
      <div className="p-6 space-y-4">
        {/* Quick Chips */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] uppercase tracking-widest text-slate-500 mr-2">Quick view</span>
          {CHIPS.map(c => {
            const active = chip === c.v;
            return (
              <button key={c.v} data-testid={`rc-chip-${c.v}`} onClick={()=>applyChip(c)}
                className={`h-8 px-3 rounded-full border text-[12px] flex items-center gap-1.5 transition-colors ${active ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'}`}>
                <c.icon className="w-3.5 h-3.5" /> {c.label}
              </button>
            );
          })}
          <button data-testid="rc-chip-cancelled" onClick={applyCancelled}
            className={`h-8 px-3 rounded-full border text-[12px] flex items-center gap-1.5 transition-colors ${chip==='cancelled' ? 'bg-red-600 text-white border-red-600' : 'bg-white text-red-700 border-red-300 hover:bg-red-50'}`}>
            <XCircle className="w-3.5 h-3.5" /> Cancelled
          </button>
          {(chip || statusFilter || df || dt || type || q) && (
            <button data-testid="rc-chip-clear" onClick={clearFilters} className="h-8 px-3 rounded-full text-[12px] text-slate-600 hover:text-slate-900 hover:bg-slate-100 flex items-center gap-1.5">
              <RotateCcw className="w-3.5 h-3.5" /> Clear
            </button>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded p-4 flex gap-3 items-end flex-wrap">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">Receipt No</div>
            <input value={q} onChange={e=>setQ(e.target.value)} onKeyDown={e=>e.key==='Enter'&&load()} className="h-9 px-3 border border-slate-300 rounded text-sm w-40" placeholder="EP-2026-…" />
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">Type</div>
            <select value={type} onChange={e=>setType(e.target.value)} className="h-9 px-3 border border-slate-300 rounded text-sm bg-white">
              <option value="">All types</option>
              {['school','admission','bus','misc','department','general_money','refund','debit_voucher','general_collection'].map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">From</div>
            <input type="date" value={df} onChange={e=>setDf(e.target.value)} className="h-9 px-3 border border-slate-300 rounded text-sm" />
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">To</div>
            <input type="date" value={dt} onChange={e=>setDt(e.target.value)} className="h-9 px-3 border border-slate-300 rounded text-sm" />
          </div>
          <button onClick={load} data-testid="rc-filter-apply" className="h-9 px-4 bg-slate-900 text-white text-sm rounded">Filter</button>
        </div>

        <div className="bg-white border border-slate-200 rounded overflow-hidden">
          <table className="w-full dense-table">
            <thead><tr className="text-left text-[11px] uppercase tracking-wide text-slate-600"><th>Number</th><th>Type</th><th>Payer</th><th>Dept</th><th>Mode</th><th className="text-right">Amount</th><th>Cashier</th><th>Status</th><th>Date</th></tr></thead>
            <tbody>
              {visibleRows.length === 0 && <tr><td colSpan="9" className="text-center py-8 text-slate-500">No receipts found</td></tr>}
              {visibleRows.map(r => (
                <tr key={r.id} data-testid={`rc-row-${r.number}`} className="cursor-pointer" onClick={() => nav(`/receipts/${r.id}`)}>
                  <td className="font-mono text-[12px]">{r.number}</td>
                  <td className="capitalize text-slate-600 text-[12px]">{r.receipt_type?.replace('_',' ')}</td>
                  <td className="font-medium">{r.payer_name || '-'}</td>
                  <td>{r.department_code}</td>
                  <td className="uppercase text-[11px]">{r.payment_mode}</td>
                  <td className="text-right tabular font-medium">{inr(r.total)}</td>
                  <td className="text-[12px] text-slate-600">{r.cashier_name}</td>
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
