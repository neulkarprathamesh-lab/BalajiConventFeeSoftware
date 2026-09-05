# FeeHub Print Diagnostic (Standalone Windows Test EXE)

A small, **standalone** Electron tool to diagnose FeeHub receipt printing on Windows.
It is completely independent of the FeeHub server, database, students, payments,
receipt numbers, and ledger. It uses **synthetic test data only** and prints via
the real Electron desktop pipeline (never `window.print()`).

It exists to answer ONE question with evidence: *when we ask the printer for a
210 × 142.8 mm landscape receipt on A5 media, what does the software request, what
does Windows report, and what physically comes out?* — so we can tell whether an
error is in the renderer, Electron, Windows, the driver, the media, or paper loading.

## What it does
- Lists **any** Windows printer (generic — no P1007 or any printer hard-coded).
- Paper Source: exactly **A4 / A5 / SPECIAL RECEIPT** (SPECIAL = 210 × 142.8 artwork letterboxed on A5).
- **Show Preview** — renders `renderer/receipt.html`, which is the **EXACT FeeHub receipt** (same 210 × 142.8 mm layout as the app: logo + school header, black FEE RECEIPT box, receipt no + date + academic year + barcode, 2‑column DETAILS, fee table + payment panel, notes + Received/Authorized signatures, contact bar) filled with synthetic PRINT TEST data. This is the SAME file that is sent to the printer.
- **Measurement markers** are an **optional overlay** (checkbox / `?markers=on`), **OFF by default** so the printout is exactly the FeeHub receipt. When on, it overlays the page/artwork boundary, TL/TR/BL/BR corners, 50 mm horizontal + vertical rulers, X+/Y+ axes.
- **Print Test Receipt** — sends exactly **ONE** silent job to the selected printer and records EVERYTHING into a per-test folder.
- **Physical Print Observation** form (orientation / position / scaling / clipping / page / measured W×H / notes) appended to the same report.
- **Open Diagnostic Log** — opens the diagnostics folder.

## Diagnostic output (per test)
`Documents\FeeHubPrintDiagnostic\PrintTest_YYYY-MM-DD_HHMMSS\`
- `diagnostic.json` and `diagnostic.txt` — EXPECTED vs REQUESTED-BY-SOFTWARE vs WINDOWS/PRINTER vs (later) USER OBSERVATION, plus environment (Windows/arch/Electron/Chromium/Node), printer info, exact Electron `webContents.print` params (pageSize, landscape, margins, silent, deviceName), the print result / error, and renderer DOM measurements (artwork measured in mm, DPR, viewport).
- `receipt.png` — screenshot of the exact rendered receipt (application only; no desktop capture).
- `observation.txt` — the physical observation you enter.

## Build on Windows (x64)
Prereqs: Node.js 18+, Yarn (`npm i -g yarn`).
```bat
cd print-diagnostic
yarn install
yarn dist
```
Outputs in `print-diagnostic\dist\`:
- Installer: `FeeHub-Print-Diagnostic-Test-1.0.0.exe`
- Portable (no install): `FeeHub-Print-Diagnostic-Test-Portable-1.0.0.exe`

Run without building (dev): `yarn start`.

## Build on GitHub (no Windows PC needed)
A GitHub Actions workflow builds the Windows EXEs on a real `windows-latest` runner:
`.github/workflows/build-print-diagnostic-windows.yml`.

It runs automatically on any push that touches `print-diagnostic/**`, or manually:
1. Push this repo to GitHub.
2. GitHub → **Actions** tab → **Build Print Diagnostic (Windows)** → **Run workflow** (branch `master`).
3. Wait for the run to finish (green check).
4. Open the run → **Artifacts** → download **`FeeHub-Print-Diagnostic-Windows`** (a zip).
5. Inside: `FeeHub-Print-Diagnostic-Test-1.0.0.exe` (installer) and
   `FeeHub-Print-Diagnostic-Test-Portable-1.0.0.exe` (portable — no install needed).

Copy either EXE to the Windows PC with the printer and follow the Test procedure below.

## Test procedure
1. Load A5 (210 × 148 mm) in the tray **landscape** (210 mm = long edge).
2. Launch the tool → pick your printer → Paper Source = **SPECIAL RECEIPT**.
3. **Show Preview** — confirm the artwork box, rulers and corner markers look right.
4. **Print Test Receipt** — one sheet prints; status shows the diagnostic folder + the software-measured artwork size.
5. With a ruler, measure the printed **artwork box** — it must be **210.0 × 142.8 mm**, centred with ~2.6 mm top/bottom letterbox, landscape, no clipping/rotation. Check the 50 mm rulers read 50 mm.
6. Fill in **Physical Print Observation** → **Save Observation**.
7. **Open Diagnostic Log** and send me the `PrintTest_*` folder (json + png + observation).

## Notes
- One button click = at most one print job; no auto-retry.
- Not integrated into FeeHub. Nothing here touches production. Once the physical
  print is proven correct, the proven `print(...)` parameters can be lifted into
  FeeHub's `desktop/main.js` `print-receipt-direct` handler (already structured the same way).
