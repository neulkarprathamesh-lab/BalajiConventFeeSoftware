import React from 'react';
import { printReceiptDirect } from './receiptExporter';

/**
 * PrintGeometryDiagnostic — Option E, Phase 3/4.
 *
 * Deliberately isolated from the real receipt/payment flow: no receipt
 * object, no receipt number, no student/payment data at all. Its only job is
 * to prove the physical page geometry a candidate printer actually produces,
 * before any real receipt stock is risked.
 *
 * Renders: page boundary, exact width/height labels, a LANDSCAPE label, four
 * corner markers, a center cross, and the dimensions as plain text — exactly
 * per the Option E Phase 3 spec, at the exact size passed in (default the
 * canonical 210 x 142.8mm).
 *
 * NOT YET WIRED IN: no route in App.js renders this yet. Intended usage once
 * activated: an admin-only route (e.g. /dev/print-geometry), printed via the
 * SAME printReceiptDirect() path the real receipt will use, so a pass here is
 * a genuine proof of the print pipeline, not just the visual layout.
 */
export default function PrintGeometryDiagnostic({
  widthMm = 210.0,
  heightMm = 142.8,
  deviceName = '',
}) {
  const [result, setResult] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const pxPerMm = 96 / 25.4;
  const wPx = widthMm * pxPerMm;
  const hPx = heightMm * pxPerMm;

  const runPrint = async () => {
    setBusy(true);
    setResult(null);
    const res = await printReceiptDirect({ widthMm, heightMm, landscape: true, deviceName });
    setResult(res);
    setBusy(false);
  };

  return (
    <div className="p-6">
      <div className="no-print mb-4 flex items-center gap-3">
        <button
          onClick={runPrint}
          disabled={busy || !deviceName}
          className="h-9 px-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded text-sm font-semibold"
        >
          {busy ? 'Printing…' : 'Print Diagnostic'}
        </button>
        {!deviceName && <span className="text-[12px] text-amber-600">No printer configured — set Settings &gt; Receipt &gt; Receipt Printer first.</span>}
        {result && (
          <span className={`text-[13px] font-semibold ${result.ok ? 'text-emerald-600' : 'text-red-600'}`}>
            {result.ok ? 'Print job sent — now measure the physical output.' : `FAIL: ${result.error}`}
          </span>
        )}
      </div>

      <style>{`@media print { @page { size: ${widthMm}mm ${heightMm}mm; margin: 0; } .no-print { display: none !important; } }`}</style>

      <div
        style={{
          position: 'relative',
          width: wPx,
          height: hPx,
          border: '1px solid #000',
          background: '#fff',
          margin: '0 auto',
          boxSizing: 'border-box',
        }}
      >
        {/* Corner markers */}
        {[
          { top: 0, left: 0, label: 'TOP-LEFT' },
          { top: 0, right: 0, label: 'TOP-RIGHT' },
          { bottom: 0, left: 0, label: 'BOTTOM-LEFT' },
          { bottom: 0, right: 0, label: 'BOTTOM-RIGHT' },
        ].map((pos, i) => (
          <div key={i} style={{ position: 'absolute', ...pos, width: 20, height: 20 }}>
            <div style={{ position: 'absolute', top: pos.top === 0 ? 0 : 'auto', bottom: pos.bottom === 0 ? 0 : 'auto', left: pos.left === 0 ? 0 : 'auto', right: pos.right === 0 ? 0 : 'auto', width: 12, height: 2, background: '#000' }} />
            <div style={{ position: 'absolute', top: pos.top === 0 ? 0 : 'auto', bottom: pos.bottom === 0 ? 0 : 'auto', left: pos.left === 0 ? 0 : 'auto', right: pos.right === 0 ? 0 : 'auto', width: 2, height: 12, background: '#000' }} />
          </div>
        ))}

        {/* Center cross */}
        <div style={{ position: 'absolute', top: '50%', left: 'calc(50% - 10px)', width: 20, height: 2, background: '#000' }} />
        <div style={{ position: 'absolute', left: '50%', top: 'calc(50% - 10px)', width: 2, height: 20, background: '#000' }} />

        {/* Text */}
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -140%)', textAlign: 'center', fontFamily: 'monospace', fontSize: 14 }}>
          <div>WIDTH = {widthMm.toFixed(2)} mm</div>
          <div>HEIGHT = {heightMm.toFixed(2)} mm</div>
          <div style={{ fontWeight: 'bold', marginTop: 4 }}>LANDSCAPE</div>
        </div>
      </div>
    </div>
  );
}
