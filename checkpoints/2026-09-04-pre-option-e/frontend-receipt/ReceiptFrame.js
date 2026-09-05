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
 *   paper       — PAPER_SIZES key, default A5
 *   theme       — 'bw' | 'color'
 *   marginsMm   — { top, right, bottom, left }  (default 8mm all round)
 *   scale       — on-screen preview scale (0.5..1.5). Default: auto-fit to viewport width.
 *   children    — the receipt body
 */
export default function ReceiptFrame({
  paper = DEFAULT_PAPER,
  theme = 'bw',
  marginsMm = { top: 8, right: 8, bottom: 8, left: 8 },
  scale = 1,
  children,
  innerRef,
  className = '',
  testid = 'receipt-frame',
}) {
  const p = PAPER_SIZES[paper] || PAPER_SIZES[DEFAULT_PAPER];
  const widthPx  = p.w * MM_PX;
  const heightPx = p.h * MM_PX;

  const style = {
    width: `${widthPx * scale}px`,
    minHeight: `${heightPx * scale}px`,
    padding: `${marginsMm.top}mm ${marginsMm.right}mm ${marginsMm.bottom}mm ${marginsMm.left}mm`,
    transformOrigin: 'top left',
  };

  return (
    <>
      {/* @page rule: match the physical paper size so browser Print output is 1:1 */}
      <style>{`
        @media print {
          @page { size: ${p.print}; margin: 0; }
          html, body { background: #fff !important; }
          body * { visibility: hidden; }
          .print-target, .print-target * { visibility: visible; }
          .print-target { position: absolute; left: 0; top: 0; width: ${p.w}mm; min-height: ${p.h}mm; padding: ${marginsMm.top}mm ${marginsMm.right}mm ${marginsMm.bottom}mm ${marginsMm.left}mm; box-shadow: none !important; border: 0 !important; }
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
