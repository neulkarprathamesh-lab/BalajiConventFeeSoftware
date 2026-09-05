# Option E — Receipt Printing Architecture

Status: **staged, not activated in production**. This is a developer reference document, not a user-facing feature.

## 1. Exact paper size

Width: 210.00 mm. Height: 142.80 mm. Orientation: Landscape. Physically ruler-confirmed by the school (not an approximation of A5). This is fixed — see `REQUIRED_RECEIPT_WIDTH_MM`/`REQUIRED_RECEIPT_HEIGHT_MM`/`REQUIRED_RECEIPT_ORIENTATION` in `backend/routers/auth.py`, enforced server-side on every `PATCH /settings`.

## 2. Current P1007 limitation

`HP LaserJet P1007` (installed, USB003, status Normal) cannot produce this size through any legitimate Windows path:
- `AddForm` for 210000×142800 (thousandths of a mm) returns `ERROR_INVALID_FORM_SIZE` (1903), confirmed with a valid `OpenPrinter` handle (not a permissions artifact).
- The printer is host-based/GDI-only (HP's own documentation; driver files are `HP1006SD.DLL`/`.SDD`, shared across the P1005/P1006/P1007/P1008/P1009 family) — it has no onboard PCL/PostScript interpreter, which rules out HP Universal Print Driver, any generic PCL5/PCL6 driver, and RAW/PCL bypass as alternatives for this exact hardware.
- Do not attempt to force it, do not substitute A5, do not modify its configuration.

## 3. Candidate printer ranking

1. **HP LaserJet Pro M404dn / 4004dn** — manufacturer-documented custom range 76×127mm–216×356mm (Tray 1). 142.8mm sits 15.8mm above the minimum — largest margin of the three.
2. **Brother HL-L2351DW** (India variant of HL-L2350DW) — documented range 90–216mm × 139.7–355.6mm. 142.8mm sits only 3.1mm above the minimum — tighter margin, real risk given paper-cutting tolerance.
3. **Canon imageCLASS LBP226dw** — main tray minimum 127mm (comfortable), but one source indicates the MP tray minimum may be ~147.3mm (would exclude 142.8mm on that tray specifically) — internally ambiguous documentation, needs tray-specific verification before trusting.

None are connected as of this document's writing. Do not change this ranking without new manufacturer evidence.

## 4. Windows verification procedure

Run `printer-compat-check.ps1` (this directory) **elevated** ("Run as administrator"):
```
.\printer-compat-check.ps1 -PrinterName "<exact Windows printer name>"
```
Tests, in order: Get-Printer → .NET PaperSizes enumeration → OpenPrinter → AddForm(210000×142800, FORM_PRINTER) → re-check PaperSizes. Reports PASS/FAIL with the literal Win32 error code and system message — never hides or reinterprets a failure. Handles the `ERROR_ALREADY_EXISTS` (183) case distinctly (checks the existing form's actual recorded size before treating it as verified, rather than assuming a same-named form is automatically correct).

**Why elevation is required and why the app itself never will be**: `AddForm` requires an elevated process token (confirmed firsthand — this developer's own unelevated session showed `BUILTIN\Administrators ... Group used for deny only`, and only a separately-elevated PowerShell window succeeded). The FeeHub desktop app runs as a normal user process on cashier PCs and must never run elevated merely to print — so this verification is permanently a separate, manual, one-time IT action per printer, never a runtime app feature.

## 5. Electron verification procedure

Only after Windows verification passes: activate the staged `app.asar` candidate (do not do this until explicitly approved), route a `PrintGeometryDiagnostic` render through `printReceiptDirect()` → IPC `print-receipt-direct` → `webContents.print({silent:true, deviceName, pageSize:{width,height}, landscape:true, printBackground:true})`. A JS `success` callback is **not sufficient proof** — Electron 31 has documented, unresolved-until-v40+ history of silently ignoring/mis-mapping custom `pageSize` on Windows (electron/electron#29532, #39702; fix in #50808 landed only in Electron 40/41/42, nine-plus majors ahead of our 31.x). The width/height-vs-landscape mapping sent to Electron (`width=210000, height=142800` literally, per explicit instruction — NOT the earlier natural-orientation min/max convention) is itself unverified and must be corrected if the physical result comes out rotated or swapped.

## 6. Physical verification procedure

Print the diagnostic on scrap paper first, measure with a ruler: expect exactly 210.00×142.80mm, landscape, no clipping/scaling/rotation, content within all four corner markers. Only then print one real receipt on actual stock and inspect the full content checklist (logo, header, title, receipt no., date, academic year, barcode, student fields, fee table, payment panel, balance, notes, signatures, footer, watermark, borders, alignment, physical page size).

## 7. Final print architecture

```
Cashier: "Print Receipt"
  -> ReceiptPrintPreview (FeeHub-owned, reuses ReceiptEngine's render — no second layout)
    -> Print / Cancel only
      -> printReceiptDirect({widthMm, heightMm, landscape, deviceName})  <- from Settings, never hardcoded
        -> IPC 'print-receipt-direct' -> webContents.print({silent:true, deviceName, pageSize, landscape})
          -> ok:true  -> caller may record the print/audit event
          -> ok:false -> clear cashier-facing error, receipt NOT marked printed, no fallback of any kind
```

No `window.print()`, no orientation-only retry, no A4/A5 substitution, no automatic printer switching in this path — by design, checked by grep across all staged files (none found in executable logic, only in comments/unrelated legacy code).

## 8. Settings architecture

`GET/PATCH /api/settings` — new fields: `receipt_printer_name` (admin-editable, freetext exact Windows device name, blocked from being set to "Microsoft Print to PDF"/"OneNote"), `receipt_paper_width_mm`/`receipt_paper_height_mm`/`receipt_orientation` (server-enforced fixed at 210.0/142.8/landscape, ±0.05mm tolerance — not admin-editable to an arbitrary value), `receipt_printer_verified`/`receipt_printer_verified_at`/`receipt_printer_verified_by` (admin's manual confirmation after running the elevated script — the app never sets these itself). Applies to all 9 receipt types uniformly; no per-type paper config exists or is planned.

## 9. Preview architecture

`ReceiptPrintPreview.js` wraps `ReceiptEngine` with the new `minimalPrint`/`onCancel` props (default `false`/`null` — zero effect on every existing call site: `ReceiptView.js`, `ReceiptTypes.js`'s Live Preview, `Lookup.js`). When `minimalPrint` is true, `ReceiptEngine` renders `MinimalPrintCancelBar` (Print/Cancel only) instead of the full `ReceiptToolbar` (PDF/PNG/export/paper-size/theme/zoom). The preview never creates a receipt, consumes a receipt number, or touches payment/ledger data — it only takes an existing receipt object as a prop.

Aspect ratio: the underlying receipt DOM is sized in real mm via `ReceiptFrame`'s existing `@page`/pixel-per-mm math (unchanged) — the preview modal's `max-w-[95vw] max-h-[95vh] overflow-auto` only affects how much of that fixed-geometry canvas is visible on screen, it does not resize the canvas itself. Zooming/fitting the modal to the viewport is a CSS `transform: scale()`-free choice deliberately — the existing `ReceiptFrame`/`ReceiptEngine` scale mechanism (`effectiveScale`) already handles fit-to-preview without altering the underlying mm-based coordinate system, and `ReceiptPrintPreview` inherits that unchanged.

## 10. Error handling

Cashier-facing messages (never a stack trace):
- No printer configured: "No receipt printer is configured. Set one in Settings > Receipt before printing."
- No paper size configured: "No receipt paper size is configured. Set it in Settings > Receipt before printing."
- Print failure: "The configured receipt printer (<name>) is unavailable or the print job could not be sent. Please check the printer and try again."

Technical detail (Electron failure reason, timestamps) stays in `console.warn`/log output for developer/admin inspection, never surfaced raw to the cashier.

## 11. Client deployment considerations

See section "Client vs. server-side printing" below — analysis only, nothing implemented.

## 12. Production activation checklist

See `PRODUCTION-ACTIVATION-CHECKLIST.md` in this same directory.

---

## Client vs. server-side printing — analysis (Phase 25/26, no implementation)

The receipt printer is a **Windows-local resource** — whichever PC it's physically connected to (USB, in every candidate's case) is the only PC that can address it directly by `deviceName`. This has real implications for a LAN of multiple cashier PCs:

**A. Does the client need the printer installed locally?** Yes, if that client PC is expected to print receipts directly — a USB printer has no meaning to a PC it isn't plugged into.

**B. Can clients print through a shared/network printer?** Yes, via standard Windows printer sharing: share the printer from whichever PC it's attached to, then each client PC installs a network print queue (`\\<host>\<ShareName>`) pointing at it. This is the standard, low-effort way to give multiple cashier PCs access to one physical printer without buying one per desk.

**C. Does the client need the same printer deviceName?** Not necessarily the identical string — a shared printer typically installs on the client under a name like `<ShareName> on <HOST>`, which would need to be entered into that client's `Settings > Receipt > Receipt Printer` field. Windows printer sharing does not automatically keep names identical across PCs.

**D. Does the final architecture need a server-side print service?** Not necessarily — Windows' native printer sharing already provides this, avoiding the need to build/maintain a custom print queue service. Simpler is safer here.

**E. Would direct client printing be preferable?** Only if each cashier desk has (or will have) its own dedicated receipt printer — then B/D become moot and each client just points at its own local device.

**Recommendation for later discussion (not decided, not implemented):** if there's genuinely one cashier desk/one receipt printer for the whole school, this whole question may be moot — the Main Server PC likely *is* the cashier PC, and no cross-machine sharing is needed at all. Worth confirming the actual physical setup before designing anything further here.

**Explicitly not done:** no network configuration changed, nothing installed on any client, no server-side print queue built.
