# Option E — Production Activation Checklist

ALL of the following must be TRUE before the staged candidate is activated on the Main Server, and none may be marked complete without an actual, recorded test result.

- [ ] Compatible printer installed
- [ ] Official driver installed
- [ ] Printer status Normal
- [ ] Exact 210 x 142.8 mm form accepted by Windows (AddForm PASS, exact Win32 result recorded)
- [ ] Electron print test passed (deviceName-targeted, silent, pageSize honored — not just a JS `ok:true`)
- [ ] Physical diagnostic measured exactly 210.00 x 142.80 mm with a ruler
- [ ] Landscape verified
- [ ] No clipping
- [ ] No scaling
- [ ] No A4 substitution
- [ ] No A5 substitution
- [ ] Real receipt physically verified against the full content checklist
- [ ] Receipt preview matches the physical output
- [ ] Printer configuration saved in Settings
- [ ] Error handling tested (printer offline/unavailable produces the correct cashier-facing message)
- [ ] Retry tested (a failed print can be retried without side effects)
- [ ] No duplicate receipts created by a failed-then-retried print
- [ ] No duplicate payments created by a failed-then-retried print
- [ ] No receipt number consumed incorrectly by a failed print attempt
- [ ] Existing financial/ledger/receipt-numbering data untouched throughout testing
- [ ] All nine receipt types (EP, MP, SEC, JC, JC-ACS, EMP, EMJC, BUS, V) tested or architecture-validated against the shared configuration
- [ ] Production backup verified (this checkpoint directory, or a newer one) before any live swap
- [ ] Installer build verified (only after Main Server activation is separately approved)
- [ ] Main Server deployment explicitly approved by the user
- [ ] Client deployment explicitly approved by the user (separate approval from Main Server)

## Current state (as of this document)

Every item above is unchecked. No candidate printer is connected. Windows compatibility, Electron testing, and physical testing have not started for any candidate. The only completed prior verification is the **negative** result for the HP LaserJet P1007 (rejected, do not reattempt).
