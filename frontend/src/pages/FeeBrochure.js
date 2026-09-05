import React, { useEffect, useState } from 'react';
import api from '@/lib/api';
import { PageHeader, inr } from '@/components/Layout';
import { Printer, FileDown } from 'lucide-react';
import { toast } from 'sonner';

const LOGO = "/school-logo.jpeg";

export default function FeeBrochure() {
  const [structures, setStructures] = useState([]);
  const [classes, setClasses] = useState([]);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [busStops, setBusStops] = useState([]);
  const [ay, setAy] = useState('2026-27');

  useEffect(() => {
    api.get('/fee-structures').then(r => {
      setStructures(r.data);
      const years = [...new Set(r.data.map(s => s.academic_year).filter(Boolean))].sort().reverse();
      if (years.length && !years.includes(ay)) setAy(years[0]);
    });
    api.get('/classes').then(r => setClasses(r.data));
    api.get('/bus-stops').then(r => setBusStops(r.data)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const availableYears = [...new Set(structures.map(s => s.academic_year).filter(Boolean))].sort().reverse();

  const busByArea = {};
  for (const s of busStops.filter(s => s.active !== false)) {
    const area = s.main_area || '(unspecified)';
    if (!busByArea[area]) busByArea[area] = [];
    busByArea[area].push(s);
  }
  const busAreas = Object.keys(busByArea).sort();

  const filtered = structures.filter(s => s.academic_year === ay);
  const cById = Object.fromEntries(classes.map(c => [c.id, c]));

  const openFeeStructurePdf = async () => {
    setPdfBusy(true);
    const win = window.open('', '_blank');
    try {
      const { data } = await api.get('/fee-structures/pdf', { params: { academic_year: ay }, responseType: 'blob' });
      const blobUrl = URL.createObjectURL(new Blob([data], { type: 'application/pdf' }));
      if (win) win.location.href = blobUrl;
    } catch (e) {
      if (win) win.close();
      toast.error('Could not open the Fee Structure PDF');
    }
    setPdfBusy(false);
  };

  // Group by medium
  const groups = {};
  for (const s of filtered) {
    const c = cById[s.class_id];
    const medium = c?.medium || 'Other';
    if (!groups[medium]) groups[medium] = [];
    groups[medium].push({ ...s, class_name: c?.name || '-' });
  }
  const orderedMediums = ['English','Semi-English','Marathi (Semi)','Junior College','Other'].filter(m => groups[m]);

  return (
    <>
      <PageHeader title="Fee Brochure" subtitle="Print-friendly annual fee list for parents"
        actions={
          <div className="flex gap-2 no-print">
            <select data-testid="brochure-year" value={ay} onChange={e=>setAy(e.target.value)} className="h-9 px-3 border border-slate-300 rounded text-sm bg-white">
              {availableYears.length === 0 && <option value={ay}>{ay}</option>}
              {availableYears.map(y => <option key={y} value={y}>{y}{y === availableYears[0] ? ' (current year)' : ''}{y === availableYears[1] ? ' (last year)' : ''}</option>)}
            </select>
            <button data-testid="brochure-view-pdf" onClick={openFeeStructurePdf} disabled={pdfBusy} className="h-9 px-3 bg-emerald-600 text-white text-sm rounded flex items-center gap-1.5 hover:bg-emerald-700 disabled:opacity-60"><FileDown className="w-4 h-4" /> {pdfBusy ? 'Opening…' : 'View Fee Structure (PDF)'}</button>
            <button data-testid="brochure-print" onClick={()=>window.print()} className="h-9 px-3 bg-blue-600 text-white text-sm rounded flex items-center gap-1.5 hover:bg-blue-700"><Printer className="w-4 h-4" /> Print Brochure</button>
          </div>
        }
      />
      <div className="p-6">
        <div className="print-page bg-white border border-slate-300 mx-auto max-w-4xl">
          {/* Cover */}
          <div className="p-8 border-b-4 border-double border-slate-900 text-center">
            <img src={LOGO} alt="logo" className="w-24 h-24 rounded-full object-cover mx-auto mb-3" />
            <div className="font-heading text-3xl font-black tracking-tight uppercase">BALAJI CONVENT & JUNIOR COLLEGE</div>
            <div className="text-sm font-semibold text-slate-700 mt-1">BUTIBORI · DIST. NAGPUR — 441122</div>
            <div className="text-[12px] text-slate-600 mt-3">NURSERY TO CLASS 10 (English · Semi-English · Marathi Medium)</div>
            <div className="text-[12px] text-slate-600">Junior College — Science · Commerce · Arts · Electronics · Fisheries (State Pattern)</div>
            <div className="inline-block mt-5 px-6 py-2 border-2 border-slate-900 tracking-widest font-bold">FEE STRUCTURE · {ay}</div>
            <div className="italic text-slate-600 text-sm mt-3">Shaping Tomorrow, Building Excellence</div>
          </div>

          {orderedMediums.map(medium => (
            <div key={medium} className="p-6 border-b border-slate-300" style={{ pageBreakInside: 'avoid' }}>
              <div className="flex items-baseline justify-between mb-3">
                <h2 className="font-heading text-xl font-bold uppercase tracking-wide text-slate-900">{medium} Medium</h2>
                <span className="text-[11px] text-slate-500">{groups[medium].length} classes</span>
              </div>
              <table className="w-full text-[12px] border border-slate-400" data-testid={`brochure-table-${medium}`}>
                <thead>
                  <tr className="bg-slate-100 text-[11px] border-b border-slate-400">
                    <th className="border-r border-slate-400 py-1.5 px-2 text-left w-48">CLASS</th>
                    <th className="border-r border-slate-400 py-1.5 px-2 text-left">FEE HEADS</th>
                    <th className="py-1.5 px-2 text-right w-28">TOTAL (₹)</th>
                  </tr>
                </thead>
                <tbody>
                  {groups[medium].sort((a,b)=>a.class_name.localeCompare(b.class_name) || (a.stream||'').localeCompare(b.stream||'') || (a.applies_to||'').localeCompare(b.applies_to||'')).map(fs => (
                    <tr key={fs.id} className="border-b border-slate-300">
                      <td className="border-r border-slate-300 px-2 py-1.5 font-semibold uppercase">
                        {fs.class_name}{fs.stream ? ` · ${fs.stream}` : ''}
                        {fs.applies_to === 'new_only' && <span className="ml-1.5 normal-case font-normal text-[10px] text-amber-700">(new admission)</span>}
                        {fs.applies_to === 'returning_only' && <span className="ml-1.5 normal-case font-normal text-[10px] text-blue-700">(continuing)</span>}
                      </td>
                      <td className="border-r border-slate-300 px-2 py-1.5 text-[11px]">
                        {fs.items?.map(it => (
                          <span key={it.fee_head_id || it.fee_head_name} className="inline-block mr-3 whitespace-nowrap">
                            {it.fee_head_name}: <span className="font-mono tabular font-semibold">{Number(it.amount||0).toLocaleString('en-IN')}</span>
                          </span>
                        ))}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular font-mono font-bold text-slate-900">{Number(fs.total||0).toLocaleString('en-IN')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

          {orderedMediums.length === 0 && <div className="p-12 text-center text-slate-500">No fee structures loaded for {ay} yet. Go to Fee Structure → "Load {ay}" (administrator/manager/accountant) to load the authoritative amounts from the school's published fee-structure PDF.</div>}

          {/* Bus Fees */}
          {busAreas.length > 0 && (
            <div className="p-6 border-b border-slate-300" style={{ pageBreakInside: 'avoid' }}>
              <div className="flex items-baseline justify-between mb-3">
                <h2 className="font-heading text-xl font-bold uppercase tracking-wide text-slate-900">Bus Fees ({ay})</h2>
                <span className="text-[11px] text-slate-500">{busStops.filter(s => s.active !== false).length} stops · {busAreas.length} areas</span>
              </div>
              {busAreas.map(area => (
                <div key={area} className="mb-3" data-testid={`brochure-bus-area-${area}`}>
                  <div className="text-[12px] font-bold uppercase tracking-wide text-slate-700 mb-1">{area}</div>
                  <table className="w-full text-[12px] border border-slate-400">
                    <thead>
                      <tr className="bg-slate-100 text-[11px] border-b border-slate-400">
                        <th className="border-r border-slate-400 py-1 px-2 text-left w-16">#</th>
                        <th className="border-r border-slate-400 py-1 px-2 text-left">SUB STOP / LANDMARK</th>
                        <th className="py-1 px-2 text-right w-32">MONTHLY FEE (₹)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {busByArea[area].sort((a, b) => a.stop_no - b.stop_no).map(s => (
                        <tr key={s.id} className="border-b border-slate-300">
                          <td className="border-r border-slate-300 px-2 py-1 font-mono">{s.stop_no}</td>
                          <td className="border-r border-slate-300 px-2 py-1">{s.stop_name}</td>
                          <td className="px-2 py-1 text-right tabular font-mono font-semibold">{Number(s.monthly_fee || 0).toLocaleString('en-IN')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}

          {/* Footer */}
          <div className="p-6 text-[11px] text-slate-600 space-y-1">
            <div className="font-bold text-slate-800 mb-2">IMPORTANT NOTES:</div>
            <ul className="list-disc pl-5 space-y-0.5">
              <li>Tuition fees are split across three quarters (Q1 / Q2 / Q3). Due dates: Q1 by 30 Jun · Q2 by 30 Sep · Q3 by 31 Dec.</li>
              <li>Admission fee is one-time; Continuation fee is annual (returning students).</li>
              <li>Bus fee is billed separately every month based on the exact stop assigned (see Bus Fees above); it is not part of the annual school fee total.</li>
              <li>Fees once paid will not be refunded except in exceptional cases approved by the management.</li>
              <li>All payments must be made at the school fee counter — Cash / Cheque / DD / UPI / NEFT accepted.</li>
              <li>Please preserve receipts. A QR code on every receipt lets the office look it up instantly.</li>
            </ul>
            <div className="mt-6 grid grid-cols-2 gap-8 text-center pt-4">
              <div className="border-t border-slate-500 pt-1">Accountant</div>
              <div className="border-t border-slate-500 pt-1">Principal / Administrator</div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
