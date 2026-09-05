import React, { useState } from 'react';

/**
 * ReceiptPrinterSettings — Option E, Phase 8/9.
 *
 * A new "Receipt" section for Settings: configured printer name, paper size
 * (fixed at 210.00 x 142.80mm per the approved spec — not a free-text field,
 * so an admin can't accidentally drift from the required physical size),
 * orientation, and a "Test Printer Compatibility" check.
 *
 * NOT YET WIRED IN: no existing Settings page renders this yet. Activating it
 * means adding this component to Settings.js's tab list — a separate step,
 * not taken yet per the "prepare but do not activate" instruction.
 *
 * The compatibility check here deliberately only answers the UNPRIVILEGED
 * question (does the driver's own PaperSizes list already include the exact
 * size) — it does NOT attempt AddForm itself, because that requires an
 * elevated process token the FeeHub app does not and should not run with on
 * a cashier PC (confirmed firsthand this session: AddForm only succeeded
 * from a separately-elevated PowerShell window, never from this app's own
 * unelevated session). The one-time AddForm-level proof is a manual,
 * elevated action (printer-compat-check.ps1, run once by IT per candidate
 * printer) — "Windows Form Verified" below is the admin's own manual
 * confirmation after running that script, not something this button can
 * determine live. This UI is explicit about that distinction rather than
 * pretending the button alone proves production-readiness.
 */
export default function ReceiptPrinterSettings({ settings, onSave }) {
  const [printerName, setPrinterName] = useState(settings?.receipt_printer_name || '');
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);

  const REQUIRED_WIDTH_MM = 210.0;
  const REQUIRED_HEIGHT_MM = 142.8;

  const runCheck = async () => {
    setTesting(true);
    setTestResult(null);
    if (!window.feehub || typeof window.feehub.checkPrinterPaperSizes !== 'function') {
      setTestResult({ ok: false, error: 'This check is not yet available on this build (desktop app not updated).' });
      setTesting(false);
      return;
    }
    const res = await window.feehub.checkPrinterPaperSizes(printerName);
    setTestResult(res);
    setTesting(false);
  };

  const nativeMatch = testResult?.ok
    ? testResult.sizes.find(
        (s) => Math.abs(s.widthMm - REQUIRED_WIDTH_MM) <= 0.5 && Math.abs(s.heightMm - REQUIRED_HEIGHT_MM) <= 0.5
      )
    : null;

  return (
    <div className="space-y-4 max-w-xl">
      <div>
        <label className="block text-[11px] uppercase tracking-widest text-slate-500 font-semibold mb-1">Receipt Printer</label>
        <input
          value={printerName}
          onChange={(e) => setPrinterName(e.target.value)}
          placeholder="Exact Windows printer name, e.g. HP LaserJet Pro 4004dn"
          className="w-full h-9 px-3 border border-slate-300 rounded text-sm"
          data-testid="receipt-printer-name"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-[11px] uppercase tracking-widest text-slate-500 font-semibold mb-1">Receipt Paper Size</label>
          <div className="h-9 px-3 border border-slate-200 rounded text-sm bg-slate-50 flex items-center text-slate-700">
            {REQUIRED_WIDTH_MM.toFixed(2)} × {REQUIRED_HEIGHT_MM.toFixed(2)} mm
          </div>
        </div>
        <div>
          <label className="block text-[11px] uppercase tracking-widest text-slate-500 font-semibold mb-1">Orientation</label>
          <div className="h-9 px-3 border border-slate-200 rounded text-sm bg-slate-50 flex items-center text-slate-700">Landscape</div>
        </div>
      </div>
      <p className="text-[11px] text-slate-500">
        Paper size and orientation are fixed to the approved physical receipt stock and apply to all receipt types
        (EP, MP, SEC, JC, JC-ACS, EMP, EMJC, BUS, V). They are not editable per receipt type.
      </p>

      <div className="border-t border-slate-200 pt-4">
        <button
          onClick={runCheck}
          disabled={testing || !printerName}
          className="h-9 px-4 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white rounded text-sm font-semibold"
          data-testid="test-printer-compatibility"
        >
          {testing ? 'Checking…' : 'Test Printer Compatibility'}
        </button>

        {testResult && (
          <div className="mt-3 text-[13px] space-y-1">
            <div>Printer: <b>{printerName}</b></div>
            <div>Target: <b>{REQUIRED_WIDTH_MM.toFixed(2)} × {REQUIRED_HEIGHT_MM.toFixed(2)} mm</b></div>
            <div>Orientation: <b>Landscape</b></div>
            {testResult.ok ? (
              <>
                <div>
                  Driver paper list: {nativeMatch ? (
                    <span className="text-emerald-600 font-semibold">PASS — driver already lists a matching size ({nativeMatch.name})</span>
                  ) : (
                    <span className="text-amber-600 font-semibold">Not listed natively — run printer-compat-check.ps1 (elevated) to test AddForm before trusting this printer</span>
                  )}
                </div>
                <div className="text-slate-500">Full driver list: {testResult.sizes.map((s) => `${s.name} (${s.widthMm}×${s.heightMm}mm)`).join(', ')}</div>
              </>
            ) : (
              <div className="text-red-600 font-semibold">FAIL — {testResult.error}</div>
            )}
            <div className="pt-2 text-slate-500">
              Windows Form (elevated AddForm test): {settings?.receipt_printer_verified ? (
                <span className="text-emerald-600 font-semibold">VERIFIED{settings.receipt_printer_verified_at ? ` on ${settings.receipt_printer_verified_at}` : ''}</span>
              ) : (
                <span className="text-slate-500">NOT VERIFIED — run printer-compat-check.ps1 as administrator, then confirm here once it passes</span>
              )}
            </div>
            <div className="text-slate-500">Physical print test: NOT VERIFIED — confirm only after inspecting a real printed page with a ruler</div>
          </div>
        )}
      </div>

      <div className="border-t border-slate-200 pt-4">
        <button
          onClick={() => onSave?.({ receipt_printer_name: printerName })}
          className="h-9 px-4 border border-slate-300 rounded text-sm hover:bg-slate-50"
        >
          Save Receipt Printer Name
        </button>
      </div>
    </div>
  );
}
