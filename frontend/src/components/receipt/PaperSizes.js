/**
 * Paper size registry — dimensions in millimetres.
 * Add a new entry here and it becomes available everywhere in the receipt engine.
 */
export const PAPER_SIZES = {
  A5:            { label: 'A5 (Portrait)',   w: 148, h: 210, orientation: 'portrait', print: 'A5 portrait' },
  A5_LANDSCAPE:  { label: 'A5 (Landscape)',  w: 210, h: 148, orientation: 'landscape', print: 'A5 landscape' },
  A4:            { label: 'A4 (Portrait)',   w: 210, h: 297, orientation: 'portrait', print: 'A4 portrait' },
  A4_LANDSCAPE:  { label: 'A4 (Landscape)',  w: 297, h: 210, orientation: 'landscape', print: 'A4 landscape' },
  LEGAL:         { label: 'Legal',           w: 216, h: 356, orientation: 'portrait', print: 'legal portrait' },
  LETTER:        { label: 'Letter',          w: 216, h: 279, orientation: 'portrait', print: 'letter portrait' },
  THERMAL80:     { label: 'Thermal 80mm',    w: 80,  h: 200, orientation: 'portrait', print: '80mm 200mm' },
  RECEIPT_142:   { label: 'Fee Receipt (210 x 142.8mm)', w: 210, h: 142.8, orientation: 'landscape', print: '210mm 142.8mm' },
};

export const DEFAULT_PAPER = 'A5';

/** 1 mm on screen at 96 DPI (standard browser). */
export const MM_PX = 96 / 25.4;

export const paperCss = (key) => {
  const p = PAPER_SIZES[key] || PAPER_SIZES[DEFAULT_PAPER];
  return { widthMm: p.w, heightMm: p.h, printSize: p.print };
};

export const paperOptions = () => Object.entries(PAPER_SIZES).map(([k, v]) => ({ value: k, label: v.label }));

/**
 * Application-level paper sources — the ONLY three choices FeeHub exposes.
 * Never a raw dump of every Windows/Chromium driver paper size. Each maps to a
 * physical media page size (pageSizeName, sent to the driver) + the outer media
 * key used to letterbox the fixed 210×142.8mm receipt artwork inside it.
 */
export const PAPER_SOURCES = {
  SPECIAL: { label: 'Special Receipt (210 × 142.8 mm on A5)', pageSizeName: 'A5', outerPaper: 'A5_LANDSCAPE', landscape: true },
  A5:      { label: 'A5 (210 × 148 mm)',                       pageSizeName: 'A5', outerPaper: 'A5_LANDSCAPE', landscape: true },
  A4:      { label: 'A4 (210 × 297 mm)',                       pageSizeName: 'A4', outerPaper: 'A4_LANDSCAPE', landscape: true },
};
export const DEFAULT_PAPER_SOURCE = 'SPECIAL';
export const resolvePaperSource = (k) => PAPER_SOURCES[k] || PAPER_SOURCES[DEFAULT_PAPER_SOURCE];
export const paperSourceOptions = () => [
  { value: 'A4', label: 'A4' },
  { value: 'A5', label: 'A5' },
  { value: 'SPECIAL', label: 'Special Receipt' },
];
