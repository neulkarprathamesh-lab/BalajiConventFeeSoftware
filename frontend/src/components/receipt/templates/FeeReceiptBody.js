import React from 'react';
import { V, inrPrint } from '../ReceiptPrimitives';

// Label : value row. A fixed row height + explicit line-heights keep the label,
// colon and value on one true baseline, with the value's text lifted clear of
// the underline. Compact mode is tuned for the 210×142.8mm landscape receipt.
const Row = ({ label, value, mono = false, compact = false, labelW }) => {
  const rowH = compact ? 15 : 20;
  const labelSize = compact ? 7.5 : 8.5;
  const valueSize = compact ? 8.5 : 10;
  return (
    <div className="flex whitespace-nowrap" style={{ height: rowH }}>
      <div className="uppercase tracking-tight text-black font-bold shrink-0" style={{ width: labelW ?? (compact ? 78 : 92), fontSize: labelSize, lineHeight: `${rowH}px` }}>{label}</div>
      <div className="text-slate-600 shrink-0 px-1" style={{ lineHeight: `${rowH}px`, fontSize: labelSize }}>:</div>
      <div className={`flex-1 border-b border-slate-400 whitespace-normal overflow-hidden ${mono ? 'font-mono' : ''}`} style={{ fontSize: valueSize, lineHeight: `${valueSize + 3}px`, paddingBottom: rowH - (valueSize + 3) - 1 }}>{V(value)}</div>
    </div>
  );
};

/**
 * FeeReceiptBody — the "middle" of a school/admission/misc/refund receipt.
 *
 * Matches the approved reference artwork exactly:
 *   • DETAILS box, TWO columns (left: identity, right: parents/medium/dept/pattern)
 *   • Fee table (SR.NO / FEE HEAD / TOTAL / PAID / BALANCE + TOTAL row) on the LEFT
 *   • Payment panel (Amount in Words / Payment Mode / Transaction ID /
 *     Amount Received) BESIDE it on the RIGHT — this side-by-side arrangement
 *     is both the correct design and what keeps the whole receipt inside the
 *     142.8mm height (the old stacked payment panel overflowed).
 *
 * The universal engine surrounds this with header + footer.
 */
export default function FeeReceiptBody({ r, compact = false }) {
  const meta = r.metadata || {};
  const snapshot = r.student_snapshot || {};
  const lines = r.lines || [];
  const total = Number(r.total || 0);

  const totalOf = (k) => lines.reduce((s, l) => s + (l[k] != null ? Number(l[k]) : 0), 0);
  const anyTotalKnown = lines.some(l => l.total_amount != null);
  const sumTotal = anyTotalKnown ? totalOf('total_amount') : null;
  const sumPaid = totalOf('paid_amount') || total;
  const sumBalance = lines.some(l => l.balance_amount != null) ? totalOf('balance_amount') : null;

  const thBase = `border align-middle font-bold leading-tight ${compact ? 'text-[7.5px] py-[3px]' : 'text-[10px] py-2'}`;
  const tdBase = `border align-middle leading-tight ${compact ? 'py-[2px]' : 'py-1.5'}`;

  const panelLabel = `uppercase tracking-wide text-black font-bold ${compact ? 'text-[7.5px]' : 'text-[9px]'}`;

  return (
    <div className={`${compact ? 'text-[10px]' : 'text-[11px]'} relative mt-1`}>
      {/* DETAILS — two columns, matching the reference artwork */}
      <div className="border-2" style={{ borderColor: '#111' }}>
        <div className={`text-center font-bold uppercase border-b-2 ${compact ? 'text-[9px] py-[1px]' : 'text-[11px] py-1.5'}`} style={{ borderColor: '#111' }}>Details</div>
        <div className={`grid grid-cols-2 gap-x-8 px-3 ${compact ? 'py-1' : 'py-1'}`}>
          <div>
            <Row compact={compact} label="Student Name"  value={snapshot.name || r.payer_name} />
            <Row compact={compact} label="Admission No."  value={snapshot.admission_no} mono />
            <Row compact={compact} label="Class / Div."   value={`${meta.class_name || snapshot.class_name || '—'}${snapshot.section ? ' / ' + snapshot.section : ''}`} />
            <Row compact={compact} label="Roll No."       value={meta.roll_no || snapshot.roll_no} mono />
          </div>
          <div>
            <Row compact={compact} label="Father Name"    value={meta.father_name || snapshot.father_name} />
            <Row compact={compact} label="Mother Name"    value={meta.mother_name || snapshot.mother_name} />
            <Row compact={compact} label="Contact No."    value={meta.guardian_mobile || snapshot.guardian_mobile} mono />
            <Row compact={compact} label="Medium"         value={snapshot.medium} />
            <Row compact={compact} label="Department"     value={r.department_name} />
            <Row compact={compact} label="Pattern"        value="State Pattern" />
          </div>
        </div>
      </div>

      {/* FEE TABLE (left) + PAYMENT PANEL (right), side by side */}
      <div className="flex gap-1 mt-1 items-stretch">
        <div className="flex flex-col" style={{ flex: '1 1 66%' }}>
          <table className="w-full border-2 border-collapse h-full" style={{ borderColor: '#111' }}>
            <colgroup>
              <col style={{ width: '10%' }} />
              <col />
              <col style={{ width: '20%' }} />
              <col style={{ width: '20%' }} />
              <col style={{ width: '20%' }} />
            </colgroup>
            <thead>
              <tr className="bg-slate-100">
                <th className={`text-center ${thBase}`} style={{ borderColor: '#111' }}>SR.<br/>NO.</th>
                <th className={`text-left px-2 ${thBase}`} style={{ borderColor: '#111' }}>FEE HEAD</th>
                <th className={`text-center px-1 ${thBase}`} style={{ borderColor: '#111' }}>TOTAL<br/>(₹)</th>
                <th className={`text-center px-1 ${thBase}`} style={{ borderColor: '#111' }}>PAID<br/>(₹)</th>
                <th className={`text-center px-1 ${thBase}`} style={{ borderColor: '#111' }}>BALANCE<br/>(₹)</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td className={`text-center ${tdBase}`} style={{ borderColor: '#ccc' }}>{i + 1}</td>
                  <td className={`px-2 ${tdBase}`} style={{ borderColor: '#ccc' }}>
                    <div className="uppercase font-medium leading-snug">{l.fee_head_name}</div>
                    {l.note && <div className={`italic ${compact ? 'text-[7.5px]' : 'text-[9px]'} text-slate-500 leading-snug`}>{l.note}</div>}
                  </td>
                  <td className={`text-right px-2 font-mono ${tdBase}`} style={{ borderColor: '#ccc' }}>{l.total_amount != null ? inrPrint(l.total_amount) : '—'}</td>
                  <td className={`text-right px-2 font-mono ${tdBase}`} style={{ borderColor: '#ccc' }}>{l.paid_amount != null ? inrPrint(l.paid_amount) : inrPrint(l.amount)}</td>
                  <td className={`text-right px-2 font-mono ${tdBase}`} style={{ borderColor: '#ccc' }}>{l.balance_amount != null ? inrPrint(l.balance_amount) : '—'}</td>
                </tr>
              ))}
              <tr className="font-bold" style={{ background: '#f8fafc' }}>
                <td colSpan={2} className={`text-right px-2 ${tdBase}`} style={{ borderColor: '#111' }}>TOTAL</td>
                <td className={`text-right px-2 font-mono ${tdBase}`} style={{ borderColor: '#111' }}>{sumTotal != null ? inrPrint(sumTotal) : '—'}</td>
                <td className={`text-right px-2 font-mono ${tdBase}`} style={{ borderColor: '#111' }}>{inrPrint(sumPaid)}</td>
                <td className={`text-right px-2 font-mono ${tdBase} ${compact ? 'text-[10px]' : 'text-[13px]'}`} style={{ borderColor: '#111' }}>{sumBalance != null ? inrPrint(sumBalance) : '—'}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* PAYMENT PANEL */}
        <div className="border-2 flex flex-col" style={{ borderColor: '#111', flex: '1 1 34%' }}>
          <div className={`border-b px-2.5 ${compact ? 'py-[3px]' : 'py-2'}`} style={{ borderColor: '#111' }}>
            <div className={panelLabel}>Amount in Words</div>
            <div className={`font-semibold leading-snug mt-0.5 ${compact ? 'text-[9px]' : 'text-[10.5px]'}`}>{V(r.amount_in_words)}</div>
          </div>
          <div className={`border-b px-2.5 ${compact ? 'py-[3px]' : 'py-2'}`} style={{ borderColor: '#111' }}>
            <div className={panelLabel}>Payment Mode</div>
            <div className={`font-semibold uppercase mt-0.5 ${compact ? 'text-[9px]' : 'text-[11px]'}`}>{V(r.payment_mode)}</div>
          </div>
          <div className={`border-b px-2.5 ${compact ? 'py-[3px]' : 'py-2'}`} style={{ borderColor: '#111' }}>
            <div className={panelLabel}>Transaction ID</div>
            <div className={`font-mono mt-0.5 ${compact ? 'text-[8.5px]' : 'text-[10.5px]'}`}>{V(r.payment_reference)}</div>
          </div>
          <div className={`bg-slate-100 text-center flex flex-col items-center justify-center flex-1 px-2 ${compact ? 'py-1' : 'py-2'}`}>
            <div className={panelLabel}>Amount Received</div>
            <div className={`font-black mt-0.5 ${compact ? 'text-[15px]' : 'text-[18px]'}`}>₹ {inrPrint(total)}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
