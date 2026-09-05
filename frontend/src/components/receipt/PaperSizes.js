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
