import React from 'react';
import { Bus as BusIconLucide } from 'lucide-react';

export const LOGO = '/school-logo.jpeg';

/** Small utility to safely render a value or an em-dash. */
export const V = (v) => (v == null || v === '' ? <span className="text-slate-400">—</span> : v);

/** INR formatter used across every printable. */
export const inrPrint = (n) => new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2 }).format(Number(n || 0));

/**
 * Header — one component for every receipt / voucher / notice.
 * Adjusts to A5 automatically: smaller logo, tighter typography.
 * `boxLabel` = "FEE RECEIPT" | "DEBIT VOUCHER" | "BUS RECEIPT" | …
 * `tagline` = "Shaping Tomorrow, Building Excellence" or custom
 */
export function ReceiptHeader({
  boxLabel = 'FEE RECEIPT',
  // headerLine1/headerLine2 come from the receipt's OWN department record
  // (department_header1/department_header2, captured at receipt-creation time)
  // so a Junior College receipt never shows Secondary-School text or vice versa.
  // The generic combined name is only a last-resort fallback for receipt types
  // (debit vouchers, general money receipts) that have no department header.
  headerLine1 = 'BALAJI CONVENT & JUNIOR COLLEGE',
  headerLine2 = '',
  addressLine = 'BUTIBORI, NAGPUR',
  // Fixed institution-wide descriptor lines — the same on every receipt type/department
  // in the reference images, so this is boilerplate, not per-department data.
  subLines = ['NURSERY TO CLASS 10 (ENGLISH TO SEMI MEDIUM)', 'JUNIOR COLLEGE (SCIENCE | COMMERCE | ARTS)', 'STATE PATTERN'],
  tagline = 'Shaping Tomorrow, Building Excellence',
  receiptNumber = '',
  dateStr = '',
  academicYear = '',
  qrValue = '',
  qrEnabled = true,
  showBarcode = false,
  compact = false,   // true for A5; slightly smaller logo & type
}) {
  const logoSize = compact ? 44 : 64;
  return (
    <div className="grid grid-cols-12 gap-2 items-start pb-1 border-b-2" style={{ borderColor: '#111' }}>
      <div className="col-span-6 flex items-start gap-2">
        <img src={LOGO} alt="Balaji Convent" style={{ width: logoSize, height: logoSize }} className="rounded-full object-cover shrink-0" />
        <div>
          <div className={`font-black tracking-tight uppercase text-black ${compact ? 'text-[11px] leading-[13px]' : 'text-[17px] leading-[20px]'}`}>{headerLine1}</div>
          {headerLine2 && <div className={`font-bold tracking-wide uppercase text-black ${compact ? 'text-[7.5px] leading-[10px]' : 'text-[10px] leading-[13px]'}`}>{headerLine2}</div>}
          <div className={`font-bold tracking-wide uppercase text-black ${compact ? 'text-[7.5px] leading-[10px]' : 'text-[10px] leading-[13px]'}`}>{addressLine}</div>
          <div className="mt-0.5">
            {subLines.map((s, i) => (
              <div key={i} className={`text-slate-700 ${compact ? 'text-[6px] leading-[8px]' : 'text-[8px] leading-[11px]'}`}>{s}</div>
            ))}
          </div>
        </div>
      </div>
      <div className="col-span-3 flex flex-col items-center justify-center px-2 border-x" style={{ borderColor: '#999' }}>
        <div className={`px-3 py-1 font-black tracking-wide bg-black text-white text-center mx-auto ${compact ? 'text-[10px]' : 'text-[13px]'}`} style={{ display: 'inline-block' }}>{boxLabel}</div>
        <div className={`italic font-serif text-slate-800 text-center ${compact ? 'text-[7px] leading-[9px]' : 'text-[9.5px] leading-snug'} mt-0.5`}>{tagline}</div>
      </div>
      <div className="col-span-3 flex justify-between gap-1.5">
        <div>
          <MiniField label="Receipt No." value={<span className="font-bold" style={{ color: '#C62828' }}>{receiptNumber}</span>} compact={compact} />
          <MiniField label="Date:" value={<span className="font-semibold">{dateStr}</span>} compact={compact} />
          {academicYear && <MiniField label="Academic Year:" value={<span className="font-semibold">{academicYear}</span>} compact={compact} />}
        </div>
        <div className="flex flex-col items-end shrink-0" />
      </div>
    </div>
  );
}

function MiniField({ label, value, compact, underline = false }) {
  return (
    <div className={`flex items-baseline gap-1 whitespace-nowrap ${compact ? 'mb-0' : 'mb-0.5'}`}>
      <span className={`uppercase tracking-wide text-black font-bold shrink-0 ${compact ? 'text-[7px]' : 'text-[8.5px]'}`}>{label}</span>
      <span className={`leading-snug ${compact ? 'text-[9.5px]' : 'text-[11px]'} ${underline ? 'border-b border-slate-400 min-w-[46px] inline-block' : ''}`}>{value}</span>
    </div>
  );
}

/** Realistic-looking vertical-bar barcode (visual only — not decoded by real scanners),
 * deterministically derived from the actual receipt number so it always represents this
 * receipt's real data, never a random/decorative pattern. */
export function Barcode({ text = '', compact = false }) {
  const bars = [];
  const s = (text || '').toUpperCase();
  let seed = 0;
  for (let i = 0; i < s.length; i++) seed = (seed * 31 + s.charCodeAt(i)) >>> 0;
  // Bar count/width kept small and bounded (worst case n*3px) so the barcode's
  // natural footprint always fits inside its narrow header column, measured
  // against the real column width (rightcol ~177px minus the Receipt No./
  // Date/Academic Year block's own ~126-132px) — n=16 gives a worst-case 48px
  // vs the ~45px actually left over, with the maxWidth+overflow below as a
  // safety net on top, not the primary fix.
  const n = compact ? 16 : 24;
  for (let i = 0; i < n; i++) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    const w = (seed % 2) + 1;
    bars.push(<div key={`${i}b`} style={{ width: `${w}px`, height: compact ? 20 : 26, background: '#000', display: 'inline-block', marginRight: '1px' }} />);
  }
  return (
    <div className="text-right" style={{ maxWidth: compact ? 50 : 68, overflow: 'hidden', marginRight: 2 }}>
      <div className="inline-flex">{bars}</div>
      <div className={`font-mono tracking-[0.05em] text-right truncate ${compact ? 'text-[6.5px]' : 'text-[7.5px]'}`}>{text}</div>
    </div>
  );
}

/** Signature blocks — configurable single-row / 2×2 layout + per-block visibility. */
export function SignatureBlock({
  layout = 'row',                                            // 'row' | 'grid'
  show = { receiver: true, accountant: true, principal: true, director: true },
  labels = { receiver: 'Receiver', accountant: 'Accountant', principal: 'Principal', director: 'Director' },
  compact = false,
}) {
  const items = [
    ['receiver', labels.receiver], ['accountant', labels.accountant],
    ['principal', labels.principal], ['director', labels.director],
  ].filter(([k]) => show[k] !== false);
  if (items.length === 0) return null;
  const cols = layout === 'grid' ? 'grid-cols-2' : `grid-cols-${items.length}`;
  const boxH = compact ? 'h-3' : 'h-10';
  return (
    <div className={`grid ${cols} ${compact ? 'gap-x-3 gap-y-1 mt-1 pt-1' : 'gap-3 mt-4 pt-2'} border-t border-dashed`} style={{ borderColor: 'var(--line)' }}>
      {items.map(([k, label]) => (
        <div key={k} className="text-center">
          <div className={boxH} />
          <div className={`border-t border-slate-500 mx-2 ${compact ? 'text-[7.5px]' : 'text-[10px]'} pt-px uppercase tracking-widest font-semibold`}>{label}</div>
        </div>
      ))}
    </div>
  );
}

/** Two-block "RECEIVED BY / AUTHORIZED BY" signature row, matching the reference receipts. */
export function ReceivedAuthorizedBlock({ compact = false }) {
  const boxH = compact ? 'h-4' : 'h-9';
  return (
    <div className="grid grid-cols-2 gap-8 mt-0">
      {['RECEIVED BY', 'AUTHORIZED BY'].map(label => (
        <div key={label} className="text-center">
          <div className={boxH} />
          <div className={`border-t border-slate-500 mx-2 ${compact ? 'text-[7.5px]' : 'text-[10px]'} pt-px uppercase tracking-widest font-semibold`}>{label}</div>
        </div>
      ))}
    </div>
  );
}

/** Standard procedural notices — bulleted, matches the reference receipts' NOTES box. */
export function NotesList({ notes = ['This is a computer-generated receipt.', 'No signature is required.', 'Please preserve this receipt for your records.'], compact = false }) {
  if (!notes || notes.length === 0) return null;
  return (
    <div className={`${compact ? 'text-[6.5px] leading-[9px]' : 'text-[9.5px]'} text-slate-700`}>
      <div className="font-bold uppercase tracking-wide text-black">Notes:</div>
      <ul className="list-none">
        {notes.map((n, i) => <li key={i}>• {n}</li>)}
      </ul>
    </div>
  );
}

/** School contact bar — ONLY renders fields actually configured in FeeHub Settings.
 * Never shows invented/placeholder contact info: an empty field is simply omitted. */
export function ContactFooterBar({ address, phone, email, website, compact = false }) {
  const items = [address, phone, email, website].filter(Boolean);
  if (items.length === 0) return null;
  return (
    <div className={`flex flex-wrap items-center justify-center gap-x-3 gap-y-0.5 mt-1 pt-1 border-t border-slate-300 text-slate-700 ${compact ? 'text-[6px]' : 'text-[8.5px]'}`}>
      {address && <span className="inline-flex items-center gap-1">📍 <span>{address}</span></span>}
      {phone && <span className="inline-flex items-center gap-1">📞 <span>{phone}</span></span>}
      {email && <span className="inline-flex items-center gap-1">✉ <span>{email}</span></span>}
      {website && <span className="inline-flex items-center gap-1">🌐 <span>{website}</span></span>}
    </div>
  );
}

/** Universal footer — NOTES, RECEIVED BY/AUTHORIZED BY signatures, remarks, contact bar. */
export function ReceiptFooter({
  remarks = '',
  cashierName = '',
  compact = false,
  showSignatures = true,
  notes,
  contact,
  signatureNode,
}) {
  return (
    <div className="mt-0.5 pt-0.5 border-t-2" style={{ borderColor: '#111' }}>
      {showSignatures && (signatureNode || <ReceivedAuthorizedBlock compact={compact} />)}
      {remarks && (
        <div className={`${compact ? 'text-[8px]' : 'text-[10.5px]'} mt-1 text-slate-700`}>
          <span className="font-semibold uppercase tracking-widest text-slate-500">Remarks:</span> {remarks}
        </div>
      )}
      {cashierName && (
        <div className={`text-center ${compact ? 'text-[6.5px]' : 'text-[8.5px]'} text-slate-400`}>Issued by {cashierName}</div>
      )}
      {contact && <ContactFooterBar {...contact} compact={compact} />}
    </div>
  );
}

/** Central "*** CANCELLED ***" / "DUPLICATE" indicators. */
export function StatusRibbons({ status, reprintCount }) {
  return (
    <>
      {status === 'cancelled' && <div className="text-center text-red-600 font-bold text-sm my-1">*** CANCELLED ***</div>}
      {reprintCount > 0 && <div className="text-center text-amber-700 font-semibold text-[10px] my-1">DUPLICATE · Reprint #{reprintCount}</div>}
    </>
  );
}

/**
 * Watermark — the real school logo, faint, behind the content on every
 * receipt type except Bus, which shows a bus icon instead (variant="bus").
 * Opacity raised from an earlier 0.05 — physical printing on the monochrome
 * P1007 showed that a 5%-opacity image falls below the printer's minimum
 * halftone dot threshold and simply doesn't appear on paper at all, even
 * though it renders fine on screen. Raised again from 0.14 to 0.165 (~+18%)
 * for slightly better visibility — still a subtle background watermark, not
 * bold, and stays well clear of text readability.
 */
export function Watermark({ enabled = false, opacity = 0.165, variant = 'logo' }) {
  if (!enabled) return null;
  // Constrained to the TOP ~65% of the receipt's own height (not the full
  // frame) — a hard boundary, not just a smaller image — so the watermark's
  // bottom edge always clears the Balance Remaining section further down,
  // regardless of exact content heights. Still horizontally centered across
  // the full width, so it still reads as centered behind the page.
  return (
    <div aria-hidden className="absolute inset-x-0 top-0 pointer-events-none flex items-center justify-center" style={{ zIndex: 0, height: '65%' }}>
      {variant === 'bus' ? (
        <BusIconLucide style={{ width: '26%', height: 'auto', maxHeight: '100%', opacity, color: '#000' }} strokeWidth={1.25} />
      ) : (
        <img src={LOGO} alt="" style={{ width: '32%', maxHeight: '100%', objectFit: 'contain', opacity, userSelect: 'none' }} />
      )}
    </div>
  );
}

/**
 * BalanceRemaining — the student's REAL running outstanding balance after this
 * payment, read live from the same ledger the Student Profile page uses
 * (Total Fee − Total Paid − Approved Adjustments, current academic year only).
 * Only shown for student-linked receipts; never shown for vouchers/money
 * receipts that have no student attached, and never computed from just this
 * one transaction — always the authoritative post-payment ledger figure.
 */
export function BalanceRemaining({ amount, loading = false, staleYear = false, compact = false }) {
  if (amount == null && !loading) return null;
  return (
    <div className={`mt-1 border-2 flex items-center justify-between px-3 ${compact ? 'py-0.5' : 'py-1.5'}`} style={{ borderColor: 'var(--brand)' }}>
      <div className={`uppercase tracking-widest font-bold ${compact ? 'text-[8px]' : 'text-[10px]'} text-slate-700`}>
        Balance Remaining{staleYear ? ' (current AY)' : ''}
      </div>
      <div className={`font-black font-mono ${compact ? 'text-[11px]' : 'text-[15px]'}`} style={{ color: '#000000' }}>
        {loading ? '…' : `₹ ${inrPrint(amount)}`}
      </div>
    </div>
  );
}
