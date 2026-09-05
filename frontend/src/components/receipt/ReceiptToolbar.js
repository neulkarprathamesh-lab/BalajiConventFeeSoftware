import React, { useState } from 'react';
import { Printer, FileDown, Image as ImageIcon, FileImage, Code2, Mail, Copy, Loader2, ChevronDown } from 'lucide-react';
import { exportPdf, exportPng, exportJpeg, exportSvg, exportEmailPdf, doPrint } from './receiptExporter';
import { toast } from 'sonner';

/**
 * ReceiptToolbar — the one bar that all printable documents share.
 *
 *   nodeRef       — ref to the DOM element that should be captured for export
 *   filename      — base filename for downloads (no extension)
 *   paper         — current PAPER_SIZES key ("A5" default)
 *   onPrint       — optional side-effect before print (e.g. increment reprint count)
 *   twoUp / onTwoUp — parent/office duplicate print toggle
 *   extraActions  — receipt-specific buttons (Cancel, etc.)
 */
export default function ReceiptToolbar({
  nodeRef, filename, paper = 'A5',
  onPrint, twoUp = false, onTwoUp,
  extraActions = null, publicMode = false,
  onPrintPreview = null,
  printOnly = false,
}) {
  const [busy, setBusy] = useState(null);
  const [showMore, setShowMore] = useState(false);

  const wrap = async (kind, fn) => {
    setBusy(kind);
    try { await fn(); toast.success(`Exported as ${kind.toUpperCase()}`); }
    catch (e) { toast.error(`${kind.toUpperCase()} export failed — ${e?.message || 'unknown error'}`); }
    finally { setBusy(null); setShowMore(false); }
  };

  // One print system: when a preview handler is supplied (the cashier receipt
  // workflow), Print opens FeeHub's own Print Preview modal → direct print.
  // The legacy window.print()/doPrint path is only used where no preview
  // handler is wired (non-receipt documents that still rely on it).
  const runPrint = async () => {
    if (onPrintPreview) { onPrintPreview(); return; }
    if (onPrint) await onPrint();
    setTimeout(() => doPrint(paper), 120);
  };

  const btn = "h-9 px-3 border border-slate-300 rounded text-[13px] inline-flex items-center gap-1.5 hover:bg-white disabled:opacity-50";
  const primary = "h-9 px-3 bg-blue-600 hover:bg-blue-700 text-white rounded text-[13px] inline-flex items-center gap-1.5 disabled:opacity-50";

  return (
    <div className="flex items-center gap-2 flex-wrap no-print" data-testid="receipt-toolbar">
      {extraActions}
      {printOnly ? (
        <button onClick={runPrint} className={primary} data-testid="rv-print">
          <Printer className="w-4 h-4" /> Print
        </button>
      ) : (
      <>
      {onTwoUp && (
        <button onClick={onTwoUp} className={btn} data-testid="rv-two-up">
          <Copy className="w-4 h-4" /> {twoUp ? 'Single Copy' : 'Two-Up'}
        </button>
      )}
      <button onClick={runPrint} className={primary} data-testid="rv-print">
        <Printer className="w-4 h-4" /> Print
      </button>
      <button
        onClick={() => wrap('pdf', () => exportPdf(nodeRef.current, filename, paper))}
        disabled={busy !== null}
        className={btn}
        data-testid="rv-pdf"
      >
        {busy === 'pdf' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />} PDF
      </button>
      <button
        onClick={() => wrap('png', () => exportPng(nodeRef.current, filename))}
        disabled={busy !== null}
        className={btn}
        data-testid="rv-png"
      >
        {busy === 'png' ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImageIcon className="w-4 h-4" />} PNG
      </button>
      <div className="relative">
        <button onClick={() => setShowMore(v => !v)} className={btn} data-testid="rv-more">
          More <ChevronDown className="w-3 h-3" />
        </button>
        {showMore && (
          <div className="absolute right-0 mt-1 w-52 bg-white border border-slate-200 rounded shadow-lg z-10 py-1 text-[13px]">
            <button
              onClick={() => wrap('jpeg', () => exportJpeg(nodeRef.current, filename))}
              disabled={busy !== null}
              className="w-full text-left px-3 py-1.5 hover:bg-slate-50 inline-flex items-center gap-2"
              data-testid="rv-jpeg"
            >
              <FileImage className="w-4 h-4 text-slate-500" /> Export as JPEG
            </button>
            <button
              onClick={() => wrap('svg', () => exportSvg(nodeRef.current, filename))}
              disabled={busy !== null}
              className="w-full text-left px-3 py-1.5 hover:bg-slate-50 inline-flex items-center gap-2"
              data-testid="rv-svg"
            >
              <Code2 className="w-4 h-4 text-slate-500" /> Export as SVG
            </button>
            <button
              onClick={() => wrap('email', () => exportEmailPdf(
                nodeRef.current, filename, paper,
                `Receipt ${filename}`, `Please find receipt ${filename} attached.`
              ))}
              disabled={busy !== null}
              className="w-full text-left px-3 py-1.5 hover:bg-slate-50 inline-flex items-center gap-2"
              data-testid="rv-email"
            >
              <Mail className="w-4 h-4 text-slate-500" /> Email-ready PDF
            </button>
          </div>
        )}
      </div>
      </>
      )}
    </div>
  );
}
