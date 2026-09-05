import React, { useEffect, useMemo, useState } from 'react';
import api from '@/lib/api';
import { PageHeader, inr } from '@/components/Layout';
import { useAuth } from '@/context/AuthContext';
import { Printer, RefreshCw, CalendarDays, Wallet, User as UserIcon, TrendingUp, TrendingDown, Receipt, XCircle, Banknote, Smartphone, CreditCard, CheckCircle2, AlertTriangle } from 'lucide-react';

const todayISO = () => new Date().toISOString().slice(0,10);
const MODE_LABEL = { cash: 'Cash', upi: 'UPI', card: 'Card', cheque: 'Cheque', dd: 'DD', neft: 'NEFT', other: 'Other' };
const MODE_ICON = { cash: Banknote, upi: Smartphone, card: CreditCard };
const DENOMS = [500, 200, 100, 50, 20, 10, 5, 2, 1];

export default function DayEnd() {
  const { user } = useAuth();
  const [date, setDate] = useState(todayISO());
  const [cashierId, setCashierId] = useState('');
  const [cashiers, setCashiers] = useState([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [counts, setCounts] = useState({}); // denomination -> count
  const isAdmin = ['administrator','manager','accountant'].includes(user?.role);

  useEffect(() => {
    if (isAdmin) api.get('/users').then(r => setCashiers((r.data||[]).filter(u => ['cashier','accountant'].includes(u.role)))).catch(()=>{});
  }, [isAdmin]);

  const load = async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      p.set('date', date);
      if (cashierId) p.set('cashier_id', cashierId);
      const { data } = await api.get(`/reports/day-end?${p.toString()}`);
      setData(data);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [date, cashierId]);

  const displayDate = useMemo(() => new Date(date + 'T00:00:00').toLocaleDateString('en-IN', { day:'2-digit', month:'long', year:'numeric', weekday:'long' }), [date]);

  const doPrint = () => window.print();

  return (
    <>
      <PageHeader
        title="Day-End Summary"
        subtitle="One-tap end-of-day report for handover"
        actions={
          <div className="flex gap-2 no-print">
            <button onClick={load} data-testid="de-refresh" className="h-9 px-3 border border-slate-300 rounded text-sm hover:bg-white flex items-center gap-1.5"><RefreshCw className="w-4 h-4" /> Refresh</button>
            <button onClick={doPrint} data-testid="de-print" className="h-9 px-4 bg-slate-900 text-white rounded text-sm flex items-center gap-1.5"><Printer className="w-4 h-4" /> Print</button>
          </div>
        }
      />
      <div className="p-6">
        {/* Filters */}
        <div className="bg-white border border-slate-200 rounded p-4 flex flex-wrap items-end gap-3 mb-4 no-print">
          <div>
            <div className="text-[11px] uppercase tracking-widest text-slate-600 mb-1">Date</div>
            <input data-testid="de-date" type="date" value={date} onChange={e=>setDate(e.target.value)} max={todayISO()} className="h-9 px-3 border border-slate-300 rounded text-sm" />
          </div>
          {isAdmin && (
            <div>
              <div className="text-[11px] uppercase tracking-widest text-slate-600 mb-1">Cashier</div>
              <select data-testid="de-cashier" value={cashierId} onChange={e=>setCashierId(e.target.value)} className="h-9 px-3 border border-slate-300 rounded text-sm bg-white min-w-[240px]">
                <option value="">All cashiers (consolidated)</option>
                {cashiers.map(c => <option key={c.id} value={c.id}>{`${c.name} · ${c.role}`}</option>)}
              </select>
            </div>
          )}
          <button onClick={()=>{setDate(todayISO()); setCashierId('');}} className="h-9 px-3 text-slate-600 hover:text-slate-900 text-sm">Reset</button>
        </div>

        {/* Printable Report */}
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden print:border-0 print:shadow-none">
          {/* Header */}
          <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between print:bg-slate-900">
            <div className="flex items-center gap-3">
              <img src="/school-logo.jpeg" className="w-11 h-11 rounded-full object-cover ring-1 ring-slate-700" alt="logo" />
              <div>
                <div className="font-heading font-bold text-[15px] leading-tight">Balaji Convent & Junior College</div>
                <div className="text-[11px] text-slate-300 uppercase tracking-widest">Cashier Day-End Summary</div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] text-slate-400 uppercase tracking-widest">Report Date</div>
              <div className="font-heading font-semibold text-[13px]">{displayDate}</div>
            </div>
          </div>

          {loading ? (
            <div className="p-10 text-center text-slate-500">Loading…</div>
          ) : !data ? (
            <div className="p-10 text-center text-slate-500">No data</div>
          ) : (
            <div className="p-6 space-y-6">
              {/* Who + when */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Stat label="Cashier" value={data.cashier?.name || `${data.cashiers?.length||0} cashier(s)`} icon={UserIcon} />
                <Stat label="Receipts Issued" value={data.issued || 0} icon={Receipt} tone="text-emerald-700" />
                <Stat label="Cancelled" value={data.cancelled || 0} icon={XCircle} tone={data.cancelled ? 'text-red-700' : 'text-slate-600'} />
                <Stat label="Generated" value={new Date(data.generated_at).toLocaleTimeString('en-IN')} icon={CalendarDays} small />
              </div>

              {/* Money */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="border-2 border-emerald-500 bg-emerald-50 rounded-lg p-4">
                  <div className="text-[10px] uppercase tracking-widest text-emerald-700 flex items-center gap-1"><TrendingUp className="w-3 h-3" /> Collected (Gross)</div>
                  <div className="font-heading font-bold text-3xl tabular text-emerald-800 mt-1" data-testid="de-collected">{inr(data.collected || 0)}</div>
                </div>
                <div className="border border-red-200 bg-red-50 rounded-lg p-4">
                  <div className="text-[10px] uppercase tracking-widest text-red-700 flex items-center gap-1"><TrendingDown className="w-3 h-3" /> Refunded / Vouchers</div>
                  <div className="font-heading font-bold text-3xl tabular text-red-700 mt-1" data-testid="de-refunded">{inr(data.refunded || 0)}</div>
                </div>
                <div className="border-2 border-slate-900 bg-slate-50 rounded-lg p-4">
                  <div className="text-[10px] uppercase tracking-widest text-slate-700 flex items-center gap-1"><Wallet className="w-3 h-3" /> Net Cash Handover</div>
                  <div className="font-heading font-bold text-3xl tabular text-slate-900 mt-1" data-testid="de-net">{inr(data.net || 0)}</div>
                </div>
              </div>

              {/* Cash Denomination Sheet */}
              <CashDenominationSheet expected={Number(data.by_mode?.find(m => m.mode === 'cash')?.amount || 0)} counts={counts} setCounts={setCounts} />

              {/* By mode */}
              <div>
                <div className="text-[11px] uppercase tracking-widest text-slate-600 font-bold mb-2">Breakdown by Payment Mode</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {(data.by_mode || []).length === 0 && <div className="col-span-4 text-sm text-slate-500 py-3 text-center">No collections</div>}
                  {(data.by_mode || []).map(m => {
                    const Icon = MODE_ICON[m.mode] || Wallet;
                    return (
                      <div key={m.mode} className="border border-slate-200 rounded px-3 py-2 flex items-center gap-2">
                        <Icon className="w-4 h-4 text-slate-500" />
                        <div className="flex-1">
                          <div className="text-[10px] uppercase text-slate-500 tracking-wide">{MODE_LABEL[m.mode] || m.mode}</div>
                          <div className="font-mono font-semibold tabular text-slate-800">{inr(m.amount)}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* By type */}
              <div>
                <div className="text-[11px] uppercase tracking-widest text-slate-600 font-bold mb-2">Breakdown by Receipt Type</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {(data.by_type || []).length === 0 && <div className="col-span-4 text-sm text-slate-500 py-3 text-center">—</div>}
                  {(data.by_type || []).map(t => (
                    <div key={t.type} className="border border-slate-200 rounded px-3 py-2">
                      <div className="text-[10px] uppercase text-slate-500 tracking-wide capitalize">{t.type.replace('_',' ')}</div>
                      <div className="font-mono font-semibold tabular text-slate-800">{inr(t.amount)}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Per cashier (grand view) */}
              {data.cashiers && data.cashiers.length > 0 && (
                <div>
                  <div className="text-[11px] uppercase tracking-widest text-slate-600 font-bold mb-2">Per Cashier</div>
                  <table className="w-full text-sm border border-slate-200">
                    <thead className="bg-slate-50 border-b border-slate-200 text-[11px] uppercase tracking-wide text-slate-600">
                      <tr className="text-left"><th className="px-3 py-2">Cashier</th><th className="px-3 py-2 text-right">Issued</th><th className="px-3 py-2 text-right">Cancelled</th><th className="px-3 py-2 text-right">Collected</th><th className="px-3 py-2 text-right">Refunded</th><th className="px-3 py-2 text-right">Net</th></tr>
                    </thead>
                    <tbody>
                      {data.cashiers.map(c => (
                        <tr key={c.id} className="border-b border-slate-100 last:border-0">
                          <td className="px-3 py-2">
                            <div className="font-medium">{c.name}</div>
                            <div className="text-[10px] text-slate-500 capitalize">{c.role || '—'}</div>
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular text-emerald-700">{c.issued}</td>
                          <td className="px-3 py-2 text-right font-mono tabular text-red-600">{c.cancelled}</td>
                          <td className="px-3 py-2 text-right font-mono tabular">{inr(c.collected)}</td>
                          <td className="px-3 py-2 text-right font-mono tabular">{inr(c.refunded)}</td>
                          <td className="px-3 py-2 text-right font-mono tabular font-bold">{inr(c.net)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Receipts list (single cashier) */}
              {data.receipts && data.receipts.length > 0 && (
                <div>
                  <div className="text-[11px] uppercase tracking-widest text-slate-600 font-bold mb-2">Receipts Issued ({data.receipts.length})</div>
                  <table className="w-full text-sm border border-slate-200">
                    <thead className="bg-slate-50 border-b border-slate-200 text-[11px] uppercase tracking-wide text-slate-600">
                      <tr className="text-left"><th className="px-3 py-2">Number</th><th className="px-3 py-2">Time</th><th className="px-3 py-2">Payer</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Mode</th><th className="px-3 py-2 text-right">Amount</th><th className="px-3 py-2">Status</th></tr>
                    </thead>
                    <tbody>
                      {data.receipts.map((r, i) => (
                        <tr key={i} className={`border-b border-slate-100 last:border-0 ${r.status==='cancelled' ? 'text-slate-400 line-through' : ''}`}>
                          <td className="px-3 py-2 font-mono text-[11px]">{r.number}</td>
                          <td className="px-3 py-2 text-[11px] text-slate-500">{new Date(r.created_at).toLocaleTimeString('en-IN')}</td>
                          <td className="px-3 py-2">{r.payer_name}</td>
                          <td className="px-3 py-2 capitalize text-slate-600 text-[11px]">{r.receipt_type?.replace('_',' ')}</td>
                          <td className="px-3 py-2 uppercase text-[10px]">{r.payment_mode}</td>
                          <td className="px-3 py-2 text-right font-mono tabular font-medium">{inr(r.total)}</td>
                          <td className="px-3 py-2"><span className={`text-[10px] px-1.5 py-0.5 rounded ${r.status==='cancelled'?'bg-red-100 text-red-800':'bg-emerald-100 text-emerald-800'}`}>{r.status || 'issued'}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Handover signature block */}
              <div className="grid grid-cols-2 gap-6 mt-8 pt-6 border-t border-slate-200 text-[12px]">
                <div>
                  <div className="border-t border-slate-400 mt-16 pt-1 text-center">Cashier Signature</div>
                  <div className="text-center text-slate-500 mt-1">{data.cashier?.name || '—'}</div>
                </div>
                <div>
                  <div className="border-t border-slate-400 mt-16 pt-1 text-center">Authorized By</div>
                  <div className="text-center text-slate-500 mt-1">Manager / Accountant</div>
                </div>
              </div>

              <div className="text-center text-[10px] text-slate-400 uppercase tracking-widest">
                Generated by {data.generated_by} · {new Date(data.generated_at).toLocaleString('en-IN')} · Balaji Convent Fee Management System
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

const Stat = ({ label, value, icon: Icon, tone = 'text-slate-900', small = false }) => (
  <div className="border border-slate-200 rounded-lg px-3 py-2 bg-white">
    <div className="text-[10px] uppercase tracking-widest text-slate-500 flex items-center gap-1"><Icon className="w-3 h-3" /> {label}</div>
    <div className={`font-heading font-semibold tabular ${small ? 'text-sm' : 'text-xl'} ${tone} mt-0.5`}>{value}</div>
  </div>
);

const CashDenominationSheet = ({ expected, counts, setCounts }) => {
  const counted = DENOMS.reduce((s, d) => s + d * (Number(counts[d]) || 0), 0);
  const diff = counted - expected;
  const zero = counted === 0;
  const match = !zero && Math.abs(diff) < 0.01;
  return (
    <div>
      <div className="text-[11px] uppercase tracking-widest text-slate-600 font-bold mb-2 flex items-center gap-2">
        <Banknote className="w-3.5 h-3.5" /> Cash Denomination Sheet
        <span className="text-[10px] text-slate-400 normal-case">Count each note/coin before closing the till</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="md:col-span-2 border border-slate-200 rounded-lg p-3 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase text-slate-500 border-b border-slate-200">
                <th className="py-1.5">Denomination</th>
                <th className="py-1.5 text-center">Count</th>
                <th className="py-1.5 text-right">Subtotal (₹)</th>
              </tr>
            </thead>
            <tbody>
              {DENOMS.map(d => {
                const c = counts[d] || '';
                const sub = d * (Number(c) || 0);
                return (
                  <tr key={d} className="border-b border-slate-100 last:border-0">
                    <td className="py-1.5 font-mono text-slate-700">₹ {d}</td>
                    <td className="py-1.5 text-center">
                      <input data-testid={`de-denom-${d}`} type="number" min="0" step="1" value={c}
                        onChange={e => setCounts({ ...counts, [d]: e.target.value })}
                        className="h-8 w-24 px-2 border border-slate-300 rounded text-center font-mono text-sm bg-white" />
                    </td>
                    <td className="py-1.5 text-right font-mono tabular text-slate-700">{sub.toFixed(0)}</td>
                  </tr>
                );
              })}
              <tr className="bg-slate-50 font-semibold">
                <td className="py-2">Counted Cash</td>
                <td></td>
                <td className="py-2 text-right font-mono text-lg tabular" data-testid="de-counted">{inr(counted)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className={`border-2 rounded-lg p-4 flex flex-col justify-between ${match ? 'border-emerald-500 bg-emerald-50' : diff !== 0 && !zero ? 'border-red-500 bg-red-50' : 'border-slate-300 bg-slate-50'}`}>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-slate-600">Expected Cash</div>
            <div className="font-heading font-bold text-xl tabular">{inr(expected)}</div>
            <div className="text-[10px] uppercase tracking-widest text-slate-600 mt-3">Counted Cash</div>
            <div className="font-heading font-bold text-xl tabular">{inr(counted)}</div>
            <div className={`text-[10px] uppercase tracking-widest mt-3 ${match ? 'text-emerald-800' : diff !== 0 && !zero ? 'text-red-800' : 'text-slate-600'}`}>{diff === 0 && !zero ? 'Match' : diff > 0 ? 'Excess in Till' : diff < 0 ? 'Short in Till' : 'Enter counts →'}</div>
            <div className={`font-heading font-bold text-3xl tabular ${match ? 'text-emerald-700' : diff !== 0 && !zero ? 'text-red-700' : 'text-slate-900'}`} data-testid="de-diff">{zero ? '—' : (diff > 0 ? '+' : '') + inr(diff)}</div>
          </div>
          <div className={`mt-3 rounded p-2 flex items-center gap-1.5 text-[11px] ${match ? 'bg-emerald-100 text-emerald-800' : diff !== 0 && !zero ? 'bg-red-100 text-red-800' : 'bg-white text-slate-500'}`}>
            {match ? <><CheckCircle2 className="w-4 h-4" /> Till reconciles — safe to hand over</> : diff !== 0 && !zero ? <><AlertTriangle className="w-4 h-4" /> Discrepancy — recount before handover</> : <>Fill in counts to auto-reconcile</>}
          </div>
        </div>
      </div>
    </div>
  );
};
