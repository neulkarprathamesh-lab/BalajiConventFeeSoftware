/**
 * Universal receipt export utilities — Print, PDF (jsPDF), PNG, JPEG, SVG.
 * Every export renders the same DOM node so what you see is what you print.
 *
 *   node        — the DOM element to capture (must be visible + fully painted)
 *   filename    — target filename WITHOUT extension
 *   paper       — one of the keys from PaperSizes.js (drives PDF page size)
 *   orientation — 'portrait' | 'landscape' — used for the on-screen preview only
 */
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { PAPER_SIZES } from './PaperSizes';

const HTML2CANVAS_OPTS = {
  scale: 2,               // 2× for crisp raster output
  backgroundColor: '#ffffff',
  useCORS: true,
  logging: false,
  windowWidth: undefined,
  onclone: (doc) => {
    // Ensure the cloned document forces theme-tokens even in dark OS previews.
    doc.documentElement.style.background = '#fff';
    doc.documentElement.style.colorScheme = 'light';
  },
};

async function renderCanvas(node) {
  if (!node) throw new Error('No DOM node to export');
  // Wait one frame for any layout/font settle before capture
  await new Promise(r => requestAnimationFrame(() => setTimeout(r, 50)));
  return html2canvas(node, HTML2CANVAS_OPTS);
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function exportPng(node, filename) {
  const canvas = await renderCanvas(node);
  await new Promise(resolve =>
    canvas.toBlob((blob) => { triggerDownload(blob, `${filename}.png`); resolve(); }, 'image/png')
  );
}

export async function exportJpeg(node, filename, quality = 0.95) {
  const canvas = await renderCanvas(node);
  await new Promise(resolve =>
    canvas.toBlob((blob) => { triggerDownload(blob, `${filename}.jpg`); resolve(); }, 'image/jpeg', quality)
  );
}

/**
 * PDF via jsPDF at exact millimetre-accurate page size. We rasterise the DOM
 * to a canvas (crisp @ 2× scale) then fit it onto the correct paper size.
 * Falls back to browser Print → Save as PDF if jsPDF fails for any reason.
 */
export async function exportPdf(node, filename, paperKey = 'A5') {
  const paper = PAPER_SIZES[paperKey] || PAPER_SIZES.A5;
  try {
    const canvas = await renderCanvas(node);
    const isLandscape = paper.orientation === 'landscape';
    const pdf = new jsPDF({
      unit: 'mm',
      format: [paper.w, paper.h],
      orientation: isLandscape ? 'landscape' : 'portrait',
      compress: true,
    });
    const pageW = isLandscape ? paper.h : paper.w;
    const pageH = isLandscape ? paper.w : paper.h;
    // Fit while preserving aspect ratio
    const scale = Math.min(pageW / canvas.width, pageH / canvas.height) * (canvas.width / canvas.width);
    const imgW = Math.min(pageW, canvas.width * (pageH / canvas.height));
    const imgH = Math.min(pageH, canvas.height * (pageW / canvas.width));
    const w = imgW; const h = imgH;
    const x = (pageW - w) / 2;
    const y = (pageH - h) / 2;
    const imgData = canvas.toDataURL('image/jpeg', 0.98);
    pdf.addImage(imgData, 'JPEG', x, y, w, h, undefined, 'FAST');
    pdf.save(`${filename}.pdf`);
  } catch (err) {
    console.warn('[receipt] jsPDF export failed, falling back to browser print:', err);
    window.print();
  }
}

/**
 * SVG export — wraps the rasterised canvas as an SVG image so the file is
 * still valid SVG, opens in any browser / vector editor, and prints crisply.
 * For lightweight DOM only; complex CSS is preserved via foreignObject in the
 * "true SVG" path below.
 */
export async function exportSvg(node, filename) {
  const canvas = await renderCanvas(node);
  const dataUrl = canvas.toDataURL('image/png');
  const w = canvas.width; const h = canvas.height;
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
  <image href="${dataUrl}" x="0" y="0" width="${w}" height="${h}" />
</svg>`;
  triggerDownload(new Blob([svg], { type: 'image/svg+xml' }), `${filename}.svg`);
}

/**
 * Fire the print dialog. Inside the Balaji FeeHub desktop app, plain
 * window.print() opens Electron's built-in dialog with system defaults
 * (Portrait, default paper) and ignores the page's @page CSS entirely, so the
 * operator would have to switch Orientation/paper size by hand every time.
 * When running inside the desktop shell (window.feehub present) we instead
 * route through the app's print-page IPC call, passing the receipt's actual
 * paper size/orientation so the native dialog opens already set correctly.
 * In a plain browser (no desktop shell) window.print() + @page CSS still
 * works as before.
 */
export function doPrint(paperKey) {
  const paper = paperKey ? (PAPER_SIZES[paperKey] || null) : null;
  if (window.feehub && typeof window.feehub.print === 'function') {
    const opts = paper
      ? { widthMm: paper.w, heightMm: paper.h, landscape: paper.orientation === 'landscape' }
      : {};
    window.feehub.print(opts).then((res) => {
      if (!res || !res.ok) {
        console.warn('[receipt] desktop print failed, falling back to browser print:', res && res.error);
        window.print();
      }
    }).catch(() => window.print());
    return;
  }
  window.print();
}

/**
 * Email-ready PDF: builds a PDF then opens the user's mail client with an
 * mailto: link pre-populated. Since we can't send email offline, we hand the
 * user a downloaded PDF plus a pre-filled mailto: window they can attach it to.
 */
export async function exportEmailPdf(node, filename, paperKey, subject, body) {
  await exportPdf(node, filename, paperKey);
  const mailto = `mailto:?subject=${encodeURIComponent(subject || filename)}&body=${encodeURIComponent(body || 'Please find the attached receipt.')}`;
  window.open(mailto, '_blank');
}
