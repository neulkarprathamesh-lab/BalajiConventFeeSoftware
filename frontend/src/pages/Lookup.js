import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import { ShieldCheck, ShieldAlert, XCircle, MapPin, Phone, Calendar, Hash, School } from 'lucide-react';
import ReceiptEngine from '@/components/receipt/ReceiptEngine';
import { API } from '@/lib/api';

const LOGO = '/school-logo.jpeg';
const inr  = (n) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(n || 0);

/**
 * Public Verification Portal — parents scan the QR on any Balaji FeeHub
 * receipt and land here. NO login is required. The page proves that the
 * receipt was issued by the school (matched receipt number, matched date,
 * matched amount) and lets the parent download / print a PDF copy.
 */
export default function Lookup() {
  const { number } = useParams();
  const [data, setData] = useState(null);
  const [err, setErr]   = useState('');
  const [verifiedAt]    = useState(() => new Date());

  useEffect(() => {
    axios.get(`${API}/public/lookup/${number}`)
      .then(r => setData(r.data))
      .catch(e => setErr(e?.response?.data?.detail || 'Receipt not found'));
  }, [number]);

  if (err) return (
    <div className="min-h-screen bg-gradient-to-b from-rose-50 to-white flex items-center justify-center p-6" data-testid="verify-not-found">
      <div className="max-w-md bg-white border-2 border-rose-200 rounded-2xl p-8 text-center shadow-xl">
        <ShieldAlert className="w-14 h-14 text-rose-500 mx-auto mb-3" />
        <div className="text-rose-700 text-xl font-bold mb-2">Receipt Not Verified</div>
        <div className="text-sm text-slate-600 mb-1">Receipt number <span className="font-mono font-bold">{number}</span> could not be located in Balaji FeeHub.</div>
        <div className="text-[13px] text-slate-500 mt-3">If this is a receipt you were handed, please contact the school office at Balaji Convent &amp; Junior College, Butibori, Nagpur.</div>
      </div>
    </div>
  );
  if (!data) return <div className="min-h-screen flex items-center justify-center text-sm text-slate-500">Verifying receipt…</div>;

  const r = data.receipt;
  const s = data.student;
  const l = data.ledger;
  const isCancelled = r.status === 'cancelled';

  return (
    <div className="min-h-screen bg-slate-100" data-testid="verify-portal">
      {/* Top bar with brand */}
      <header className="bg-slate-900 text-white shadow-sm">
        <div className="max-w-5xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <img src={LOGO} className="w-11 h-11 rounded-full ring-2 ring-slate-700 object-cover" alt="Balaji Convent" />
            <div className="leading-tight">
              <div className="font-heading font-bold text-lg">Balaji FeeHub</div>
              <div className="text-[10px] tracking-[0.2em] uppercase text-slate-300">Balaji Convent &amp; Junior College · Butibori, Nagpur</div>
            </div>
          </div>
          <div className="text-right hidden sm:block">
            <div className="text-[10px] uppercase tracking-widest text-slate-400">Public Verification Portal</div>
            <div className="text-[11px] text-slate-300">View-only · No login required</div>
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-5">
        {/* VERIFICATION BADGE */}
        <div
          className={`rounded-2xl border-2 shadow-lg overflow-hidden ${isCancelled ? 'bg-rose-50 border-rose-300' : 'bg-emerald-50 border-emerald-300'}`}
          data-testid={isCancelled ? 'verify-cancelled-badge' : 'verify-ok-badge'}
        >
          <div className="p-5 sm:p-6 flex items-start gap-4">
            <div className={`w-14 h-14 sm:w-16 sm:h-16 rounded-full flex items-center justify-center flex-shrink-0 shadow-md ${isCancelled ? 'bg-rose-600' : 'bg-emerald-600'}`}>
              {isCancelled ? <XCircle className="w-8 h-8 sm:w-10 sm:h-10 text-white" /> : <ShieldCheck className="w-8 h-8 sm:w-10 sm:h-10 text-white" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className={`text-xs sm:text-sm tracking-[0.2em] uppercase font-bold ${isCancelled ? 'text-rose-800' : 'text-emerald-800'}`}>
                {isCancelled ? 'Receipt Cancelled' : 'Receipt Verified · Genuine'}
              </div>
              <div className={`font-heading font-black text-2xl sm:text-3xl mt-0.5 ${isCancelled ? 'text-rose-900' : 'text-emerald-900'}`}>
                {isCancelled ? 'This receipt is no longer valid' : 'Issued by Balaji Convent'}
              </div>
              <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-3 text-[11px] sm:text-[12px]">
                <MetaField icon={Hash}     label="Receipt No."   value={<span className="font-mono">{r.number}</span>} tone={isCancelled ? 'rose' : 'emerald'} />
                <MetaField icon={Calendar} label="Issued On"     value={new Date(r.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })} tone={isCancelled ? 'rose' : 'emerald'} />
                <MetaField icon={School}   label="Academic Year" value={r.academic_year} tone={isCancelled ? 'rose' : 'emerald'} />
                <MetaField icon={ShieldCheck} label="Verified At" value={verifiedAt.toLocaleString('en-IN', { hour12: true })} tone={isCancelled ? 'rose' : 'emerald'} />
              </div>
              {isCancelled && r.cancel_reason && (
                <div className="mt-3 p-3 rounded bg-white border border-rose-200 text-[12px] sm:text-[13px]">
                  <span className="font-semibold text-rose-800 uppercase tracking-widest text-[10px]">Cancellation Reason: </span>
                  <span className="text-rose-900">{r.cancel_reason}</span>
                </div>
              )}
              {!isCancelled && (
                <div className={`mt-3 text-[12px] sm:text-[13px] text-emerald-900`}>
                  This is an authentic receipt of <b>{inr(r.total)}</b> received via <b className="uppercase">{r.payment_mode}</b>. You can print or download a PDF copy below — it looks identical to the original.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Student card */}
        {s && (
          <div className="grid md:grid-cols-3 gap-4">
            <div className="bg-white border border-slate-200 rounded-xl p-4 md:col-span-2" data-testid="verify-student">
              <div className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">Student</div>
              <div className="font-heading text-xl font-bold mt-0.5">{s.name}</div>
              <div className="text-[13px] text-slate-500 font-mono">{s.admission_no}</div>
              {s.guardian_name && (
                <div className="mt-2 flex items-center gap-1.5 text-[13px] text-slate-700">
                  <Phone className="w-3.5 h-3.5 text-slate-400" /> Guardian: <b>{s.guardian_name}</b> · <span className="font-mono">{s.guardian_mobile || '—'}</span>
                </div>
              )}
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">Received</div>
              <div className="text-3xl font-black font-mono text-slate-900 mt-0.5">{inr(r.total)}</div>
              <div className="text-[11px] text-slate-500 uppercase mt-0.5">{r.payment_mode}{r.payment_reference ? ` · ${r.payment_reference}` : ''}</div>
              <div className="mt-2 text-[11px] italic text-slate-500">{r.amount_in_words}</div>
            </div>
          </div>
        )}

        {/* Ledger summary */}
        {l && (
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden" data-testid="verify-ledger">
            <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
              <h2 className="text-sm font-semibold text-slate-800">Annual Ledger Summary</h2>
              <div className="text-[11px] text-slate-500">All receipts and adjustments for this academic year, at a glance.</div>
            </div>
            <div className="grid sm:grid-cols-5 gap-0 divide-y sm:divide-y-0 sm:divide-x divide-slate-100">
              <LedgerStat label="Total Fee"   value={inr(l.total_fee)} />
              <LedgerStat label="Paid"        value={inr(l.paid)}      tone="text-emerald-700" />
              <LedgerStat label="Concession"  value={inr(l.adjusted)} />
              <LedgerStat label="Refunded"    value={inr(l.refunded)} />
              <LedgerStat label="Outstanding" value={inr(l.outstanding)} tone={l.outstanding > 0 ? 'text-rose-700 font-bold' : 'text-emerald-700 font-bold'} />
            </div>
            {l.receipts?.length > 0 && (
              <div className="border-t border-slate-100 p-4">
                <div className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-2">Recent Receipts</div>
                <div className="border border-slate-200 rounded-lg overflow-hidden">
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="bg-slate-50 text-slate-600 text-[10px] uppercase tracking-widest">
                        <th className="text-left px-3 py-2">Number</th>
                        <th className="text-left px-3 py-2">Type</th>
                        <th className="text-left px-3 py-2">Date</th>
                        <th className="text-right px-3 py-2">Amount</th>
                        <th className="text-left px-3 py-2">Mode</th>
                      </tr>
                    </thead>
                    <tbody>
                      {l.receipts.slice(0, 10).map(x => (
                        <tr key={x.number} className={`border-t border-slate-100 ${x.number === r.number ? 'bg-emerald-50' : ''}`}>
                          <td className="px-3 py-2 font-mono font-medium">{x.number} {x.number === r.number && <span className="text-[9px] uppercase tracking-widest text-emerald-700 font-bold ml-1">this receipt</span>}</td>
                          <td className="px-3 py-2 capitalize text-slate-600">{x.type?.replace('_',' ')}</td>
                          <td className="px-3 py-2 text-slate-600 font-mono text-[11px]">{new Date(x.date).toLocaleDateString('en-IN')}</td>
                          <td className="px-3 py-2 text-right font-mono tabular font-semibold">{inr(x.total)}</td>
                          <td className="px-3 py-2 uppercase text-[11px] text-slate-500">{x.mode}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {l.receipts_count > 10 && <div className="text-[11px] text-slate-500 mt-2 text-center">Showing latest 10 of {l.receipts_count} receipts. Contact the office for the complete history.</div>}
              </div>
            )}
          </div>
        )}

        {/* THE ACTUAL RECEIPT (rendered by the universal engine, public toolbar) */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
            <h2 className="text-sm font-semibold text-slate-800">Full Receipt</h2>
            <div className="text-[11px] text-slate-500">Print or download a PDF copy — it looks identical to the paper original.</div>
          </div>
          <div className="p-4">
            <ReceiptEngine r={r} publicMode showControls={false} />
          </div>
        </div>

        <div className="text-center text-[11px] text-slate-500 py-4 space-y-1">
          <div>Balaji Convent &amp; Junior College · Butibori, Nagpur</div>
          <div className="flex items-center justify-center gap-1"><MapPin className="w-3 h-3" /> Public verification via QR — no personal data is stored on this page.</div>
        </div>
      </div>
    </div>
  );
}


function MetaField({ icon: Icon, label, value, tone = 'emerald' }) {
  const color = tone === 'rose' ? 'text-rose-800' : 'text-emerald-800';
  return (
    <div>
      <div className={`flex items-center gap-1 ${color} text-[10px] uppercase tracking-widest font-bold`}>
        <Icon className="w-3 h-3" /> {label}
      </div>
      <div className={`${color} font-bold mt-0.5`}>{value}</div>
    </div>
  );
}

function LedgerStat({ label, value, tone = 'text-slate-900' }) {
  return (
    <div className="p-3 text-center">
      <div className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">{label}</div>
      <div className={`font-mono tabular text-[15px] mt-0.5 ${tone}`}>{value}</div>
    </div>
  );
}
