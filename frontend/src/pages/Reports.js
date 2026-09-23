import React, { useEffect, useState } from 'react';
import api from '@/lib/api';
import { PageHeader, inr } from '@/components/Layout';
import { useAuth } from '@/context/AuthContext';
import { toast } from 'sonner';
import { Printer, FileDown, Wallet, History, Receipt } from 'lucide-react';

const STREAMS = ['Arts', 'Commerce', 'Science', 'Bi-Focal'];

export default function Reports() {
  const today = new Date().toISOString().slice(0,10);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [depts, setDepts] = useState([]);
  const [dept, setDept] = useState('');
  const [receiptTypes, setReceiptTypes] = useState([]);
  const [receiptTypeId, setReceiptTypeId] = useState('');
  const [cashiers, setCashiers] = useState([]);
  const [cashierId, setCashierId] = useState('');
  const [data, setData] = useState(null);

  useEffect(() => {
    api.get('/departments').then(r => setDepts(r.data));
    // include_disabled/include_archived so a historical filter selection never
    // silently disappears — this is a read-only report filter, not a picker
    // for issuing new receipts, so a disabled/archived type is still valid here.
    api.get('/receipt-types?include_disabled=true&include_archived=true').then(r => setReceiptTypes(r.data || []));
    // Dynamically derived from who has actually issued a receipt - never a
    // hard-coded name list.
    api.get('/reports/collection/cashiers').then(r => setCashiers(r.data || [])).catch(() => {});
  }, []);

  const collectionParams = () => {
    const p = new URLSearchParams({ date_from: from, date_to: to });
    if (dept) p.set('department_id', dept);
    if (receiptTypeId) p.set('receipt_type_id', receiptTypeId);
    if (cashierId) p.set('cashier_id', cashierId);
    return p;
  };
  const run = () => {
    api.get(`/reports/collection?${collectionParams()}`).then(r => setData(r.data));
  };
  useEffect(() => { run(); }, []); // eslint-disable-line

  const [collectionBusy, setCollectionBusy] = useState(false);
  const downloadCollectionReport = async (format) => {
    setCollectionBusy(true);
    const win = format === 'pdf' ? window.open('', '_blank') : null;
    try {
      const p = collectionParams(); p.set('format', format);
      const { data: blob } = await api.get(`/reports/collection?${p}`, { responseType: 'blob' });
      const blobUrl = URL.createObjectURL(new Blob([blob]));
      if (format === 'pdf') { if (win) win.location.href = blobUrl; }
      else { const a = document.createElement('a'); a.href = blobUrl; a.download = `Collection_Report_${from}_${to}.xlsx`; document.body.appendChild(a); a.click(); a.remove(); }
    } catch (e) { if (win) win.close(); toast.error('Could not generate the report'); }
    finally { setCollectionBusy(false); }
  };

  const [exportBusy, setExportBusy] = useState(false);
  const exportDailyFeeExpense = async () => {
    // The Collection Report above covers a date RANGE; the Daily Fee & Expense
    // Report is inherently a single day's accounting summary, so it is always
    // generated for the "From" date currently selected here.
    setExportBusy(true);
    const win = window.open('', '_blank');
    try {
      const { data: blob } = await api.get('/reports/daily-fee-expense/pdf', { params: { date: from }, responseType: 'blob' });
      const blobUrl = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
      if (win) win.location.href = blobUrl;
    } catch (e) {
      if (win) win.close();
      toast.error('Could not generate the Daily Fee & Expense Report');
    }
    setExportBusy(false);
  };

  return (
    <>
      <PageHeader title="Reports" subtitle="Collection reports · reconcile with cash / bank"
        actions={
          <div className="flex gap-2 no-print">
            <button onClick={() => window.print()} className="h-9 px-3 border border-slate-300 rounded text-sm hover:bg-slate-50 flex items-center gap-1.5"><Printer className="w-4 h-4" /> Print</button>
            <button onClick={exportDailyFeeExpense} disabled={exportBusy} title={`Daily Fee & Expense Report for ${from}`} className="h-9 px-3 bg-slate-900 text-white rounded text-sm flex items-center gap-1.5 hover:bg-slate-800 disabled:opacity-60"><FileDown className="w-4 h-4" /> {exportBusy ? 'Exporting…' : 'Export'}</button>
          </div>
        }
      />
      <div className="p-6 space-y-4">
        <div className="bg-white border border-slate-200 rounded p-4 flex flex-wrap gap-3 items-end no-print">
          <div><div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">From</div><input type="date" value={from} onChange={e=>setFrom(e.target.value)} className="h-9 px-3 border border-slate-300 rounded text-sm" /></div>
          <div><div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">To</div><input type="date" value={to} onChange={e=>setTo(e.target.value)} className="h-9 px-3 border border-slate-300 rounded text-sm" /></div>
          <div><div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">Receipt Type</div>
            <select data-testid="report-receipt-type" value={receiptTypeId} onChange={e=>setReceiptTypeId(e.target.value)} className="h-9 px-3 border border-slate-300 rounded text-sm bg-white">
              <option value="">All Receipt Types</option>
              {receiptTypes.map(t => <option key={t.id} value={t.id}>{t.code} — {t.name}</option>)}
            </select>
          </div>
          <div><div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">Department</div>
            <select value={dept} onChange={e=>setDept(e.target.value)} className="h-9 px-3 border border-slate-300 rounded text-sm bg-white"><option value="">All</option>{depts.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select>
          </div>
          <div><div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">Issued/Printed By</div>
            <select data-testid="report-cashier" value={cashierId} onChange={e=>setCashierId(e.target.value)} className="h-9 px-3 border border-slate-300 rounded text-sm bg-white">
              <option value="">All</option>
              {cashiers.map(c => <option key={c.cashier_id} value={c.cashier_id}>{c.cashier_name}</option>)}
            </select>
          </div>
          <button onClick={run} className="h-9 px-4 bg-slate-900 text-white rounded text-sm">Run</button>
          <button onClick={() => downloadCollectionReport('pdf')} disabled={collectionBusy} data-testid="report-collection-pdf" className="h-9 px-3 border border-slate-300 rounded text-sm flex items-center gap-1.5 hover:bg-slate-50 disabled:opacity-60"><FileDown className="w-4 h-4" /> PDF</button>
          <button onClick={() => downloadCollectionReport('xlsx')} disabled={collectionBusy} data-testid="report-collection-xlsx" className="h-9 px-3 border border-slate-300 rounded text-sm flex items-center gap-1.5 hover:bg-slate-50 disabled:opacity-60"><FileDown className="w-4 h-4" /> Excel</button>
        </div>

        {data && <>
          <div className="text-[12px] text-slate-600">
            <span className="font-semibold">Receipt Type:</span> {data.receipt_type_label || 'All Receipt Types'} &middot; <span className="font-semibold">Issued/Printed By:</span> {data.cashier_label || 'All'}
          </div>

          <div className="grid grid-cols-4 gap-4">
            <Card label="Gross Collection" value={inr(data.gross_collection)} tone="text-emerald-700" />
            <Card label="Refunds" value={inr(data.refunds)} tone="text-red-700" />
            <Card label="Vouchers Out" value={inr(data.vouchers)} tone="text-red-700" />
            <Card label="Net" value={inr(data.net)} tone="text-blue-700" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="bg-white border border-slate-200 rounded">
              <div className="px-4 py-2 border-b border-slate-200 font-heading font-medium text-sm">By Payment Mode</div>
              <table className="w-full dense-table"><tbody>
                {Object.entries(data.by_mode).map(([k,v]) => <tr key={k}><td className="uppercase text-[12px]">{k}</td><td className="text-right tabular font-medium">{inr(v)}</td></tr>)}
                {Object.keys(data.by_mode).length===0 && <tr><td colSpan="2" className="text-center py-4 text-slate-500 text-sm">No data</td></tr>}
              </tbody></table>
            </div>
            <div className="bg-white border border-slate-200 rounded">
              <div className="px-4 py-2 border-b border-slate-200 font-heading font-medium text-sm">By Receipt Type</div>
              <table className="w-full dense-table"><tbody>
                {Object.entries(data.by_type).map(([k,v]) => <tr key={k}><td className="capitalize text-[12px]">{k.replace('_',' ')}</td><td className="text-right tabular font-medium">{inr(v)}</td></tr>)}
                {Object.keys(data.by_type).length===0 && <tr><td colSpan="2" className="text-center py-4 text-slate-500 text-sm">No data</td></tr>}
              </tbody></table>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 font-heading font-medium">Transactions ({data.count})</div>
            <table className="w-full dense-table">
              <thead><tr className="text-left text-[11px] uppercase tracking-wide text-slate-600"><th>Receipt</th><th>Type</th><th>Payer</th><th>Dept</th><th>Mode</th><th className="text-right">Amount</th><th>Cashier</th></tr></thead>
              <tbody>
                {data.rows.map(r => (
                  <tr key={r.id}><td className="font-mono text-[12px]">{r.number}</td><td className="capitalize text-[12px]">{r.receipt_type?.replace('_',' ')}</td><td>{r.payer_name}</td><td>{r.department_code}</td><td className="uppercase text-[11px]">{r.payment_mode}</td><td className="text-right tabular font-medium">{inr(r.total)}</td><td className="text-[12px]">{r.cashier_name}</td></tr>
                ))}
                {data.rows.length===0 && <tr><td colSpan="7" className="text-center py-6 text-slate-500 text-sm">No transactions for this filter</td></tr>}
              </tbody>
            </table>
          </div>
        </>}

        <StudentFeeBalanceReport />
        <FeeEditHistoryReport />
        <VoucherReport />
      </div>
    </>
  );
}

function StudentFeeBalanceReport() {
  const [academicYear, setAcademicYear] = useState('2026-27');
  const [classes, setClasses] = useState([]);
  const [classId, setClassId] = useState('');
  const [section, setSection] = useState('');
  const [medium, setMedium] = useState('');
  const [stream, setStream] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.get('/classes').then(r => setClasses(r.data || [])); }, []);

  const params = () => {
    const p = new URLSearchParams({ academic_year: academicYear });
    if (classId) p.set('class_id', classId);
    if (section) p.set('section', section);
    if (medium) p.set('medium', medium);
    if (stream) p.set('stream', stream);
    return p;
  };

  const isSeniorClass = classes.find(c => c.id === classId)?.name?.match(/^(11|12)/);

  const download = async (format) => {
    setBusy(true);
    const win = format === 'pdf' ? window.open('', '_blank') : null;
    try {
      const p = params(); p.set('format', format);
      const { data: blob } = await api.get(`/reports/student-fee-balance?${p}`, { responseType: 'blob' });
      const blobUrl = URL.createObjectURL(new Blob([blob]));
      if (format === 'pdf') { if (win) win.location.href = blobUrl; }
      else { const a = document.createElement('a'); a.href = blobUrl; a.download = 'Student_Fee_Balance.xlsx'; document.body.appendChild(a); a.click(); a.remove(); }
    } catch (e) { if (win) win.close(); toast.error('Could not generate the report'); }
    finally { setBusy(false); }
  };

  return (
    <div className="bg-white border border-slate-200 rounded p-4 space-y-3 no-print">
      <div className="font-heading font-semibold flex items-center gap-2"><Wallet className="w-4 h-4 text-blue-700" /> Student Fee Balance Report</div>
      <div className="flex flex-wrap gap-3 items-end">
        <div><div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">Academic Year</div><input value={academicYear} onChange={e=>setAcademicYear(e.target.value)} className="h-9 px-2 border border-slate-300 rounded text-sm w-24" /></div>
        <div><div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">Class</div>
          <select data-testid="sfb-class" value={classId} onChange={e=>setClassId(e.target.value)} className="h-9 px-2 border border-slate-300 rounded text-sm bg-white">
            <option value="">All Classes</option>
            {classes.map(c => <option key={c.id} value={c.id}>{c.name}{c.medium ? ` · ${c.medium}` : ''}{c.stream ? ` · ${c.stream}` : ''}</option>)}
          </select>
        </div>
        <div><div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">Section</div><input value={section} onChange={e=>setSection(e.target.value)} className="h-9 px-2 border border-slate-300 rounded text-sm w-20" /></div>
        <div><div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">Medium</div><input value={medium} onChange={e=>setMedium(e.target.value)} className="h-9 px-2 border border-slate-300 rounded text-sm w-32" /></div>
        {isSeniorClass && (
          <div><div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">Stream</div>
            <select data-testid="sfb-stream" value={stream} onChange={e=>setStream(e.target.value)} className="h-9 px-2 border border-slate-300 rounded text-sm bg-white">
              <option value="">All Streams</option>
              {STREAMS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        )}
        <button onClick={() => download('pdf')} disabled={busy} data-testid="sfb-pdf" className="h-9 px-3 bg-slate-900 text-white rounded text-sm flex items-center gap-1.5 hover:bg-slate-800 disabled:opacity-60"><FileDown className="w-4 h-4" /> PDF</button>
        <button onClick={() => download('xlsx')} disabled={busy} data-testid="sfb-xlsx" className="h-9 px-3 border border-slate-300 rounded text-sm flex items-center gap-1.5 hover:bg-slate-50 disabled:opacity-60"><FileDown className="w-4 h-4" /> Excel</button>
      </div>
      <div className="text-[11px] text-slate-500">Per-student pending School Fee for the selected class/group, live from the actual fee ledger, with a grand total.</div>
    </div>
  );
}

function FeeEditHistoryReport() {
  const { user } = useAuth();
  const [studentName, setStudentName] = useState('');
  const [admissionNo, setAdmissionNo] = useState('');
  const [className, setClassName] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [editedBy, setEditedBy] = useState('');
  const [feeType, setFeeType] = useState('');
  const [busy, setBusy] = useState(false);

  if (!['administrator', 'manager'].includes(user?.role)) return null;

  const params = () => {
    const p = new URLSearchParams();
    if (studentName) p.set('student_name', studentName);
    if (admissionNo) p.set('admission_no', admissionNo);
    if (className) p.set('class_name', className);
    if (dateFrom) p.set('date_from', dateFrom);
    if (dateTo) p.set('date_to', dateTo);
    if (editedBy) p.set('edited_by', editedBy);
    if (feeType) p.set('fee_type', feeType);
    return p;
  };

  const download = async (format) => {
    setBusy(true);
    const win = format === 'pdf' ? window.open('', '_blank') : null;
    try {
      const p = params(); p.set('format', format);
      const { data: blob } = await api.get(`/reports/fee-edit-history?${p}`, { responseType: 'blob' });
      const blobUrl = URL.createObjectURL(new Blob([blob]));
      if (format === 'pdf') { if (win) win.location.href = blobUrl; }
      else { const a = document.createElement('a'); a.href = blobUrl; a.download = 'Fee_Edit_History.xlsx'; document.body.appendChild(a); a.click(); a.remove(); }
    } catch (e) { if (win) win.close(); toast.error('Could not generate the report'); }
    finally { setBusy(false); }
  };

  return (
    <div className="bg-white border border-slate-200 rounded p-4 space-y-3 no-print">
      <div className="font-heading font-semibold flex items-center gap-2"><History className="w-4 h-4 text-blue-700" /> Fee Edit History</div>
      <div className="flex flex-wrap gap-3 items-end">
        <div><div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">Student Name</div><input value={studentName} onChange={e=>setStudentName(e.target.value)} className="h-9 px-2 border border-slate-300 rounded text-sm w-36" /></div>
        <div><div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">Admission No.</div><input value={admissionNo} onChange={e=>setAdmissionNo(e.target.value)} className="h-9 px-2 border border-slate-300 rounded text-sm w-28" /></div>
        <div><div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">Class</div><input value={className} onChange={e=>setClassName(e.target.value)} className="h-9 px-2 border border-slate-300 rounded text-sm w-24" /></div>
        <div><div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">Date From</div><input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)} className="h-9 px-2 border border-slate-300 rounded text-sm" /></div>
        <div><div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">Date To</div><input type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)} className="h-9 px-2 border border-slate-300 rounded text-sm" /></div>
        <div><div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">Edited By</div><input value={editedBy} onChange={e=>setEditedBy(e.target.value)} placeholder="email" className="h-9 px-2 border border-slate-300 rounded text-sm w-36" /></div>
        <div><div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">Fee Type</div>
          <select value={feeType} onChange={e=>setFeeType(e.target.value)} className="h-9 px-2 border border-slate-300 rounded text-sm bg-white">
            <option value="">All</option><option value="school">School Fee</option><option value="bus">Bus Fee</option>
          </select>
        </div>
        <button onClick={() => download('pdf')} disabled={busy} data-testid="feh-pdf" className="h-9 px-3 bg-slate-900 text-white rounded text-sm flex items-center gap-1.5 hover:bg-slate-800 disabled:opacity-60"><FileDown className="w-4 h-4" /> PDF</button>
        <button onClick={() => download('xlsx')} disabled={busy} data-testid="feh-xlsx" className="h-9 px-3 border border-slate-300 rounded text-sm flex items-center gap-1.5 hover:bg-slate-50 disabled:opacity-60"><FileDown className="w-4 h-4" /> Excel</button>
      </div>
      <div className="text-[11px] text-slate-500">Who changed a student's fee, when, what changed, and why — built from the real audit trail.</div>
    </div>
  );
}

function VoucherReport() {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [voucherNo, setVoucherNo] = useState('');
  const [createdBy, setCreatedBy] = useState('');
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);

  const params = () => {
    const p = new URLSearchParams();
    if (dateFrom) p.set('date_from', dateFrom);
    if (dateTo) p.set('date_to', dateTo);
    if (voucherNo) p.set('voucher_no', voucherNo);
    if (createdBy) p.set('created_by', createdBy);
    return p;
  };

  const run = () => { api.get(`/reports/vouchers?${params()}`).then(r => setData(r.data)).catch(() => setData(null)); };
  useEffect(() => { run(); }, []); // eslint-disable-line

  const download = async (format) => {
    setBusy(true);
    const win = format === 'pdf' ? window.open('', '_blank') : null;
    try {
      const p = params();
      const url = format === 'pdf' ? `/reports/vouchers/pdf?${p}` : `/reports/vouchers/export?${p}&format=xlsx`;
      const { data: blob } = await api.get(url, { responseType: 'blob' });
      const blobUrl = URL.createObjectURL(new Blob([blob]));
      if (format === 'pdf') { if (win) win.location.href = blobUrl; }
      else { const a = document.createElement('a'); a.href = blobUrl; a.download = 'Debit_Voucher_Report.xlsx'; document.body.appendChild(a); a.click(); a.remove(); }
    } catch (e) { if (win) win.close(); toast.error('Could not generate the Voucher Report'); }
    finally { setBusy(false); }
  };

  return (
    <div className="bg-white border border-slate-200 rounded p-4 space-y-3 no-print" data-testid="voucher-report">
      <div className="font-heading font-semibold flex items-center gap-2"><Receipt className="w-4 h-4 text-red-700" /> Debit Voucher Report</div>
      <div className="flex flex-wrap gap-3 items-end">
        <div><div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">From</div><input type="date" data-testid="vr-from" value={dateFrom} onChange={e=>setDateFrom(e.target.value)} className="h-9 px-2 border border-slate-300 rounded text-sm" /></div>
        <div><div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">To</div><input type="date" data-testid="vr-to" value={dateTo} onChange={e=>setDateTo(e.target.value)} className="h-9 px-2 border border-slate-300 rounded text-sm" /></div>
        <div><div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">Voucher No.</div><input data-testid="vr-voucher-no" value={voucherNo} onChange={e=>setVoucherNo(e.target.value)} className="h-9 px-2 border border-slate-300 rounded text-sm w-32" /></div>
        <div><div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">Created By</div><input data-testid="vr-created-by" value={createdBy} onChange={e=>setCreatedBy(e.target.value)} className="h-9 px-2 border border-slate-300 rounded text-sm w-32" /></div>
        <button onClick={run} data-testid="vr-search" className="h-9 px-3 bg-slate-900 text-white rounded text-sm hover:bg-slate-800">Search</button>
        <button onClick={() => download('pdf')} disabled={busy} data-testid="vr-pdf" className="h-9 px-3 border border-slate-300 rounded text-sm flex items-center gap-1.5 hover:bg-slate-50 disabled:opacity-60"><FileDown className="w-4 h-4" /> PDF</button>
        <button onClick={() => download('xlsx')} disabled={busy} data-testid="vr-xlsx" className="h-9 px-3 border border-slate-300 rounded text-sm flex items-center gap-1.5 hover:bg-slate-50 disabled:opacity-60"><FileDown className="w-4 h-4" /> Excel</button>
      </div>
      {data && (
        <div className="border border-slate-200 rounded overflow-hidden">
          <table className="w-full dense-table" data-testid="vr-table">
            <thead><tr className="text-left text-[11px] uppercase tracking-wide text-slate-600"><th>S.No</th><th>Voucher No.</th><th>Date</th><th>Description</th><th>Created By</th><th className="text-right">Amount</th></tr></thead>
            <tbody>
              {data.rows.map((v, i) => (
                <tr key={v.id}><td>{i + 1}</td><td className="font-mono text-[12px]">{v.voucher_no}</td><td>{v.date}</td><td>{v.description}</td><td>{v.created_by}</td><td className="text-right tabular font-medium">{inr(v.amount)}</td></tr>
              ))}
              {data.rows.length === 0 && <tr><td colSpan="6" className="text-center py-6 text-slate-500 text-sm">No debit vouchers for this filter</td></tr>}
            </tbody>
            <tfoot><tr className="font-semibold border-t border-slate-300"><td colSpan="5" className="text-right py-2 pr-2">TOTAL DEBIT VOUCHERS</td><td className="text-right pr-2">{inr(data.total_amount)}</td></tr></tfoot>
          </table>
        </div>
      )}
      <div className="text-[11px] text-slate-500">Every Debit Voucher (money out), independent of the Daily Fee &amp; Expense Report's compact summary line — live from the same receipts ledger.</div>
    </div>
  );
}

const Card = ({ label, value, tone }) => (
  <div className="bg-white border border-slate-200 rounded p-4">
    <div className="text-[11px] tracking-widest uppercase text-slate-500">{label}</div>
    <div className={`font-heading text-2xl font-semibold tabular mt-1 ${tone||'text-slate-900'}`}>{value}</div>
  </div>
);
