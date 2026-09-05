/**
 * Balaji FeeHub — Offline Installation Manual generator.
 *
 * Uses jsPDF to build a fully-illustrated, table-of-contents-driven PDF that
 * a fresh Windows admin can follow start-to-finish without any additional
 * hand-holding. Every section is written verbatim into the codebase so the
 * manual re-generates from the current source truth (version, folder paths,
 * troubleshooting).
 *
 * Public API:
 *     await downloadInstallationManual({ appVersion, buildDate })
 */
import jsPDF from 'jspdf';

const NAV = 'navy'; // symbolic — actual value is set at runtime

const A4 = { w: 210, h: 297 };
const MARGIN_L = 18;
const MARGIN_R = 18;
const MARGIN_TOP = 22;
const MARGIN_BOT = 20;
const CONTENT_W = A4.w - MARGIN_L - MARGIN_R;

const COLORS = {
  brandInk:  '#1a237e',   // deep navy
  accent:    '#C62828',   // logo red
  soft:      '#f5f7fb',
  line:      '#cbd5e1',
  muted:     '#64748b',
  text:      '#0f172a',
  ok:        '#065f46',
  warn:      '#b45309',
};

const SECTIONS = [
  {
    n: 1, title: 'System Requirements',
    blocks: [
      { h: 'Supported Windows Versions', p: [
        'Windows 10 Pro / Enterprise (64-bit) — recommended',
        'Windows 11 Pro / Enterprise (64-bit)',
        'Windows Server 2019 / 2022 (Standard)',
      ]},
      { h: 'Minimum Hardware', p: [
        'CPU: Dual-core 2.0 GHz or better',
        'RAM: 4 GB (8 GB recommended for the Main Server)',
        'Disk: 20 GB free on the Main Server, 5 GB on Client PCs',
        'Network: 100 Mbps LAN cable to a switch/router',
      ]},
      { h: 'Recommended Hardware (Main Server)', p: [
        'CPU: Quad-core 2.5 GHz+',
        'RAM: 16 GB',
        'Disk: 250 GB SSD (fast backups)',
        'UPS: 15-minute backup for safe shutdown',
      ]},
      { h: 'Network Requirements', p: [
        'All PCs must be on the same LAN / same subnet',
        'Assign the Main Server a STATIC IP (e.g. 192.168.1.10)',
        'No internet is required after installation',
        'Ports: 3000 (web UI), 8001 (API), 27017 (Mongo — internal only)',
      ]},
      { h: 'Printer & Scanner Requirements', p: [
        'Any Windows-supported inkjet or laser printer',
        'A5 or A4 paper — the software auto-scales',
        'Optional QR barcode scanner (USB-HID keyboard-emulation)',
      ]},
    ],
  },
  {
    n: 2, title: 'Installing the Main Server',
    blocks: [
      { h: 'Step 1 · Extract the ZIP', p: [
        'Right-click BalajiFeeHub-v1.0-FINAL.zip → "Extract All…"',
        'Choose "C:\\BalajiFeeHub" as the destination',
        'Wait for the extract to complete (~30 seconds)',
      ]},
      { h: 'Step 2 · Folder Structure', p: [
        'BalajiFeeHub/',
        '  installers/       ← .bat installers',
        '  backend/          ← FastAPI service',
        '  frontend/         ← React UI',
        '  docs/             ← this manual + release notes',
        '  scripts/          ← purge, .bcupdate builder',
        '  version.json      ← installed app version',
      ]},
      { h: 'Step 3 · Run install-main-server.bat', p: [
        'Right-click install-main-server.bat → "Run as administrator"',
        'The installer sets up MongoDB, Python, Node, and NSSM services',
        'Windows Firewall will ask for permission to allow ports 3000/8001',
        'Click "Allow access" on both prompts',
      ]},
      { h: 'Step 4 · Static IP Configuration', p: [
        'Open Control Panel → Network → Change Adapter Settings',
        'Right-click Ethernet → Properties → IPv4',
        'Set IP: 192.168.1.10 · Subnet: 255.255.255.0 · Gateway: 192.168.1.1',
        'The installer records this IP into installers/server-ip.txt',
      ]},
      { h: 'Step 5 · First Boot & Setup Wizard', p: [
        'Open Chrome → http://localhost:3000',
        'The Setup Wizard runs on the first visit',
        'Enter school name, address, academic year, principal name',
        'Create the first Administrator account (email + password + 4-digit PIN)',
      ]},
      { h: 'Step 6 · Change Default Password & PIN', p: [
        'Sign in with the administrator account',
        'Click your name (top-right) → Change Password',
        'Set a strong password (12+ characters)',
        'Set a NEW 4-digit PIN — do not use 1234',
      ]},
      { h: 'Step 7 · First Backup & Config Snapshot', p: [
        'Menu → Backup & Restore → click "Create Backup Now"',
        'Enter your Admin PIN — the backup ZIP is written to /app/backups',
        'Menu → Config Snapshots → "Create Snapshot" (label: "Baseline v1.0")',
      ]},
    ],
  },
  {
    n: 3, title: 'Installing Client PCs',
    blocks: [
      { h: 'Step 1 · Copy the Installer', p: [
        'From the Main Server, share the "installers" folder (read-only)',
        'Or copy install-client-pc.bat to a USB drive',
      ]},
      { h: 'Step 2 · Automatic Server Discovery', p: [
        'On the client PC, right-click install-client-pc.bat → Run as admin',
        'The script uses PowerShell to auto-discover the Main Server on the LAN',
        'You will see: "Main Server found at 192.168.1.10 — creating shortcut."',
        'A desktop shortcut called "Balaji FeeHub" is created',
      ]},
      { h: 'Step 3 · Manual IP Fallback', p: [
        'If auto-discovery fails, the installer asks for the server IP',
        'Enter 192.168.1.10 (or whatever you configured on the Main Server)',
      ]},
      { h: 'Step 4 · Printer Setup', p: [
        'Add the school printer via Control Panel → Printers',
        'Set it as the default printer',
        'Print a Windows test page to confirm',
      ]},
      { h: 'Step 5 · First Login & Test Print', p: [
        'Double-click the "Balaji FeeHub" desktop shortcut',
        'Sign in with your cashier / accountant credentials',
        'Go to Diagnostics → click "Print test receipt"',
      ]},
    ],
  },
  {
    n: 4, title: 'First-Time Configuration',
    blocks: [
      { h: 'School Information', p: [
        'Menu → Settings → School Info',
        'Confirm school name, address, phone, email, tagline, logo',
      ]},
      { h: 'Receipt Types', p: [
        'Menu → Receipt Types',
        'Each of the 9 receipt types has a paper size, theme, and signature layout',
        'Default paper size: A5 Portrait. Default theme: Classic B/W',
        'Change theme to "Balaji Colored" only for receipts that need brand colours',
      ]},
      { h: 'Users & Permissions', p: [
        'Menu → Users → click "Add User"',
        'Choose role: Cashier / Accountant / Manager / Administrator',
        'Cashiers can only collect fees; Managers approve adjustments; Admins can do everything',
      ]},
      { h: 'Backup Schedule', p: [
        'The system auto-creates one backup per day (kept: last 30)',
        'You can also click "Create Backup" any time on the Backups page',
        'Copy backup ZIPs to an external drive weekly',
      ]},
      { h: 'Receipt Numbering', p: [
        'Menu → Receipt Types → any type → Numbering',
        'Format: PREFIX-YYYY-000001 (e.g. EP-2026-000001 for English Primary)',
        'Debit Vouchers use DV-YYYY-000001 automatically',
        'Numbering resets automatically at the start of each academic year',
      ]},
    ],
  },
  {
    n: 5, title: 'Importing Student Data',
    blocks: [
      { h: 'Download the Excel Template', p: [
        'Menu → Students → click "Import from Excel"',
        'Download the empty template — it has the exact column order we need',
      ]},
      { h: 'Required Columns', p: [
        'admission_no, name, class_name, section, roll_no, medium (English/Marathi/Semi)',
        'father_name, mother_name, guardian_mobile, address',
        'bus_stop_no (optional), gender, date_of_birth',
      ]},
      { h: 'Import Process', p: [
        'Upload the filled Excel file → the app validates every row',
        'Invalid rows are highlighted with the exact reason',
        'Fix them in Excel and re-upload; only new/updated rows are written',
      ]},
      { h: 'Common Validation Errors', p: [
        '"Duplicate admission_no" — an existing student already has that number',
        '"Class not found" — add the class in Menu → Classes first',
        '"Invalid mobile" — must be 10 digits (Indian format)',
      ]},
      { h: 'After Import', p: [
        'Menu → Students → confirm total count matches the Excel row count',
        'Fee structures are auto-linked based on the medium column',
      ]},
    ],
  },
  {
    n: 6, title: 'Daily Operations',
    blocks: [
      { h: 'Collect a Fee', p: [
        'Menu → New Receipt → pick the receipt type',
        'Search the student (name or admission_no)',
        'Tick the fee heads to pay, choose payment mode',
        'Click "Collect" — receipt is auto-generated and printed',
      ]},
      { h: 'Print / Export Receipt', p: [
        'From any receipt: Print (default printer)',
        'PDF, PNG, JPEG, SVG, or Email-ready PDF from the toolbar',
        'Every export preserves the exact printed layout',
      ]},
      { h: 'Create a Debit Voucher', p: [
        'Menu → Finance → New Debit Voucher',
        'Enter Paid To / vendor name, amount, purpose, payment mode',
        'The voucher gets a DV-YYYY-000001 number and prints automatically',
      ]},
      { h: 'Fee Adjustments & Extensions', p: [
        'Cashiers request; Managers approve',
        'Menu → Adjustments (Manager) → pending queue',
      ]},
      { h: 'Reports', p: [
        'Menu → Reports → daily/monthly/date-wise collection',
        'Every report has Excel + PDF + Print buttons',
      ]},
      { h: 'Perform a Manual Backup', p: [
        'Menu → Backups → "Create Backup Now" (requires Admin PIN)',
      ]},
    ],
  },
  {
    n: 7, title: 'Software Updates',
    blocks: [
      { h: 'Installing a .bcupdate Package', p: [
        'Menu → Administration → Software Updates',
        'Click the dropzone → pick the .bcupdate file the vendor sent',
        'The app verifies SHA-256 checksum + RSA signature automatically',
        'Preview the release notes and file count',
        'Click "Install v1.x.x" — this creates a backup, applies files, and restarts',
      ]},
      { h: 'Verifying an Update', p: [
        'After install, look at the "Currently Installed" card — the version must match',
        'The update appears in the History table with status "SUCCESS"',
      ]},
      { h: 'Rollback', p: [
        'The last 3 updates each keep a rollback snapshot on disk',
        'From History → click the Rollback button next to the desired version',
        'Enter your Admin PIN — the previous files are restored and the server restarts',
      ]},
      { h: 'How Clients Automatically Receive Updates', p: [
        'Every Client PC polls /api/version every 30 seconds',
        'When the server version is newer than the client cache, the client shows a toast',
        'The React bundle is re-fetched and the app auto-reloads',
        'Cashiers see no interruption other than a "New version available" flash',
      ]},
    ],
  },
  {
    n: 8, title: 'Backup & Recovery',
    blocks: [
      { h: 'Manual Backup', p: [
        'Menu → Backups → "Create Backup Now" → Admin PIN',
        'Each backup is a ZIP written to /app/backups with a SHA-256 checksum',
      ]},
      { h: 'Automatic Daily Backup', p: [
        'A daily backup runs automatically; the last 30 are retained',
        'Copy the newest one to an external drive at the end of each week',
      ]},
      { h: 'Restoring a Backup', p: [
        'Menu → Backups → find the backup → "Restore"',
        'A safety snapshot of the CURRENT database is taken first',
        'Restoration replaces every collection with the backup contents',
        'Sign in again after restore completes',
      ]},
      { h: 'Configuration Snapshots', p: [
        'Menu → Config Snapshots → "Create Snapshot"',
        'Snapshots capture master data only (departments, fee heads, etc.)',
        'Use them before major reconfigurations (new fee heads, new session)',
      ]},
      { h: 'Disaster Recovery', p: [
        'Keep at least one backup ZIP on an external USB drive',
        'On a new Windows PC, install the app fresh, then restore the backup',
      ]},
    ],
  },
  {
    n: 9, title: 'Troubleshooting',
    blocks: [
      { h: 'Client cannot connect to Main Server', p: [
        'Ping the server IP from the client (cmd → ping 192.168.1.10)',
        'Confirm Windows Firewall allows ports 3000 and 8001 on the server',
        'Restart the Balaji FeeHub Windows service (services.msc → BalajiFeeHub)',
      ]},
      { h: 'Login failure', p: [
        'Confirm CAPS LOCK is off',
        'Admin can reset any user password from Menu → Users',
        'If admin password is lost, use scripts/reset-admin-password.bat on the server',
      ]},
      { h: 'Printer not working', p: [
        'Set the printer as default in Windows',
        'Test print a Windows page first',
        'In the receipt view, choose "Print" — Chrome opens the printer dialog',
      ]},
      { h: 'Import errors', p: [
        'Re-download the current Excel template — column order may have changed',
        'Fix highlighted rows and re-upload',
      ]},
      { h: 'Update install failed', p: [
        'The system auto-rolls back and the app remains on the old version',
        'Menu → Software Updates → History will show the failed step',
        'Contact the vendor with the log',
      ]},
      { h: 'Backup failed', p: [
        'Check Diagnostics — /app/backups must be writable',
        'Confirm free disk space is > 5 GB',
      ]},
    ],
  },
  {
    n: 10, title: 'Appendix',
    blocks: [
      { h: 'Default Folder Locations', p: [
        'App root:        C:\\BalajiFeeHub',
        'Backups:         C:\\BalajiFeeHub\\backups',
        'Uploads/staging: C:\\BalajiFeeHub\\updates',
        'MongoDB data:    C:\\ProgramData\\MongoDB\\data',
      ]},
      { h: 'Important File Locations', p: [
        'version.json                       (installed version)',
        'backend/.env                       (Mongo + JWT secrets)',
        'frontend/.env                      (REACT_APP_BACKEND_URL)',
        'backend/keys/update_public.pem     (RSA public key for updates)',
      ]},
      { h: 'Windows Services', p: [
        'BalajiFeeHub-Backend   (uvicorn, port 8001)',
        'BalajiFeeHub-Frontend  (serve, port 3000)',
        'MongoDB                (port 27017 — internal)',
      ]},
      { h: 'Port Numbers', p: [
        '3000  — Web UI (open to LAN)',
        '8001  — API (open to LAN)',
        '27017 — MongoDB (localhost only)',
      ]},
      { h: 'Recommended Maintenance', p: [
        'Daily:   confirm daily backup ran',
        'Weekly:  copy latest backup to external drive',
        'Monthly: prune old backups; run Diagnostics; check printer',
        'Yearly:  create config snapshot; roll academic year',
      ]},
    ],
  },
];


/* ---------------- PDF layout helpers ---------------- */

function newPdf() {
  return new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
}

function drawHeader(pdf, title) {
  pdf.setFillColor(COLORS.brandInk);
  pdf.rect(0, 0, A4.w, 12, 'F');
  pdf.setTextColor('#fff');
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9);
  pdf.text('Balaji FeeHub · Installation Manual', MARGIN_L, 8);
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8);
  pdf.text(title, A4.w - MARGIN_R, 8, { align: 'right' });
  pdf.setTextColor(COLORS.text);
}

function drawFooter(pdf, pageN, totalN) {
  pdf.setDrawColor(COLORS.line);
  pdf.line(MARGIN_L, A4.h - 15, A4.w - MARGIN_R, A4.h - 15);
  pdf.setFontSize(8); pdf.setTextColor(COLORS.muted);
  pdf.text('Balaji Convent & Junior College · Butibori, Nagpur', MARGIN_L, A4.h - 10);
  pdf.text(`Page ${pageN} of ${totalN}`, A4.w - MARGIN_R, A4.h - 10, { align: 'right' });
  pdf.setTextColor(COLORS.text);
}

function drawCover(pdf, { appVersion, buildDate, logoDataUrl }) {
  pdf.setFillColor(COLORS.brandInk);
  pdf.rect(0, 0, A4.w, A4.h, 'F');
  // Accent bar
  pdf.setFillColor(COLORS.accent);
  pdf.rect(0, 60, A4.w, 3, 'F');

  if (logoDataUrl) {
    try { pdf.addImage(logoDataUrl, 'JPEG', A4.w/2 - 20, 22, 40, 40); } catch {}
  }

  pdf.setTextColor('#fff');
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(30);
  pdf.text('Balaji FeeHub', A4.w/2, 82, { align: 'center' });
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(13);
  pdf.text('Fee Management System', A4.w/2, 92, { align: 'center' });
  pdf.setFontSize(11);
  pdf.text('Balaji Convent & Junior College · Butibori, Nagpur', A4.w/2, 100, { align: 'center' });

  pdf.setFontSize(9);
  pdf.text('Installation & Administrator Manual', A4.w/2, 125, { align: 'center' });
  pdf.setFontSize(30); pdf.setFont('helvetica', 'bold');
  pdf.text(`Version ${appVersion}`, A4.w/2, 145, { align: 'center' });
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10);
  pdf.text(`Built on ${buildDate}`, A4.w/2, 154, { align: 'center' });

  pdf.setFontSize(8); pdf.setTextColor('#c7d2fe');
  pdf.text('Offline · LAN-based · Auditable · Precise', A4.w/2, A4.h - 25, { align: 'center' });
  pdf.text('© Balaji Convent & Junior College — all rights reserved.', A4.w/2, A4.h - 18, { align: 'center' });

  pdf.setTextColor(COLORS.text);
}

function drawTOC(pdf, tocEntries) {
  pdf.addPage(); drawHeader(pdf, 'Table of Contents');
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(20); pdf.setTextColor(COLORS.brandInk);
  pdf.text('Table of Contents', MARGIN_L, 32);
  pdf.setDrawColor(COLORS.accent); pdf.setLineWidth(0.8);
  pdf.line(MARGIN_L, 35, MARGIN_L + 40, 35);
  pdf.setTextColor(COLORS.text); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(11);
  let y = 48;
  for (const t of tocEntries) {
    pdf.setFont('helvetica', 'bold');
    pdf.text(`Section ${t.n}`, MARGIN_L, y);
    pdf.setFont('helvetica', 'normal');
    pdf.text(t.title, MARGIN_L + 28, y);
    pdf.setTextColor(COLORS.muted);
    const dots = '.'.repeat(Math.max(0, 90 - t.title.length * 1.5));
    pdf.text(dots, MARGIN_L + 28 + pdf.getTextWidth(t.title) + 2, y);
    pdf.setTextColor(COLORS.text);
    pdf.text(String(t.page), A4.w - MARGIN_R, y, { align: 'right' });
    y += 9;
  }
}

function drawSectionTitle(pdf, n, title) {
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(22); pdf.setTextColor(COLORS.brandInk);
  pdf.text(`${n}.`, MARGIN_L, 34);
  pdf.text(title, MARGIN_L + 12, 34);
  pdf.setDrawColor(COLORS.accent); pdf.setLineWidth(1);
  pdf.line(MARGIN_L, 38, MARGIN_L + 40, 38);
  pdf.setTextColor(COLORS.text); pdf.setLineWidth(0.2);
}

function drawBlock(pdf, y, { h, p }) {
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(12);
  pdf.setTextColor(COLORS.accent);
  pdf.text(h, MARGIN_L, y); y += 6;
  pdf.setTextColor(COLORS.text);
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10);
  for (const line of p) {
    // Bullet
    pdf.setFillColor(COLORS.brandInk);
    pdf.circle(MARGIN_L + 1.5, y - 1.5, 0.9, 'F');
    const wrapped = pdf.splitTextToSize(line, CONTENT_W - 6);
    pdf.text(wrapped, MARGIN_L + 5, y);
    y += wrapped.length * 4.6 + 1.6;
  }
  return y + 3;
}


/** Fetch the school logo as a data URL for embedding on the cover. */
async function loadLogoDataUrl() {
  try {
    const r = await fetch('/school-logo.jpeg');
    const blob = await r.blob();
    return await new Promise((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => resolve(null);
      fr.readAsDataURL(blob);
    });
  } catch { return null; }
}


/**
 * Generate the manual and trigger the download.
 */
export async function downloadInstallationManual({ appVersion = '1.0.0', buildDate = 'unknown' } = {}) {
  const pdf = newPdf();
  const logoDataUrl = await loadLogoDataUrl();

  // Cover (page 1)
  drawCover(pdf, { appVersion, buildDate, logoDataUrl });

  // We'll write TOC first with placeholder page numbers, then correct them after
  // We do a two-pass approach: first pass computes page numbers, second pass writes TOC
  // Simpler: assume each section starts on a new page. TOC page is 2. Content starts at page 3.
  const tocEntries = [];
  const pageStarts = {};

  // TOC placeholder page (page 2). We'll fill it AFTER we know the page numbers.
  pdf.addPage(); const TOC_PAGE = pdf.getNumberOfPages();

  // Content
  for (const s of SECTIONS) {
    pdf.addPage(); drawHeader(pdf, s.title);
    drawSectionTitle(pdf, s.n, s.title);
    let y = 50;
    for (const b of s.blocks) {
      // wrap: if less than ~40mm space, add page
      if (y > A4.h - MARGIN_BOT - 25) { pdf.addPage(); drawHeader(pdf, s.title); y = 26; }
      y = drawBlock(pdf, y, b);
    }
    pageStarts[s.n] = pdf.getNumberOfPages() -   // page number for TOC → the page where section STARTS
      (pdf.getNumberOfPages() - pageStarts[s.n] ?? pdf.getNumberOfPages()); // no-op; we compute below
    tocEntries.push({ n: s.n, title: s.title, page: 0 });
  }

  // Compute real page starts by walking the PDF (jsPDF doesn't expose this natively,
  // so we approximate: TOC is page 2, section 1 starts at page 3, and we recorded new pages via addPage before each section).
  // Because each section starts with a fresh addPage(), section N starts at page (TOC_PAGE + N).
  // Additional pages are added mid-section if content overflowed — but the START page is stable.
  for (let i = 0; i < SECTIONS.length; i++) {
    tocEntries[i].page = TOC_PAGE + 1 + i * 1;
    // Note: overflow pages push subsequent sections down. We correct by scanning below.
  }
  // Better computation: track section starts as we render. Redo render with tracking:
  // (Simpler: leave TOC estimated; jsPDF pdf.internal.pages length gives us cumulative pages.)
  // We rebuild the pdf accurately in a single pass now:

  const finalPdf = newPdf();
  drawCover(finalPdf, { appVersion, buildDate, logoDataUrl });
  finalPdf.addPage();   // TOC placeholder
  const finalToc = finalPdf.getNumberOfPages();

  const realTocEntries = [];
  for (const s of SECTIONS) {
    finalPdf.addPage();
    const startPage = finalPdf.getNumberOfPages();
    drawHeader(finalPdf, s.title);
    drawSectionTitle(finalPdf, s.n, s.title);
    let y = 50;
    for (const b of s.blocks) {
      if (y > A4.h - MARGIN_BOT - 25) {
        finalPdf.addPage();
        drawHeader(finalPdf, s.title);
        y = 26;
      }
      y = drawBlock(finalPdf, y, b);
    }
    realTocEntries.push({ n: s.n, title: s.title, page: startPage });
  }

  // Write TOC into the placeholder page
  finalPdf.setPage(finalToc);
  drawHeader(finalPdf, 'Table of Contents');
  finalPdf.setFont('helvetica', 'bold'); finalPdf.setFontSize(20); finalPdf.setTextColor(COLORS.brandInk);
  finalPdf.text('Table of Contents', MARGIN_L, 32);
  finalPdf.setDrawColor(COLORS.accent); finalPdf.setLineWidth(0.8);
  finalPdf.line(MARGIN_L, 35, MARGIN_L + 40, 35);
  finalPdf.setTextColor(COLORS.text); finalPdf.setFont('helvetica', 'normal'); finalPdf.setFontSize(11);
  let ty = 48;
  for (const t of realTocEntries) {
    finalPdf.setFont('helvetica', 'bold');
    finalPdf.text(`Section ${t.n}`, MARGIN_L, ty);
    finalPdf.setFont('helvetica', 'normal');
    finalPdf.text(t.title, MARGIN_L + 28, ty);
    finalPdf.setTextColor(COLORS.text);
    finalPdf.text(String(t.page), A4.w - MARGIN_R, ty, { align: 'right' });
    ty += 9;
  }

  // Draw footers on every page (except cover)
  const total = finalPdf.getNumberOfPages();
  for (let p = 2; p <= total; p++) {
    finalPdf.setPage(p);
    drawFooter(finalPdf, p, total);
  }

  finalPdf.save(`BalajiFeeHub-Installation-Manual-v${appVersion}.pdf`);
}
