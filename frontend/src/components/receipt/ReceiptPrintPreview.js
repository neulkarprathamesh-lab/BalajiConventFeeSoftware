import React from 'react';
import ReceiptEngine from './ReceiptEngine';

/**
 * ReceiptPrintPreview — the cashier-facing "PRINT RECEIPT" entry point.
 *
 * FeeHub's OWN preview (never the Windows print dialog), a thin wrapper around
 * ReceiptEngine (the SAME authoritative renderer as every other receipt view)
 * with minimalPrint=true. There is exactly one receipt layout in the codebase
 * — this component does not re-implement any layout, it only changes which
 * toolbar shows (Print/Cancel only) and wraps it in a modal.
 *
 * The receipt artwork is ALWAYS the approved 210×142.8mm landscape geometry
 * (paper 'RECEIPT_142'), letterboxed onto the physical media (A5 landscape by
 * default) — identical in preview and in the physical print because it is the
 * same DOM printed via webContents.print.
 *
 * This component does not create a receipt, does not consume a receipt number,
 * and does not create a payment — it only previews and prints a receipt object
 * that already exists. `onPrinted` fires ONLY after a confirmed successful
 * print (never on failure), for the caller's audit/reprint bookkeeping.
 */
export default function ReceiptPrintPreview({ r, receiptType, balance = null, settings = null, onClose, onPrinted }) {
  if (!r) return null;

  // The receipt paper is fixed to the approved artwork geometry regardless of
  // any legacy per-type paper_size, and letterboxed onto A5 landscape media.
  const forcedType = { ...(receiptType || {}), paper_size: 'RECEIPT_142' };

  return (
    <div
      className="fixed inset-0 bg-slate-900/70 z-50 flex items-center justify-center p-4"
      onClick={onClose}
      data-testid="receipt-print-preview-backdrop"
    >
      <div
        className="bg-white rounded-lg shadow-2xl max-w-[95vw] max-h-[95vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
        data-testid="receipt-print-preview"
      >
        <div className="px-4 pt-3 text-[13px] font-semibold text-slate-700 flex items-center justify-between">
          <span>FeeHub Print Preview — 210 × 142.8 mm landscape (A5 media)</span>
        </div>
        <ReceiptEngine
          r={r}
          receiptType={forcedType}
          balance={balance}
          settings={settings}
          showControls={false}
          minimalPrint
          outerPaper="A5_LANDSCAPE"
          onPrinted={onPrinted}
          onCancel={onClose}
        />
      </div>
    </div>
  );
}
