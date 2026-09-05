import React from 'react';
import { V, inrPrint } from '../ReceiptPrimitives';

/**
 * DebitVoucherBody — computer-generated redesign of the legacy paper voucher.
 * Same universal engine (frame + header + footer). Only the middle is unique.
 * Tuned for the 210 x 142.8mm landscape receipt size — fixed row heights with
 * explicit line-heights so text never touches a border (same technique used
 * in FeeReceiptBody, verified not to collide at this exact page height).
 */
export default function DebitVoucherBody({ r, compact = false }) {
  const meta = r.metadata || {};
  const total = Number(r.total || 0);
  const fs = compact ? 'text-[10px]' : 'text-[11px]';
  const lines = r.lines || [];
  const thBase = `border align-middle font-bold leading-tight ${compact ? 'text-[7.5px] py-1' : 'text-[10px] py-2'}`;
  const tdBase = `border align-middle leading-tight ${compact ? 'py-1' : 'py-1.5'}`;

  return (
    <div className={`${fs} relative mt-1`}>
      {/* Paid To / Voucher details — 3 columns to keep the box short */}
      <div className="border-2" style={{ borderColor: '#111' }}>
        <div className="grid grid-cols-3 gap-x-4 px-2.5 py-1.5">
          <Field compact={compact} label="Paid To / Vendor" value={r.payer_name} big />
          <Field compact={compact} label="Department" value={r.department_name} />
          <Field compact={compact} label="Voucher No." value={r.number} mono />
          <Field compact={compact} label="Voucher Date" value={new Date(r.created_at).toLocaleDateString('en-IN')} mono />
          <Field compact={compact} label="Payment Mode" value={String(r.payment_mode || '').toUpperCase()} />
          {r.payment_reference && (
            <>
              <Field compact={compact} label="Cheque / DD / Ref." value={r.payment_reference} mono />
              <Field compact={compact} label="Bank / UPI" value={meta.bank_name || meta.upi_ref} mono />
            </>
          )}
        </div>
        <div className="px-2.5 pb-1.5 border-t" style={{ borderColor: '#111' }}>
          <div className={`uppercase tracking-wide text-black font-bold pt-1 ${compact ? 'text-[7px]' : 'text-[9px]'}`}>Purpose / Particulars</div>
          <div className={`leading-snug ${compact ? 'text-[9px]' : 'text-[11px]'}`}>{V(r.purpose || meta.particulars)}</div>
        </div>
      </div>

      {/* Line items */}
      <table className="w-full mt-1 border-2 border-collapse" style={{ borderColor: '#111' }}>
        <thead>
          <tr className="bg-slate-100">
            <th className={`text-center ${thBase}`} style={{ borderColor: '#111', width: compact ? '8%' : '7%' }}>SR.</th>
            <th className={`text-left px-2 ${thBase}`} style={{ borderColor: '#111' }}>DESCRIPTION</th>
            <th className={`text-right px-2 ${thBase}`} style={{ borderColor: '#111', width: compact ? '22%' : '20%' }}>AMOUNT (₹)</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <td className={`text-center ${tdBase}`} style={{ borderColor: '#ccc' }}>{i + 1}</td>
              <td className={`px-2 ${tdBase}`} style={{ borderColor: '#ccc' }}>{l.fee_head_name}{l.note ? <span className="text-slate-500 italic"> — {l.note}</span> : null}</td>
              <td className={`text-right px-2 font-mono ${tdBase}`} style={{ borderColor: '#ccc' }}>{inrPrint(l.amount)}</td>
            </tr>
          ))}
          <tr className="font-bold" style={{ background: '#f8fafc' }}>
            <td colSpan={2} className={`text-right px-2 ${tdBase}`} style={{ borderColor: '#111' }}>TOTAL PAID</td>
            <td className={`text-right px-2 font-mono ${tdBase} ${compact ? 'text-[11px]' : 'text-[13px]'}`} style={{ borderColor: '#111' }}>₹ {inrPrint(total)}</td>
          </tr>
        </tbody>
      </table>

      <div className="grid grid-cols-3 mt-1 border-2" style={{ borderColor: '#111' }}>
        <div className={`col-span-2 border-r px-2.5 ${compact ? 'py-1' : 'py-2'}`} style={{ borderColor: '#111' }}>
          <div className={`uppercase tracking-wide text-black font-bold ${compact ? 'text-[7px]' : 'text-[9px]'}`}>Amount in Words</div>
          <div className={`font-semibold leading-snug ${compact ? 'text-[9px]' : 'text-[11px]'}`}>{r.amount_in_words}</div>
        </div>
        <div className={`text-center bg-slate-100 ${compact ? 'py-1' : 'py-2'}`}>
          <div className={`uppercase tracking-wide text-black font-bold ${compact ? 'text-[7px]' : 'text-[9px]'}`}>Total Payment</div>
          <div className={`font-black ${compact ? 'text-[15px]' : 'text-[18px]'}`}>₹ {inrPrint(total)}</div>
        </div>
      </div>

      <div className={`mt-1 flex justify-between ${compact ? 'text-[8px]' : 'text-[10px]'} text-slate-600`}>
        <span>Created by: <b>{r.cashier_name}</b></span>
        {r.status === 'approved' && r.approved_by_name && <span>Approved by: <b>{r.approved_by_name}</b></span>}
      </div>
    </div>
  );
}

function Field({ label, value, mono = false, big = false, compact = false }) {
  const h = compact ? 17 : 20;
  return (
    <div className={big ? 'col-span-2' : ''} style={{ height: h }}>
      <div className={`uppercase tracking-tight text-black font-bold ${compact ? 'text-[6.5px] leading-[9px]' : 'text-[8.5px] leading-[11px]'}`}>{label}</div>
      <div className={`leading-tight ${mono ? 'font-mono' : ''} ${big ? 'font-bold' : ''} ${compact ? 'text-[9px]' : (big ? 'text-[12px]' : 'text-[10.5px]')}`}>{V(value)}</div>
    </div>
  );
}
