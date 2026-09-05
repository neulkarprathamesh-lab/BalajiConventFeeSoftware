import React, { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import axios from 'axios';
import { QRCodeSVG } from 'qrcode.react';
import { Printer, ArrowLeft, Shield, Info } from 'lucide-react';
import { API } from '@/lib/api';

const LOGO = "/school-logo.jpeg";
const inr = (n) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(n || 0);

// Deterministic slip id (stable per family per day)
const slipId = (adm, when) => {
  const s = `${adm}-${when.toISOString().slice(0,10)}`;
  let h = 0; for (let i = 0; i < s.length; i++) h = ((h<<5)-h) + s.charCodeAt(i); h |= 0;
  return `BC-SLIP-${Math.abs(h).toString(36).toUpperCase().padStart(8,'0').slice(0,8)}`;
};

export default function FeeSlip() {
  const { adm } = useParams();
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const now = useMemo(() => new Date(), []);
  const sid = useMemo(() => slipId(adm, now), [adm, now]);

  useEffect(() => {
    axios.get(`${API}/public/student-lookup/${adm}`)
      .then(r => setData(r.data))
      .catch(e => setErr(e?.response?.data?.detail || 'Student not found'));
  }, [adm]);

  if (err) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="max-w-md bg-white border border-slate-200 rounded p-8 text-center">
        <div className="text-red-700 text-lg font-semibold mb-2">Student Not Found</div>
        <div className="text-sm text-slate-500">Admission no. <span className="font-mono">{adm}</span> was not located.</div>
      </div>
    </div>
  );
  if (!data) return <div className="min-h-screen flex items-center justify-center text-sm text-slate-500">Loading…</div>;

  const children = data.children || [];
  const combined = data.combined || {};
  const verifyUrl = `${window.location.origin}/parent/${adm}`;

  return (
    <div className="min-h-screen bg-slate-100">
      {/* Action bar */}
      <div className="bg-white border-b border-slate-200 px-6 py-2 flex items-center justify-between no-print">
        <Link to={`/parent/${adm}`} data-testid="fs-back" className="text-sm text-slate-700 hover:text-slate-900 flex items-center gap-1.5"><ArrowLeft className="w-4 h-4" /> Back to lookup</Link>
        <div className="flex items-center gap-2">
          <div className="text-[11px] text-slate-500">Use browser's <b>Print → Save as PDF</b> to download</div>
          <button data-testid="fs-print" onClick={()=>window.print()} className="h-9 px-4 bg-slate-900 text-white rounded text-sm flex items-center gap-1.5"><Printer className="w-4 h-4" /> Print / Save PDF</button>
        </div>
      </div>

      {/* A4 sheet */}
      <div className="max-w-[820px] mx-auto my-6 print:my-0 print:max-w-none">
        <div className="bg-white shadow print:shadow-none border border-slate-200 print:border-0 relative overflow-hidden">
          {/* Watermark */}
          <div aria-hidden className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-[0.04]">
            <div className="text-[140px] font-heading font-bold tracking-tighter rotate-[-24deg] text-slate-900">BALAJI CONVENT</div>
          </div>

          {/* Navy header */}
          <div className="relative bg-slate-900 text-white px-8 py-5 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <img src={LOGO} alt="logo" className="w-16 h-16 rounded-full object-cover ring-2 ring-slate-700" />
              <div>
                <div className="font-heading font-bold text-xl tracking-tight leading-tight">BALAJI CONVENT & JUNIOR COLLEGE</div>
                <div className="text-[11px] text-slate-300 uppercase tracking-widest">Butibori, Nagpur · 441122 · Maharashtra</div>
                <div className="text-[11px] text-slate-400 mt-0.5">Ph: 07103-234567 · info@balajiconventbutibori.edu.in</div>
              </div>
            </div>
            <div className="text-right">
              <div className="inline-block bg-white text-slate-900 rounded px-3 py-1 font-heading font-bold text-[13px]">FAMILY FEE SLIP</div>
              <div className="text-[10px] text-slate-300 uppercase tracking-widest mt-1">For scholarship / bank use</div>
            </div>
          </div>

          {/* Slip meta */}
          <div className="relative px-8 py-4 border-b border-slate-200 grid grid-cols-3 gap-4 text-[12px]">
            <div><div className="text-[10px] uppercase tracking-widest text-slate-500">Slip No</div><div className="font-mono font-bold text-slate-900 text-sm">{sid}</div></div>
            <div><div className="text-[10px] uppercase tracking-widest text-slate-500">Issue Date</div><div className="font-semibold">{now.toLocaleDateString('en-IN', { day:'2-digit', month:'long', year:'numeric' })}</div></div>
            <div><div className="text-[10px] uppercase tracking-widest text-slate-500">Academic Year</div><div className="font-semibold">2026-27</div></div>
          </div>

          {/* Guardian + family */}
          <div className="relative px-8 py-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-1">Guardian</div>
                <div className="font-heading font-semibold text-lg">{children[0]?.student?.guardian_name || '—'}</div>
                <div className="text-[12px] text-slate-600">Mobile: <span className="font-mono">{children[0]?.student?.guardian_mobile || '—'}</span></div>
                <div className="text-[12px] text-slate-600 mt-2">Family of <b>{children.length}</b> child{children.length>1?'ren':''} — listed below.</div>
              </div>
              {/* QR verification */}
              <div className="text-center border border-slate-200 rounded p-2">
                <QRCodeSVG value={verifyUrl} size={92} level="M" includeMargin={false} />
                <div className="text-[9px] text-slate-500 uppercase tracking-widest mt-1">Scan to verify</div>
              </div>
            </div>

            {/* Family totals */}
            <div className="mt-5 border-t-2 border-slate-900 pt-3">
              <div className="text-[10px] uppercase tracking-widest text-slate-600 font-bold mb-2">Family Ledger Summary</div>
              <div className="grid grid-cols-4 gap-3 text-[12px]">
                <Cell label="Total Annual Fee" v={combined.total_fee} />
                <Cell label="Paid to Date" v={combined.paid} tone="text-emerald-700" />
                <Cell label="Concession" v={combined.adjusted || 0} />
                <Cell label="Outstanding" v={combined.outstanding} tone={combined.outstanding > 0 ? 'text-red-700 font-bold' : 'text-emerald-700 font-bold'} big />
              </div>
            </div>

            {/* Per child block */}
            <div className="mt-6">
              <div className="text-[10px] uppercase tracking-widest text-slate-600 font-bold mb-2">Children</div>
              <table className="w-full text-[12px] border border-slate-300">
                <thead className="bg-slate-100 text-[10px] uppercase tracking-wide text-slate-700">
                  <tr className="text-left border-b border-slate-300">
                    <th className="px-2 py-1.5">Admission No</th>
                    <th className="px-2 py-1.5">Name</th>
                    <th className="px-2 py-1.5">Class</th>
                    <th className="px-2 py-1.5 text-right">Annual Fee</th>
                    <th className="px-2 py-1.5 text-right">Paid</th>
                    <th className="px-2 py-1.5 text-right">Concession</th>
                    <th className="px-2 py-1.5 text-right">Outstanding</th>
                  </tr>
                </thead>
                <tbody>
                  {children.map(c => (
                    <tr key={c.student.admission_no} className="border-b border-slate-200 last:border-0">
                      <td className="px-2 py-1.5 font-mono">{c.student.admission_no}</td>
                      <td className="px-2 py-1.5 font-medium">{c.student.name}</td>
                      <td className="px-2 py-1.5">{c.student.class_name || '—'}</td>
                      <td className="px-2 py-1.5 text-right font-mono tabular">{inr(c.ledger.total_fee)}</td>
                      <td className="px-2 py-1.5 text-right font-mono tabular text-emerald-700">{inr(c.ledger.paid)}</td>
                      <td className="px-2 py-1.5 text-right font-mono tabular">{inr(c.ledger.adjusted)}</td>
                      <td className={`px-2 py-1.5 text-right font-mono tabular font-semibold ${c.ledger.outstanding > 0 ? 'text-red-700' : 'text-emerald-700'}`}>{inr(c.ledger.outstanding)}</td>
                    </tr>
                  ))}
                  <tr className="bg-slate-900 text-white font-bold">
                    <td className="px-2 py-2" colSpan="3">FAMILY TOTAL</td>
                    <td className="px-2 py-2 text-right font-mono tabular">{inr(combined.total_fee)}</td>
                    <td className="px-2 py-2 text-right font-mono tabular">{inr(combined.paid)}</td>
                    <td className="px-2 py-2 text-right font-mono tabular">{inr(combined.adjusted || 0)}</td>
                    <td className="px-2 py-2 text-right font-mono tabular">{inr(combined.outstanding)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Recent Receipts (compact - first child's most recent 6) */}
            {children[0]?.ledger?.receipts?.length > 0 && (
              <div className="mt-5">
                <div className="text-[10px] uppercase tracking-widest text-slate-600 font-bold mb-2">Recent Receipts (across family)</div>
                <table className="w-full text-[11px] border border-slate-200">
                  <thead className="bg-slate-50 text-[9px] uppercase text-slate-600">
                    <tr className="text-left"><th className="px-2 py-1">Receipt No</th><th className="px-2 py-1">Child</th><th className="px-2 py-1">Date</th><th className="px-2 py-1">Type</th><th className="px-2 py-1">Mode</th><th className="px-2 py-1 text-right">Amount</th></tr>
                  </thead>
                  <tbody>
                    {children.flatMap(c => (c.ledger.receipts || []).map(r => ({ ...r, childName: c.student.name })))
                      .sort((a,b) => new Date(b.date) - new Date(a.date)).slice(0, 8).map((r, i) => (
                        <tr key={i} className="border-b border-slate-100 last:border-0">
                          <td className="px-2 py-1 font-mono">{r.number}</td>
                          <td className="px-2 py-1">{r.childName}</td>
                          <td className="px-2 py-1">{new Date(r.date).toLocaleDateString('en-IN')}</td>
                          <td className="px-2 py-1 capitalize text-slate-600">{r.type?.replace('_',' ')}</td>
                          <td className="px-2 py-1 uppercase text-[10px]">{r.mode}</td>
                          <td className="px-2 py-1 text-right font-mono tabular">{inr(r.total)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Signature + seal */}
            <div className="grid grid-cols-3 gap-6 mt-8 pt-5 border-t border-slate-200 text-[11px]">
              <div>
                <div className="text-[9px] uppercase tracking-widest text-slate-500 mb-2 flex items-center gap-1"><Shield className="w-3 h-3" /> Verification</div>
                <div className="text-slate-600 text-[10px] leading-snug">This slip carries a QR code that verifies the family's live ledger on our school system. Scan the QR at the top-right.</div>
              </div>
              <div className="text-center">
                <div className="w-24 h-24 rounded-full border-2 border-slate-400 flex items-center justify-center mx-auto text-[9px] text-slate-400 uppercase tracking-widest">School Seal</div>
              </div>
              <div>
                <div className="border-t border-slate-400 mt-16 pt-1 text-center text-[11px]">Principal / Accountant</div>
                <div className="text-center text-[9px] text-slate-500 mt-0.5">Signature not required — computer-generated</div>
              </div>
            </div>

            {/* Footer note */}
            <div className="mt-5 bg-slate-50 border border-slate-200 rounded p-3 text-[10px] text-slate-600 flex items-start gap-1.5">
              <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
              <span>This is a computer-generated fee statement. Slip ID <b className="font-mono">{sid}</b> uniquely identifies this document. For scholarship, bank loan, or subsidy applications please attach along with individual paid receipts. Any queries: visit the school office 9 AM – 3 PM, Mon–Sat.</span>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @media print {
          body { background: white !important; }
          .no-print, header, nav { display: none !important; }
        }
      `}</style>
    </div>
  );
}

const Cell = ({ label, v, tone = 'text-slate-900', big = false }) => (
  <div>
    <div className="text-[10px] uppercase tracking-widest text-slate-500">{label}</div>
    <div className={`font-heading tabular ${big ? 'text-2xl' : 'text-lg'} font-bold ${tone} mt-0.5`}>{inr(v)}</div>
  </div>
);
