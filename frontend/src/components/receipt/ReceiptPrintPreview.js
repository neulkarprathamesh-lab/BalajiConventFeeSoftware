import React from 'react';
import ReceiptEngine from './ReceiptEngine';

/**
 * ReceiptPrintPreview — Option E, Phase 10.
 *
 * The cashier-facing "PRINT RECEIPT" entry point: FeeHub's OWN preview,
 * never the Windows print dialog. Deliberately a thin wrapper around
 * ReceiptEngine (same render pipeline as every other receipt view) with
 * minimalPrint=true, so there is exactly one receipt layout in the codebase
 * — this component does not re-implement any layout, it only changes which
 * toolbar shows (Print/Cancel only, via ReceiptEngine's MinimalPrintCancelBar)
 * and wraps it in a modal.
 *
 * NOT YET WIRED IN: no existing page renders this yet. It is safe, additive,
 * inert code — activating it means changing NewReceipt.js/ReceiptView.js's
 * "Print Receipt" action to open this instead of navigating straight to the
 * full ReceiptEngine toolbar. That switch is a separate, deliberate step,
 * not taken yet per the "prepare but do not activate" instruction.
 *
 * This component does not create a receipt, does not consume a receipt
 * number, and does not create a payment — it only previews and prints a
 * receipt object that already exists.
 *
 * Props:
 *   r, receiptType, balance, settings — passed straight through to ReceiptEngine,
 *     same shape as every other ReceiptEngine call site (see ReceiptView.js).
 *   onClose — closes the preview (Cancel button, or the backdrop/X).
 *   onPrinted — optional callback invoked only after a successful print
 *     (res.ok === true) — the caller uses this to record the print event
 *     per the existing audit rules. Never called on failure.
 */
export default function ReceiptPrintPreview({ r, receiptType, balance = null, settings = null, onClose, onPrinted }) {
  if (!r) return null;

  const handlePrint = async () => {
    // MinimalPrintCancelBar already calls printReceiptDirect and shows the
    // error inline on failure; onPrint here only fires as a pre-print hook
    // (matches every other ReceiptEngine call site's onPrint contract). The
    // actual success/failure signal comes back through printReceiptDirect's
    // return value inside ReceiptEngine — onPrinted is wired at activation
    // time once the real IPC exists, so audit recording only happens on a
    // real, confirmed success.
    if (onPrinted) await onPrinted();
  };

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
        <ReceiptEngine
          r={r}
          receiptType={receiptType}
          balance={balance}
          settings={settings}
          showControls={false}
          minimalPrint
          onPrint={handlePrint}
          onCancel={onClose}
        />
      </div>
    </div>
  );
}
