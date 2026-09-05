import React from 'react';
import { V, inrPrint } from '../ReceiptPrimitives';

// Compact label:value row (same tight baseline approach as the fee receipt),
// used for the 210×142.8mm landscape geometry so the bus receipt fits.
const CRow = ({ label, value, mono = false, labelW = 78 }) => (
  <div className="flex whitespace-nowrap" style={{ height: 15 }}>
    <div className="uppercase tracking-tight text-black font-bold shrink-0" style={{ width: labelW, fontSize: 7.5, lineHeight: '15px' }}>{label}</div>
    <div className="text-slate-600 shrink-0 px-1" style={{ lineHeight: '15px', fontSize: 7.5 }}>:</div>
    <div className={`flex-1 border-b border-slate-400 whitespace-normal overflow-hidden ${mono ? 'font-mono' : ''}`} style={{ fontSize: 8.5, lineHeight: '11px', paddingBottom: 2 }}>{V(value)}</div>
  </div>
);

/**
 * BusReceiptBody — bus fee receipt with route + stop + period breakdown.
 * Compact mode (RECEIPT_142 / A5) uses the same efficient DETAILS + table-left /
 * amount-panel-right arrangement as the fee receipt so it fits 210×142.8mm.
 */
export default function BusReceiptBody({ r, compact = false }) {
  const meta = r.metadata || {};
  const snapshot = r.student_snapshot || {};
  const total = Number(r.total || 0);
  const lines = r.lines || [];
  const busStop = snapshot.bus_stop_name ? `${snapshot.bus_main_area ? snapshot.bus_main_area + ' — ' : ''}${snapshot.bus_stop_name}` : (meta.bus_stop_name || '—');

  if (compact) {
    const thBase = 'border align-middle font-bold leading-tight text-[7.5px] py-[3px]';
    const tdBase = 'border align-middle leading-tight py-[2px]';
    const panelLabel = 'uppercase tracking-wide text-black font-bold text-[7.5px]';
    return (
      <div className="text-[10px] relative mt-1">
        <div className="border-2" style={{ borderColor: '#111' }}>
          <div className="text-center font-bold uppercase border-b-2 text-[9px] py-[1px]" style={{ borderColor: '#111' }}>Details</div>
          <div className="grid grid-cols-2 gap-x-8 px-3 py-1">
            <div>
              <CRow label="Student Name" value={snapshot.name || r.payer_name} />
              <CRow label="Admission No." value={snapshot.admission_no} mono />
              <CRow label="Class / Div." value={`${snapshot.class_name || '—'}${snapshot.section ? ' / ' + snapshot.section : ''}`} />
            </div>
            <div>
              <CRow label="Bus Stop" value={busStop} />
              <CRow label="Route" value={meta.bus_route} />
              <CRow label="Payment Mode" value={String(r.payment_mode || '').toUpperCase()} />
            </div>
          </div>
        </div>

        <div className="flex gap-1 mt-1 items-stretch">
          <div className="flex flex-col" style={{ flex: '1 1 66%' }}>
            <table className="w-full border-2 border-collapse h-full" style={{ borderColor: '#111' }}>
              <colgroup><col style={{ width: '10%' }} /><col /><col style={{ width: '26%' }} /></colgroup>
              <thead>
                <tr className="bg-slate-100">
                  <th className={`text-center ${thBase}`} style={{ borderColor: '#111' }}>SR.<br/>NO.</th>
                  <th className={`text-left px-2 ${thBase}`} style={{ borderColor: '#111' }}>PERIOD / DESCRIPTION</th>
                  <th className={`text-center px-1 ${thBase}`} style={{ borderColor: '#111' }}>AMOUNT<br/>(₹)</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i}>
                    <td className={`text-center ${tdBase}`} style={{ borderColor: '#ccc' }}>{i + 1}</td>
                    <td className={`px-2 ${tdBase}`} style={{ borderColor: '#ccc' }}>{l.fee_head_name}{l.installment ? <span className="text-slate-500"> · {l.installment}</span> : null}</td>
                    <td className={`text-right px-2 font-mono ${tdBase}`} style={{ borderColor: '#ccc' }}>{inrPrint(l.amount)}</td>
                  </tr>
                ))}
                <tr className="font-bold" style={{ background: '#f8fafc' }}>
                  <td colSpan={2} className={`text-right px-2 ${tdBase}`} style={{ borderColor: '#111' }}>TOTAL</td>
                  <td className={`text-right px-2 font-mono ${tdBase} text-[11px]`} style={{ borderColor: '#111' }}>₹ {inrPrint(total)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="border-2 flex flex-col" style={{ borderColor: '#111', flex: '1 1 34%' }}>
            <div className="border-b px-2.5 py-[3px] flex-1" style={{ borderColor: '#111' }}>
              <div className={panelLabel}>Amount in Words</div>
              <div className="font-semibold leading-snug mt-0.5 text-[9px]">{V(r.amount_in_words)}</div>
            </div>
            <div className="bg-slate-100 text-center flex flex-col items-center justify-center px-2 py-1">
              <div className={panelLabel}>Amount Received</div>
              <div className="font-black mt-0.5 text-[15px]">₹ {inrPrint(total)}</div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const fs = 'text-[11px]';
  return (
    <div className={`${fs} relative mt-2`}>
      <div className="grid grid-cols-2 gap-3 border" style={{ borderColor: 'var(--line)' }}>
        <Field label="Student Name"     value={snapshot.name || r.payer_name} big />
        <Field label="Admission No."    value={snapshot.admission_no} mono />
        <Field label="Class / Division" value={`${snapshot.class_name || '—'}${snapshot.section ? ' / ' + snapshot.section : ''}`} />
        <Field label="Bus Stop"         value={busStop} />
        <Field label="Route"            value={meta.bus_route} />
        <Field label="Payment Mode"     value={String(r.payment_mode || '').toUpperCase()} />
      </div>

      <table className="w-full mt-2 border" style={{ borderColor: 'var(--line)' }}>
        <thead>
          <tr style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}>
            <th className="text-center py-1 w-10 text-[10px]">SR.</th>
            <th className="text-left px-2 py-1 text-[10px]">PERIOD / DESCRIPTION</th>
            <th className="text-right px-2 py-1 text-[10px] w-24">AMOUNT (₹)</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i} className="border-t" style={{ borderColor: 'var(--line)' }}>
              <td className="text-center py-0.5">{i + 1}</td>
              <td className="px-2 py-0.5">{l.fee_head_name}{l.installment ? <span className="text-slate-500"> · {l.installment}</span> : null}</td>
              <td className="text-right px-2 py-0.5 font-mono">{inrPrint(l.amount)}</td>
            </tr>
          ))}
          <tr className="border-t-2 font-bold" style={{ background: '#f8fafc', borderColor: 'var(--brand)' }}>
            <td colSpan={2} className="text-right px-2 py-1">TOTAL</td>
            <td className="text-right px-2 py-1 font-mono text-[13px]">₹ {inrPrint(total)}</td>
          </tr>
        </tbody>
      </table>

      <div className="grid grid-cols-3 gap-3 mt-2 border" style={{ borderColor: 'var(--line)' }}>
        <div className="col-span-2 p-2 border-r" style={{ borderColor: 'var(--line)' }}>
          <div className="uppercase tracking-widest text-slate-500 font-semibold text-[8.5px]">Amount in Words</div>
          <div className="font-semibold text-[11px]">{r.amount_in_words}</div>
        </div>
        <div className="p-2 text-right">
          <div className="uppercase tracking-widest text-slate-500 font-semibold text-[8.5px]">Amount Received</div>
          <div className="font-black text-[19px]" style={{ color: 'var(--accent)' }}>₹ {inrPrint(total)}</div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, mono = false, big = false }) {
  return (
    <div className={`p-2 border-b ${big ? 'col-span-2' : ''}`} style={{ borderColor: 'var(--line)' }}>
      <div className="uppercase tracking-widest text-slate-500 font-semibold text-[8.5px]">{label}</div>
      <div className={`mt-0.5 ${mono ? 'font-mono' : ''} ${big ? 'font-bold text-[13px]' : ''}`}>{V(value)}</div>
    </div>
  );
}
