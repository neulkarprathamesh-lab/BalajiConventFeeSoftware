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
// Uniform enlargement of the whole receipt as one unit, to use up some of the
// excess white space inside the existing padding — NOT a paper-size change.
// Applied via CSS transform on a wrapper around the content, so every field/
// table/border scales together exactly as authored; nothing is individually
// resized. Frame padding + overflow:hidden (unchanged) clip anything that
// would otherwise cross the physical 210x142.8mm edge, so this can never
// reintroduce the print-pagination bug.
const CONTENT_SCALE = 1.06; // +6%, within the requested 5-8% range

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
  // (op set), place the unchanged artwork near the TOP of the real page
  // instead of centering it — physical testing showed centered placement
  // left too much trailing blank paper below the receipt. This is pure
  // letterboxing, not a second layout: the receipt's own width/height/
  // margins/content are byte-for-byte the same as when op is not set —
  // only its position within the larger physical page changes.
  const printOffsetTopMm = op ? Math.min(1, Math.max(0, (op.h - p.h) / 2)) : 0;
  // -2mm: physical print alignment correction — the printed sheet consistently
  // shows the receipt content sitting slightly right of center on the sheet;
  // this nudges it left to compensate. Print-only (via .print-target's
  // `left`); does not affect on-screen preview, size, scale, or layout.
  const printOffsetLeftMm = (op ? Math.max(0, (op.w - p.w) / 2) : 0) - 2;
  const pageSizeToken = op ? op.print : p.print;

  return (
    <>
      {/* @page rule: match the physical paper size so browser Print output is 1:1 */}
      <style>{`
        @media print {
          @page { size: ${pageSizeToken}; margin: 0; }
          /* Hard-cap html/body to exactly the physical page height. Without this,
             the rest of the app (hidden via visibility:hidden below, which does NOT
             remove it from layout) keeps its normal flow height, so the real
             document is taller than one page and Chromium prints a second,
             all-blank page to cover it — even though nothing on it is visible. */
          html, body { background: #fff !important; height: ${(op ? op.h : p.h)}mm !important; overflow: hidden !important; }
          body * { visibility: hidden; }
          .print-target, .print-target * { visibility: visible; }
          .print-target { position: absolute; left: ${printOffsetLeftMm}mm; top: ${printOffsetTopMm}mm; width: ${p.w}mm; height: ${p.h}mm; overflow: hidden; padding: ${marginsMm.top}mm ${marginsMm.right}mm ${marginsMm.bottom}mm ${marginsMm.left}mm; box-shadow: none !important; border: 0 !important; }
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
        <div style={{ transform: `scale(${CONTENT_SCALE})`, transformOrigin: 'center center' }}>
          {children}
        </div>
      </div>
    </>
  );
}
