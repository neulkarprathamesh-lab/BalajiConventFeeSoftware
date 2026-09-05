# Checkpoint — pre Option E printing architecture work

Taken: 2026-09-05, before any Option E code is activated.
Version control: this source tree is NOT under git (`git status` confirms "not a git repository").
This checkpoint directory is the rollback mechanism in its place.

## Recorded facts at checkpoint time

- App version (`version.json`): 1.0.0, build_date 2026-02-04, receipt_template_version 1.0
- Electron runtime: 31.x (Chromium 126.0.6478.234, read from `BalajiFeeHub.exe`'s embedded UA string)
- Live desktop shell: `C:\balaji-fee\04-desktop\resources\app.asar`, MD5 `92b8d60bc7e5ab547af14c6e40cf60a7`
  (this already includes the earlier print-page IPC fix with exact-size -> orientation-only -> window.print() fallback,
  from the prior printing-bug session — this checkpoint is NOT a "before any of my changes" point, it is the
  "before Option E work" point, i.e. current live production as of right now.)
- Live frontend build: `C:\balaji-fee\frontend\build` (served on port 3000), matches `03-source-code/frontend` build output
  as of the last deploy in the prior printing-bug session.
- Printers currently on the Main Server: HP LaserJet P1007 (Normal, USB003 — NOT suitable per Option E investigation),
  HP LaserJet P1008 (Error/PendingDeletion, irrelevant), Canon iR2200-3300 PCL5e (Normal), iR1643i II (Normal),
  Brother DCP-T820DW (Normal), Microsoft Print to PDF, OneNote (Desktop). No Option E candidate printer
  (HP M404dn/4004dn, Brother HL-L2351DW, Canon LBP226dw) is connected as of this checkpoint.

## Files snapshotted here (exact copies, pre-Option-E)

- `frontend-receipt/receiptExporter.js`
- `frontend-receipt/ReceiptToolbar.js`
- `frontend-receipt/ReceiptEngine.js`
- `frontend-receipt/PaperSizes.js`
- `frontend-receipt/ReceiptFrame.js`
- `frontend-receipt/ReceiptPrimitives.js`
- `frontend-pages/ReceiptTypes.js`
- `frontend-pages/ReceiptView.js`
- `frontend-pages/NewReceipt.js`
- `backend/core.py`
- `backend/routers/auth.py`
- `backend/routers/receipts.py`
- `desktop-shell/app.asar` (byte-for-byte copy of the live file, MD5-verified above)
- `version.json`

## To roll back

1. Copy each file above back over its corresponding live path.
2. Copy `desktop-shell/app.asar` back over `C:\balaji-fee\04-desktop\resources\app.asar`.
3. Rebuild the frontend from the restored source (`npm run build`) and redeploy to `C:\balaji-fee\frontend\build`
   following the existing rotate-backup convention (`build.old`, `build.prev`...`build.prev6`).
4. No database/settings rollback is needed for this checkpoint, since no settings fields existed yet
   for Option E at checkpoint time (they are additive — see Phase 8 prep notes).

## Scope guarantee

Nothing in this checkpoint round touches: receipt numbering, payment/ledger logic, fee calculations,
receipt type definitions, student data, or the existing approved receipt visual design. Only printing-pipeline
files are in scope for Option E.
