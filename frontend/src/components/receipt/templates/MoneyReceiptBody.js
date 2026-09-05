import React from 'react';
import { V, inrPrint } from '../ReceiptPrimitives';

/**
 * MoneyReceiptBody — covers refund, general_money, general_collection.
 * A generic "cash in / cash out" receipt with payer + purpose + amount.
 */
export default function MoneyReceiptBody({ r, compact = false }) {
  const meta = r.metadata || {};
  const total = Number(r.total || 0);
  const fs = compact ? 'text-[10px]' : 'text-[11px]';
  const isRefund = r.receipt_type === 'refund';

  return (
    <div className={`${fs} relative mt-2`}>
      <div className="grid grid-cols-2 gap-3 border" style={{ borderColor: 'var(--line)' }}>
        <Field label={isRefund ? 'Refund To' : 'Received From'} value={r.payer_name} big />
        <Field label="Department" value={r.department_name} />
        <div className="col-span-2 p-2 border-t" style={{ borderColor: 'var(--line)' }}>
          <div className="uppercase tracking-widest text-slate-500 font-semibold text-[8.5px]">Purpose</div>
          <div className="mt-0.5">{V(r.purpose)}</div>
        </div>
        <Field label="Payment Mode" value={String(r.payment_mode || '').toUpperCase()} />
        <Field label="Reference" value={r.payment_reference} mono />
      </div>

      <div className="grid grid-cols-3 gap-3 mt-2 border" style={{ borderColor: 'var(--line)' }}>
        <div className="col-span-2 p-2 border-r" style={{ borderColor: 'var(--line)' }}>
          <div className="uppercase tracking-widest text-slate-500 font-semibold text-[8.5px]">Amount in Words</div>
          <div className={`font-semibold ${compact ? 'text-[10px]' : 'text-[11px]'}`}>{r.amount_in_words}</div>
        </div>
        <div className="p-2 text-right">
          <div className="uppercase tracking-widest text-slate-500 font-semibold text-[8.5px]">{isRefund ? 'Amount Refunded' : 'Amount Received'}</div>
          <div className={`font-black ${compact ? 'text-[16px]' : 'text-[19px]'}`} style={{ color: 'var(--accent)' }}>₹ {inrPrint(total)}</div>
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
