# Balaji FeeHub — Receipt Printing/Preview Fix (PRD)

## Problem statement (original)
FeeHub receipts printed wrong: content shrank into a corner of a large sheet
(preview ≠ print). Required: ONE authoritative renderer for preview + physical
print; receipt artwork exactly 210 × 142.8 mm landscape; letterboxed onto A5
(210 × 148 mm) landscape media; generic/selectable printer (tested HP LaserJet
P1007); no second page, clipping, scaling, or manual cashier printer settings.
Must not change any financial/business logic. Preserve all 9 receipt types.
Deliver corrected source + reproducible Windows Server + Client TEST builds.

## Architecture
Receipt data → ReceiptEngine (one renderer) → ReceiptFrame (210×142.8 artwork,
@page A5 landscape, artwork letterboxed via CSS) → { FeeHub Print Preview modal
(screen) | webContents.print(deviceName, pageSize:'A5', landscape, silent) (paper) }.
Same DOM (.print-target) for both ⇒ preview == physical print.

## Implemented (2026-06 / this session)- Rebuilt FeeReceiptBody to the approved reference layout (2-col DETAILS; fee
  table left + payment panel right). Fixed the vertical overflow (was ~150.6mm
  → now measured 142.35mm at true geometry; width 210.00mm).
- Compact BusReceiptBody for the print geometry (was 191mm → 142.35mm). Debit
  Voucher and Money receipts also verified at 142.35mm.
- One print system: toolbar/ReceiptView Print → ReceiptPrintPreview modal →
  printReceiptDirect → IPC print-receipt-direct (named A5 + landscape, silent,
  deviceName, no window.print fallback). Success-only reprint bump.
- Settings → Receipt Printer card (printer name, media A5 default/generic,
  fixed artwork readout) + admin Print Test Receipt (sample data, no txn).
- Backend /settings accepts receipt_media_size/width/height (generic media);
  artwork size + landscape still server-enforced. No financial logic touched.
- Electron desktop shell corrected under desktop/ (main.js/preload.js) +
  electron-builder package.json. Docs under docs/ (PRINTING_FIX_REPORT.md,
  BUILD_TEST_BUILDS.md).

## Verified here (browser, true mm)
- Geometry: width 210.00mm, content height 142.35mm for FEE, BUS, MONEY, and
  Debit Voucher (all ≤ 142.8, no overflow/clipping/second page).
- Preview modal uses the same renderer at identical geometry.
- Direct-print error handling correct in browser (clear message, no fallback,
  receipt not marked printed). 9 receipt types present (EP,MP,EMP,SEC,JC,JCACS,
  BUS,EMJC,DV). testing_agent iteration_1: 100% pass.

## NOT verified here (must run on Windows — see docs/BUILD_TEST_BUILDS.md)
- Physical HP LaserJet P1007 A5 print (no printer in this Linux env).
- Windows .exe builds (no Windows toolchain here).

## Final UI refinements (this session, verified iteration_3 100%)
- Receipt view shows ONE primary Print button only (no PDF/PNG/export/two-up).
  Flow: Create & Print → /receipts/:id?print=1 → Print Preview auto-opens → Print.
- Settings Paper Source = exactly three app-level choices: A4 / A5 / Special
  Receipt (default SPECIAL). No raw Windows paper list. Mapped to named driver
  size (A5/A4) + landscape; 210×142.8 artwork letterboxed, never stretched.
  Backend accepts receipt_paper_source. Preview media label reflects selection.

## Backlog / next
- P0: Build + run TEST Client EXE and TEST Server on Windows; physical P1007 A5
  ruler test; toggle main.js landscape/media if physical output is rotated.
- P1: Optionally gate /print-lab behind a dev flag before production.
- P2: Verify JC-ACS bifurcation and long-name/many-line edge cases physically.
