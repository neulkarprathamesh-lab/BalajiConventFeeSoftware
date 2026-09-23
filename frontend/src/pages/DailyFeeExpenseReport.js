import React, { useEffect, useState } from 'react';
import api from '@/lib/api';
import { PageHeader, inr } from '@/components/Layout';
import { FileDown, Printer, FileSpreadsheet, FileText } from 'lucide-react';
import { toast } from 'sonner';

// Approved final design: the SAME physical paper as the existing 210x142.8mm
// fee receipt, used portrait (142.8mm wide x 210mm tall) instead of
// landscape. This report is a separate document from the fee receipt —
// nothing here touches ReceiptFrame.js, receipt paper size, or printer config.
const MM_PX = 96 / 25.4;
const PAGE_W_MM = 142.8;
const PAGE_H_MM = 210;

export default function DailyFeeExpenseReport() {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [data, setData] = useState(null);
  const [pdfBusy, setPdfBusy] = useState(false);

  const load = () => api.get('/reports/daily-fee-expense', { params: { date } }).then(r => setData(r.data)).catch(() => setData(null));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [date]);

  // Root cause of the sideways/rotated physical print: this school's printers
  // have no registered custom "142.8 x 210mm" paper size (see 09-printer-setup/
  // README.md - only A4/A5/thermal-80mm are configured), so window.print()'s
  // raw @page CSS size below is not a size any printer driver here recognizes,
  // and different drivers guess/rotate it differently. The server-rendered PDF
  // does not have this problem - its exact 142.8x210mm page geometry is baked
  // directly into the file (verified via its MediaBox), completely independent
  // of any printer driver's paper list. So BOTH "Print" and "Download PDF" now
  // go through that same PDF; autoPrint additionally fires the PDF viewer's own
  // print dialog, which prints that embedded geometry exactly, not a CSS guess.
  const openPdf = async (autoPrint = false) => {
    setPdfBusy(true);
    const win = window.open('', '_blank');
    try {
      const { data: blob } = await api.get('/reports/daily-fee-expense/pdf', { params: { date }, responseType: 'blob' });
      const blobUrl = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
      if (win) {
        win.location.href = blobUrl;
        if (autoPrint) {
          win.addEventListener('load', () => { try { win.print(); } catch (e) {} });
        }
      }
    } catch (e) {
      if (win) win.close();
      toast.error('Could not open the Daily Fee & Expense Report PDF');
    }
    setPdfBusy(false);
  };

  const exportFile = async (format) => {
    try {
      const { data: blob } = await api.get('/reports/daily-fee-expense/export', { params: { date, format }, responseType: 'blob' });
      const mime = format === 'csv' ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      const url = URL.createObjectURL(new Blob([blob], { type: mime }));
      const a = document.createElement('a');
      a.href = url; a.download = `Daily_Fee_Expense_${date}.${format}`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e) { toast.error('Export failed'); }
  };

  if (!data) return <div className="p-6 text-slate-500">Loading…</div>;

  const { fee_collection_summary: fcs, total_summary: ts, school } = data;
  const widthPx = PAGE_W_MM * MM_PX;
  const heightPx = PAGE_H_MM * MM_PX;

  return (
    <>
      <style>{`
        @media print {
          @page { size: ${PAGE_W_MM}mm ${PAGE_H_MM}mm; margin: 0; }
          html, body { background: #fff !important; overflow: hidden !important; }
          body * { visibility: hidden; }
          .dfe-print-target, .dfe-print-target * { visibility: visible; }
          .dfe-print-target { position: absolute; left: 0; top: 0; width: ${PAGE_W_MM}mm; height: ${PAGE_H_MM}mm; box-shadow: none !important; border: 0 !important; }
          .no-print { display: none !important; }
        }
      `}</style>
      <PageHeader title="Daily Fee & Expense Report" subtitle="Professional accounting-style summary — suitable for CA review"
        actions={
          <div className="flex gap-2 no-print items-center">
            <input type="date" value={date} onChange={e => setDate(e.target.value)} className="h-9 px-3 border border-slate-300 rounded text-sm" />
            <button onClick={() => openPdf(true)} disabled={pdfBusy} className="h-9 px-3 border border-slate-300 rounded text-sm flex items-center gap-1.5 hover:bg-slate-100 disabled:opacity-60"><Printer className="w-4 h-4" /> {pdfBusy ? 'Opening…' : 'Print'}</button>
            <button onClick={() => exportFile('csv')} className="h-9 px-3 border border-slate-300 rounded text-sm flex items-center gap-1.5 hover:bg-slate-100"><FileText className="w-4 h-4" /> CSV</button>
            <button onClick={() => exportFile('xlsx')} className="h-9 px-3 border border-slate-300 rounded text-sm flex items-center gap-1.5 hover:bg-slate-100"><FileSpreadsheet className="w-4 h-4" /> Excel</button>
            <button onClick={() => openPdf(false)} disabled={pdfBusy} className="h-9 px-3 bg-emerald-600 text-white rounded text-sm flex items-center gap-1.5 hover:bg-emerald-700 disabled:opacity-60"><FileDown className="w-4 h-4" /> {pdfBusy ? 'Opening…' : 'Download PDF'}</button>
          </div>
        }
      />
      <div className="p-6 flex justify-center bg-slate-100 min-h-[80vh]">
        <div className="dfe-print-target bg-white shadow-lg" style={{ width: widthPx, minHeight: heightPx, padding: '5mm 4mm', fontFamily: 'Helvetica, Arial, sans-serif', color: '#1a1a1a', fontSize: 9, boxSizing: 'border-box' }}>
          <div style={{ textAlign: 'center', borderBottom: '1.5px solid #222', paddingBottom: 6, marginBottom: 8 }}>
            <div style={{ fontSize: 15, fontWeight: 900, letterSpacing: 0.4, textTransform: 'uppercase' }}>{school?.name || 'Balaji Convent'}</div>
            <div style={{ fontSize: 8.5, color: '#333', marginTop: 2 }}>{school?.address}</div>
            <div style={{ fontSize: 8.5, color: '#333' }}>{[school?.phone && `Mob: ${school.phone}`, school?.email && `Email: ${school.email}`].filter(Boolean).join(' | ')}</div>
          </div>
          <div style={{ textAlign: 'center', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 0.8, fontSize: 11, margin: '6px 0 8px' }}>Daily Fee &amp; Expense Report</div>
          <div style={{ fontSize: 8.5, border: '1px solid #ccc', padding: '4px 6px', marginBottom: 10 }}>
            <MetaRow label="Date" value={data.date} />
            <MetaRow label="Academic Year" value={data.academic_year} />
            <MetaRow label="Generated On" value={data.generated_at?.slice(0, 16).replace('T', ' ')} />
            <MetaRow label="User" value={data.generated_by} />
            <MetaRow label="Page" value="1" />
          </div>

          <SectionTitle>A. Fee Collection Summary</SectionTitle>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 8, fontSize: 9 }}>
            <tbody>
              <Row label="Cash Collection" amount={fcs.cash_collection} />
              <Row label="UPI Collection" amount={fcs.upi_collection} />
              {fcs.other_collection > 0 && <Row label="Other Collection" amount={fcs.other_collection} />}
              <Row label="TOTAL FEE COLLECTION" amount={fcs.total_fee_collection} bold />
            </tbody>
          </table>

          <SectionTitle>B. Expenses (Today)</SectionTitle>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 2, fontSize: 7.6, tableLayout: 'fixed' }}>
            <colgroup><col style={{ width: '7%' }} /><col style={{ width: '16%' }} /><col style={{ width: '15%' }} /><col style={{ width: '24%' }} /><col style={{ width: '17%' }} /><col style={{ width: '10%' }} /><col style={{ width: '15%' }} /></colgroup>
            <thead>
              <tr style={{ background: '#eef1f5', border: '1px solid #999' }}>
                <Th>S.No</Th><Th>Exp. No.</Th><Th>Category</Th><Th>Description</Th><Th>Who Brought Bill</Th><Th>Mode</Th><Th right>Amount</Th>
              </tr>
            </thead>
            <tbody>
              {data.expenses.map((e, i) => (
                <tr key={e.expense_no} style={{ borderBottom: '1px solid #ddd' }}>
                  <Td>{i + 1}</Td>
                  <Td mono>{e.expense_no}</Td>
                  <Td>{e.category}</Td>
                  <Td>{e.description}</Td>
                  <Td>{e.who_brought_bill}</Td>
                  <Td upper>{e.payment_mode.replace('_', ' ')}</Td>
                  <Td right mono>{inr(e.amount)}</Td>
                </tr>
              ))}
              {data.expenses.length === 0 && (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: '10px 0', color: '#999', fontSize: 8 }}>No expenses recorded for this date.</td></tr>
              )}
              <tr style={{ background: '#f7f7f7', borderTop: '1.5px solid #333', fontWeight: 'bold' }}>
                <td colSpan={6} style={{ padding: '3px 4px', textAlign: 'right' }}>TOTAL EXPENSES</td>
                <td style={{ padding: '3px 4px', textAlign: 'right', fontFamily: 'monospace' }}>{inr(data.total_expenses)}</td>
              </tr>
            </tbody>
          </table>

          <SectionTitle>C. Total Summary</SectionTitle>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 24, fontSize: 9 }}>
            <tbody>
              <Row label="Total Fee Collection (A)" amount={ts.total_fee_collection} />
              <Row label="Total Expenses (B)" amount={ts.total_expenses} />
              {ts.total_debit_vouchers > 0 && <Row label="Debit Vouchers / Money Out" amount={ts.total_debit_vouchers} />}
              <Row label="NET COLLECTION" amount={ts.net_collection_after_outgoings} bold />
            </tbody>
          </table>

          <table style={{ width: '100%', marginTop: 26 }}>
            <tbody><tr>
              <td style={{ width: '50%', textAlign: 'center', borderTop: '1px solid #333', paddingTop: 4, fontWeight: 'bold', fontSize: 8.5 }}>Cashier</td>
              <td style={{ width: '50%', textAlign: 'center', borderTop: '1px solid #333', paddingTop: 4, fontWeight: 'bold', fontSize: 8.5 }}>Authorised Signatory</td>
            </tr></tbody>
          </table>
          <div style={{ textAlign: 'center', fontSize: 7, color: '#888', marginTop: 10 }}>
            Balaji Convent - School Management System<br />This is a computer generated report.
          </div>
        </div>
      </div>
    </>
  );
}

const SectionTitle = ({ children }) => (
  <div style={{ fontWeight: 'bold', textTransform: 'uppercase', fontSize: 9, background: '#eef1f5', border: '1px solid #999', padding: '3px 5px', margin: '9px 0 4px' }}>{children}</div>
);

const Row = ({ label, amount, bold }) => (
  <tr style={bold ? { background: '#f7f7f7', fontWeight: 'bold', borderTop: '1.5px solid #333' } : { borderBottom: '1px solid #ddd' }}>
    <td style={{ padding: '3px 6px', border: '1px solid #ccc' }}>{label}</td>
    <td style={{ padding: '3px 6px', border: '1px solid #ccc', textAlign: 'right', fontFamily: 'monospace' }}>{inr(amount)}</td>
  </tr>
);

const MetaRow = ({ label, value }) => (
  <div style={{ padding: '1px 0' }}><b style={{ display: 'inline-block', width: 92 }}>{label}:</b> {value}</div>
);

const Th = ({ children, right }) => (
  <th style={{ border: '1px solid #999', padding: '2px 3px', textAlign: right ? 'right' : 'left', fontSize: 6.8 }}>{children}</th>
);
const Td = ({ children, right, mono, upper }) => (
  <td style={{ border: '1px solid #ddd', padding: '2px 3px', textAlign: right ? 'right' : 'left', fontFamily: mono ? 'monospace' : undefined, textTransform: upper ? 'uppercase' : undefined, wordBreak: 'break-word' }}>{children}</td>
);
