import React, { useEffect, useState } from 'react';
import ReceiptEngine from '@/components/receipt/ReceiptEngine';
import { MM_PX } from '@/components/receipt/PaperSizes';

/**
 * PrintLab — a no-auth harness used ONLY to render the authoritative receipt
 * renderer with representative data at the exact print geometry (RECEIPT_142
 * artwork letterboxed onto A5 landscape) so the receipt geometry can be
 * measured in real millimetres. Not part of the cashier workflow.
 */
const mockLines = [
  { fee_head_name: 'Admission Fee', total_amount: 4000, paid_amount: 4000, balance_amount: 0 },
  { fee_head_name: 'Continuation Fee', total_amount: 1000, paid_amount: 1000, balance_amount: 0 },
  { fee_head_name: 'Tuition Fee', total_amount: 1000, paid_amount: 1000, balance_amount: 0 },
  { fee_head_name: 'Other Fee (Laboratory & Library)', total_amount: 1000, paid_amount: 500, balance_amount: 500 },
  { fee_head_name: 'Computer Fee', total_amount: 1000, paid_amount: 1000, balance_amount: 0 },
  { fee_head_name: 'Other Labs', total_amount: 1000, paid_amount: 1000, balance_amount: 0 },
];

const mockReceipt = {
  id: 'test-0001-abcd',
  number: 'P-1584',
  receipt_type: 'fee',
  created_at: new Date().toISOString(),
  academic_year: '2026-2027',
  department_name: 'Marathi Primary (Nursery to 5)',
  department_header1: 'BALAJI CONVENT',
  department_header2: 'MARATHI PRIMARY SCHOOL',
  payer_name: 'Shri. Ramesh Kumar Deshpande',
  payment_mode: 'Cash',
  payment_reference: 'CASH / 2026',
  amount_in_words: 'Eight Thousand Five Hundred Only',
  total: 8500,
  remarks: '',
  cashier_name: 'Administrator',
  student_id: 'stu-1',
  lines: mockLines,
  student_snapshot: {
    name: 'Aaradhya Ramesh Deshpande',
    admission_no: 'ADM-2026-00123',
    class_name: '5th', section: 'A', roll_no: '21',
    father_name: 'Ramesh Kumar Deshpande',
    mother_name: 'Sunita Ramesh Deshpande',
    guardian_mobile: '9876543210',
    medium: 'Marathi',
  },
  metadata: {},
};

const mockReceiptType = {
  paper_size: 'RECEIPT_142',
  theme: 'bw',
  barcode_enabled: true,
  qr_enabled: true,
  watermark_enabled: true,
  signature_area_enabled: true,
};

const mockSettings = {
  school_address: 'Butibori, Nagpur – 441122, Maharashtra',
  school_phone: '0712-1234567',
  school_email: 'info@balajiconventbutibori.edu.in',
  school_website: 'www.balajiconventbutibori.edu.in',
};

export default function PrintLab() {
  const [report, setReport] = useState(null);
  const params = new URLSearchParams(window.location.search);
  const type = params.get('type') || 'fee';
  const r = { ...mockReceipt, receipt_type: type };
  if (type === 'bus') { r.number = 'BUS-221'; }
  if (type === 'debit_voucher') {
    r.number = 'DV-042'; r.payer_name = 'ABC Stationers'; r.amount_in_words = 'Two Thousand Only'; r.total = 2000;
    r.lines = [
      { fee_head_name: 'Printing paper (A5) 5 reams', total_amount: 1500, paid_amount: 1500, balance_amount: 0, quantity: '5 reams', rate: 300, amount: 1500 },
      { fee_head_name: 'Toner refill', total_amount: 500, paid_amount: 500, balance_amount: 0, quantity: '1', rate: 500, amount: 500 },
    ];
  }

  useEffect(() => {
    const measure = () => {
      const frame = document.querySelector('[data-testid="receipt-frame"]');
      if (!frame) return;
      const contentH = frame.scrollHeight;   // full content height incl. overflow
      const clientH = frame.clientHeight;
      const widthMm = frame.getBoundingClientRect().width / MM_PX;
      const contentMm = contentH / MM_PX;
      const clientMm = clientH / MM_PX;
      const rep = {
        widthMm: +widthMm.toFixed(2),
        contentHeightMm: +contentMm.toFixed(2),
        boxHeightMm: +clientMm.toFixed(2),
        fitsIn142_8: contentMm <= 142.8 + 0.3,
        overflowMm: +(contentMm - 142.8).toFixed(2),
      };
      setReport(rep);
      // eslint-disable-next-line no-console
      console.log('PRINTLAB_MEASURE ' + JSON.stringify(rep));
      window.__printLabReport = rep;
    };
    const t = setTimeout(measure, 900);
    return () => clearTimeout(t);
  }, []);

  return (
    <div style={{ padding: 16, background: '#334155', minHeight: '100vh' }}>
      <div data-testid="printlab-report" style={{ color: '#fff', fontFamily: 'monospace', marginBottom: 12 }}>
        {report ? (
          <span style={{ color: report.fitsIn142_8 ? '#4ade80' : '#f87171' }}>
            width={report.widthMm}mm content={report.contentHeightMm}mm target=142.80mm overflow={report.overflowMm}mm fits={String(report.fitsIn142_8)}
          </span>
        ) : 'measuring…'}
      </div>
      <ReceiptEngine
        r={r}
        receiptType={{ ...mockReceiptType, watermark_enabled: type !== 'debit_voucher' }}
        settings={mockSettings}
        balance={{ amount: 500, loading: false, staleYear: false }}
        showControls={false}
        minimalPrint
        outerPaper="A5_LANDSCAPE"
      />
    </div>
  );
}
