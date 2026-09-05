import React from 'react';
import { PAPER_SIZES, MM_PX, DEFAULT_PAPER } from './PaperSizes';

/**
 * ReceiptFrame — the single canvas every printable document renders inside.
 *
 * • Locks the on-screen box to the correct paper size in millimetres.
 * • Injects the @page rule that matches the same paper for print.
 * • Applies the classic-b/w or balaji-color theme via `data-theme`.
 * • Supports margins configured on the receipt-type record.
 *
 * Props:
 *   paper       — PAPER_SIZES key, default A5. This is the receipt's own
 *                 authoritative artwork geometry (e.g. 210x142.8mm for
 *                 RECEIPT_142) — its content/margins are UNCHANGED regardless
 *                 of outerPaper below. There is still only one receipt layout.
 *   outerPaper  — optional PAPER_SIZES key for the PHYSICAL media the printer
 *                 actually holds, when it differs from `paper` (e.g. the
 *                 printer only has native A5 210x148mm stock, but the
 *                 approved receipt artwork is 210x142.8mm). When set, this
 *                 is the ONLY thing that changes: the printed page size
 *                 becomes outerPaper's, and the unchanged receipt artwork is
 *                 letterboxed (centered) inside it — never stretched,
 *                 shrunk, or re-laid-out. Omit to keep today's behavior
 *                 exactly (receipt IS the physical page, as for every other
 *                 existing paper key).
 *   theme       — 'bw' | 'color'
 *   marginsMm   — { top, right, bottom, left }  (default 8mm all round) — applies to the receipt artwork itself, not outerPaper.
 *   scale       — on-screen preview scale (0.5..1.5). Default: auto-fit to viewport width.
 *   children    — the receipt body
 */
export default function ReceiptFrame({
  paper = DEFAULT_PAPER,
  outerPaper = null,
  theme = 'bw',
  marginsMm = { top: 8, right: 8, bottom: 8, left: 8 },
  scale = 1,
  children,
  innerRef,
  className = '',
  testid = 'receipt-frame',
}) {
  const p = PAPER_SIZES[paper] || PAPER_SIZES[DEFAULT_PAPER];
  const op = outerPaper ? (PAPER_SIZES[outerPaper] || null) : null;
  const widthPx  = p.w * MM_PX;
  const heightPx = p.h * MM_PX;

  const style = {
    width: `${widthPx * scale}px`,
    minHeight: `${heightPx * scale}px`,
    padding: `${marginsMm.top}mm ${marginsMm.right}mm ${marginsMm.bottom}mm ${marginsMm.left}mm`,
    transformOrigin: 'top left',
  };

  // When printing on physical media larger than the receipt artwork itself
  // (op set), center the unchanged artwork inside the real page — this is
  // pure letterboxing, not a second layout: the receipt's own width/height/
  // margins/content are byte-for-byte the same as when op is not set.
  const printOffsetTopMm = op ? Math.max(0, (op.h - p.h) / 2) : 0;
  const printOffsetLeftMm = op ? Math.max(0, (op.w - p.w) / 2) : 0;
  const pageSizeToken = op ? op.print : p.print;

  return (
    <>
      {/* @page rule: match the physical paper size so browser Print output is 1:1 */}
      <style>{`
        @media print {
          @page { size: ${pageSizeToken}; margin: 0; }
          html, body { background: #fff !important; }
          body * { visibility: hidden; }
          .print-target, .print-target * { visibility: visible; }
          .print-target { position: absolute; left: ${printOffsetLeftMm}mm; top: ${printOffsetTopMm}mm; width: ${p.w}mm; min-height: ${p.h}mm; padding: ${marginsMm.top}mm ${marginsMm.right}mm ${marginsMm.bottom}mm ${marginsMm.left}mm; box-shadow: none !important; border: 0 !important; }
          .no-print { display: none !important; }
        }
        .receipt-frame[data-theme="bw"]      { --brand: #0f172a; --brand-ink: #ffffff; --accent: #0f172a; --line: #cbd5e1; --muted: #64748b; }
        .receipt-frame[data-theme="color"]   { --brand: #FFC107; --brand-ink: #1a237e; --accent: #C62828; --line: #f1c40f; --muted: #7f6a00; }
        .receipt-frame { background: #fff; color: #0f172a; box-sizing: border-box; position: relative; overflow: hidden; }
      `}</style>
      <div
        ref={innerRef}
        data-theme={theme}
        data-testid={testid}
        className={`receipt-frame print-target shadow-xl border border-slate-300 ${className}`}
        style={style}
      >
        {children}
      </div>
    </>
  );
}
