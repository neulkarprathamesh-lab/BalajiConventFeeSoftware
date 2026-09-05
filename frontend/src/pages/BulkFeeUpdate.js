import React, { useEffect, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import api from '@/lib/api';
import { PageHeader, inr } from '@/components/Layout';
import { toast } from 'sonner';
import { Plus, Download, Upload, Pencil, Trash2, FileDown, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';

export default function BulkFeeUpdate() {
  const [records, setRecords] = useState([]);
  const [groups, setGroups] = useState([]);
  const [ay, setAy] = useState('2026-27');
  const [yearFilter, setYearFilter] = useState('all');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(null);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef();

  const reload = () => {
    api.get('/fee-details').then(r => setRecords(r.data));
    api.get('/fee-details/groups').then(r => setGroups(r.data));
  };
  useEffect(() => { reload(); }, []);

  const availableYears = [...new Set(records.map(r => r.academic_year).filter(Boolean))].sort().reverse();
  const visible = records.filter(r =>
    (yearFilter === 'all' || r.academic_year === yearFilter) &&
    (!q || r.student_name?.toLowerCase().includes(q.toLowerCase()) || r.admission_no?.toLowerCase().includes(q.toLowerCase()))
  );

  const remove = async (r) => {
    if (!window.confirm(`Delete the fee-detail record for ${r.student_name} (${r.academic_year})? This only removes the office record — it never touches receipts.`)) return;
    try { await api.delete(`/fee-details/${r.id}`); toast.success('Deleted'); reload(); }
    catch (e) { toast.error(e?.response?.data?.detail || 'Failed'); }
  };

  const downloadOneTemplate = async (groupKey) => {
    try {
      const { data } = await api.get(`/fee-details/groups/${encodeURIComponent(groupKey)}/template`, {
        params: { academic_year: ay }, responseType: 'blob',
      });
      const url = URL.createObjectURL(new Blob([data]));
      const a = document.createElement('a');
      a.href = url; a.download = `${groupKey}_Fee_Update.xlsx`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e) { toast.error('Could not download template'); }
  };

  const downloadAllTemplates = async () => {
    try {
      const { data } = await api.get('/fee-details/groups/export-all', { params: { academic_year: ay }, responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([data]));
      const a = document.createElement('a');
      a.href = url; a.download = `Bulk_Fee_Update_${ay}_AllClasses.zip`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      toast.success(`✓ Downloaded ${groups.length} class files`);
    } catch (e) { toast.error('Could not download templates'); }
  };

  const onFileChosen = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const sheetName = wb.SheetNames.find(n => n !== 'BusStopMaster' && n !== 'Lists') || wb.SheetNames[0];
    const sheet = wb.Sheets[sheetName];
    // The class-wise template has a 3-line header block above the real column row - find the
    // row that actually contains "Admission No." and parse from there.
    const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    const headerIdx = raw.findIndex(row => row.some(c => String(c).trim() === 'Admission No.'));
    if (headerIdx === -1) { toast.error('Could not find the header row ("Admission No.") in this file'); return; }
    const headers = raw[headerIdx].map(h => String(h).trim());
    const col = (name) => headers.indexOf(name);
    const rows = raw.slice(headerIdx + 1)
      .filter(r => r[col('Admission No.')])
      .map(r => ({
        admission_no: String(r[col('Admission No.')]).trim(),
        academic_year: String(r[col('Academic Year')] || ay).trim() || ay,
        total_fee: r[col('Total Fee')],
        total_paid: r[col('Total Paid')],
        previous_year_outstanding: r[col('Previous Year Outstanding')] === '' ? null : r[col('Previous Year Outstanding')],
        remarks: r[col('Remarks')],
        class_name: r[col('Class')],
        medium: r[col('Medium')],
        stream: r[col('Stream')],
      }));
    if (!rows.length) { toast.error('No data rows found below the header'); return; }
    setImporting({ rows, filename: file.name, stage: 'preview', preview: null });
    fileRef.current.value = '';
    try {
      const { data } = await api.post('/fee-details/bulk-import', { rows, preview: true });
      setImporting(prev => ({ ...prev, preview: data }));
    } catch (e) { toast.error(e?.response?.data?.detail || 'Preview failed'); setImporting(null); }
  };

  const confirmImport = async () => {
    if (!importing) return;
    setImporting(prev => ({ ...prev, stage: 'committing' }));
    try {
      const { data } = await api.post('/fee-details/bulk-import', { rows: importing.rows, preview: false });
      toast.success(`✓ Imported — ${data.created} added, ${data.skipped} updated, ${data.errors.length} skipped`);
      setImporting(null);
      reload();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Import failed'); setImporting(prev => ({ ...prev, stage: 'preview' })); }
  };

  return (
    <>
      <PageHeader title="Bulk Fee Detail Update" subtitle="Historical / previous-year fee data — Total Fee, Total Paid, Balance, Previous Year Outstanding. Never creates a receipt."
        actions={
          <div className="flex gap-2 no-print items-center">
            <input value={ay} onChange={e=>setAy(e.target.value)} className="h-9 w-24 px-2 border border-slate-300 rounded text-sm" placeholder="2026-27" />
            <label className="h-9 px-3 border border-slate-300 rounded text-sm hover:bg-white flex items-center gap-1.5 cursor-pointer">
              <Upload className="w-4 h-4" /> Upload Filled XLSX/CSV
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={onFileChosen} className="hidden" />
            </label>
            <button data-testid="bfu-add" onClick={() => setEditing({})} className="h-9 px-3 bg-blue-600 text-white rounded text-sm flex items-center gap-1.5 hover:bg-blue-700"><Plus className="w-4 h-4" /> Add Record</button>
          </div>
        }
      />
      <div className="p-6 space-y-6">
        <div className="bg-white border border-slate-200 rounded">
          <div className="px-4 py-2 border-b border-slate-200 flex items-center justify-between">
            <div className="font-heading font-medium text-sm">Class-wise Fee Update Templates — {ay}</div>
            <button onClick={downloadAllTemplates} className="h-8 px-3 border border-slate-300 rounded text-xs hover:bg-slate-50 flex items-center gap-1.5"><Download className="w-3.5 h-3.5" /> Download All ({groups.length} files, ZIP)</button>
          </div>
          <div className="p-3 grid grid-cols-2 md:grid-cols-4 gap-2">
            {groups.length === 0 && <div className="col-span-full text-sm text-slate-500 py-2">No students in the system yet — nothing to generate.</div>}
            {groups.map(g => (
              <button key={g.group_key} onClick={() => downloadOneTemplate(g.group_key)}
                className="text-left border border-slate-200 rounded p-2.5 hover:border-blue-400 hover:bg-blue-50 group" data-testid={`bfu-template-${g.group_key}`}>
                <div className="text-[13px] font-medium truncate">{g.display}</div>
                <div className="text-[11px] text-slate-500 flex items-center justify-between mt-0.5">
                  <span>{g.student_count} students</span>
                  <FileDown className="w-3.5 h-3.5 text-slate-400 group-hover:text-blue-600" />
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="flex gap-3">
          <select data-testid="bfu-year-filter" className="h-9 px-3 border border-slate-300 rounded text-sm bg-white" value={yearFilter} onChange={e=>setYearFilter(e.target.value)}>
            <option value="all">All years</option>
            {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search student name / admission no…" className="h-9 px-3 border border-slate-300 rounded text-sm flex-1 max-w-sm" />
        </div>
        <div className="bg-white border border-slate-200 rounded overflow-hidden">
          <table className="w-full dense-table">
            <thead>
              <tr className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-600 text-left">
                <th className="pl-3 py-2">Student</th>
                <th>Admission No.</th>
                <th>Class</th>
                <th>Medium / Stream</th>
                <th>Academic Year</th>
                <th className="text-right">Total Fee</th>
                <th className="text-right">Total Paid</th>
                <th className="text-right">Balance</th>
                <th className="text-right">Prev. Yr. Outstanding</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && <tr><td colSpan={10} className="text-center py-8 text-sm text-slate-500">No records yet. Download a class template above, fill it in, and upload it — or add one manually.</td></tr>}
              {visible.map(r => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="pl-3 py-1.5 font-medium">{r.student_name}</td>
                  <td className="font-mono text-[12px]">{r.admission_no}</td>
                  <td>{r.class_name}</td>
                  <td className="text-[12px]">{r.medium}{r.stream ? ` · ${r.stream}` : ''}</td>
                  <td>{r.academic_year}</td>
                  <td className="text-right font-mono tabular">{inr(r.total_fee)}</td>
                  <td className="text-right font-mono tabular text-emerald-700">{inr(r.total_paid)}</td>
                  <td className="text-right font-mono tabular font-semibold">{inr(r.balance_fee)}</td>
                  <td className="text-right font-mono tabular text-amber-700">{r.previous_year_outstanding != null ? inr(r.previous_year_outstanding) : '—'}</td>
                  <td className="pr-3">
                    <div className="flex justify-end gap-1">
                      <button onClick={() => setEditing(r)} className="h-7 w-7 flex items-center justify-center text-slate-500 hover:text-blue-700" data-testid={`bfu-edit-${r.id}`}><Pencil className="w-3.5 h-3.5" /></button>
                      <button onClick={() => remove(r)} className="h-7 w-7 flex items-center justify-center text-slate-500 hover:text-red-700" data-testid={`bfu-delete-${r.id}`}><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {editing && <RecordModal record={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
      {importing && <ImportPreviewModal state={importing} onClose={() => setImporting(null)} onConfirm={confirmImport} />}
    </>
  );
}

function ImportPreviewModal({ state, onClose, onConfirm }) {
  const { filename, preview, stage } = state;
  return (
    <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded shadow-lg w-full max-w-3xl max-h-[85vh] flex flex-col" data-testid="bfu-import-modal">
        <div className="px-5 py-3 border-b border-slate-200 font-heading font-medium flex items-center justify-between">
          <span>Import Preview — {filename}</span>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-xl leading-none">×</button>
        </div>
        {!preview ? (
          <div className="p-8 text-center text-sm text-slate-500">Validating…</div>
        ) : (
          <>
            <div className="p-4 grid grid-cols-5 gap-2 text-center border-b border-slate-200">
              <Stat label="Total Rows" value={preview.total_rows} icon={null} />
              <Stat label="To Add" value={preview.rows_to_add} tone="text-emerald-700" icon={CheckCircle2} />
              <Stat label="To Update" value={preview.rows_to_update} tone="text-blue-700" icon={CheckCircle2} />
              <Stat label="Invalid" value={preview.invalid_rows} tone="text-red-700" icon={XCircle} />
              <Stat label="Duplicates" value={preview.duplicate_rows} tone="text-amber-700" icon={AlertTriangle} />
            </div>
            <div className="overflow-y-auto flex-1 p-4 space-y-4">
              {preview.valid.length > 0 && (
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1.5">Rows that will be applied</div>
                  <table className="w-full dense-table text-[12px]">
                    <thead><tr className="text-left text-slate-500"><th>Student</th><th>Adm. No.</th><th>Action</th><th className="text-right">Old Total Paid</th><th className="text-right">New Total Paid</th><th className="text-right">New Prev. Yr. Outstanding</th></tr></thead>
                    <tbody>
                      {preview.valid.map(v => (
                        <tr key={v.row} className="border-t border-slate-100">
                          <td className="py-1">{v.student_name}</td>
                          <td className="font-mono">{v.admission_no}</td>
                          <td><span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${v.action==='add'?'bg-emerald-100 text-emerald-800':'bg-blue-100 text-blue-800'}`}>{v.action === 'add' ? 'NEW' : 'UPDATE'}</span></td>
                          <td className="text-right font-mono">{v.old ? inr(v.old.total_paid) : '—'}</td>
                          <td className="text-right font-mono font-semibold">{inr(v.new.total_paid)}</td>
                          <td className="text-right font-mono">{v.new.previous_year_outstanding != null ? inr(v.new.previous_year_outstanding) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {preview.invalid.length > 0 && (
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-red-700 mb-1.5">Invalid rows (will NOT be imported)</div>
                  <div className="space-y-1">
                    {preview.invalid.map((e, i) => <div key={i} className="text-[12px] text-red-800 bg-red-50 border border-red-200 rounded px-2 py-1">Row {e.row}: {e.error}</div>)}
                  </div>
                </div>
              )}
              {preview.duplicates.length > 0 && (
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-amber-700 mb-1.5">Duplicate rows within this file (will NOT be imported)</div>
                  <div className="space-y-1">
                    {preview.duplicates.map((e, i) => <div key={i} className="text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">Row {e.row}: {e.error}</div>)}
                  </div>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-200 bg-slate-50">
              <button onClick={onClose} className="h-9 px-3 border border-slate-300 rounded text-sm">Cancel — Nothing Imported</button>
              <button onClick={onConfirm} disabled={stage==='committing' || preview.valid_rows===0} data-testid="bfu-import-confirm"
                className="h-9 px-4 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white rounded text-sm font-semibold">
                {stage === 'committing' ? 'Importing…' : `Confirm Import (${preview.valid_rows} rows)`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, tone, icon: Icon }) {
  return (
    <div className="border border-slate-200 rounded p-2">
      <div className={`text-lg font-heading font-semibold ${tone || 'text-slate-900'} flex items-center justify-center gap-1`}>
        {Icon && <Icon className="w-4 h-4" />} {value}
      </div>
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
    </div>
  );
}

function RecordModal({ record, onClose, onSaved }) {
  const isNew = !record.id;
  const [student, setStudent] = useState(isNew ? null : { id: record.student_id, name: record.student_name, admission_no: record.admission_no });
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const debounceRef = useRef(0);
  const [ay, setAy] = useState(record.academic_year || '2026-27');
  const [totalFee, setTotalFee] = useState(record.total_fee ?? '');
  const [totalPaid, setTotalPaid] = useState(record.total_paid ?? '');
  const [prevOutstanding, setPrevOutstanding] = useState(record.previous_year_outstanding ?? '');
  const [remarks, setRemarks] = useState(record.remarks || '');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!q || q.length < 2) { setResults([]); return; }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try { const { data } = await api.get(`/students?q=${encodeURIComponent(q)}&limit=8`); setResults(data); }
      catch { setResults([]); }
    }, 220);
  }, [q]);

  const balance = (parseFloat(totalFee) || 0) - (parseFloat(totalPaid) || 0);

  const save = async () => {
    if (!student) return toast.error('Select a student');
    if (!ay.trim()) return toast.error('Academic year is required');
    setBusy(true);
    try {
      await api.post('/fee-details', {
        student_id: student.id, academic_year: ay.trim(),
        total_fee: parseFloat(totalFee) || 0, total_paid: parseFloat(totalPaid) || 0,
        previous_year_outstanding: prevOutstanding === '' ? null : parseFloat(prevOutstanding),
        remarks: remarks || null,
      });
      toast.success('Saved');
      onSaved();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Failed'); }
    setBusy(false);
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded shadow-lg w-full max-w-lg" onClick={e => e.stopPropagation()} data-testid="bfu-modal">
        <div className="px-5 py-3 border-b border-slate-200 font-heading font-medium">{isNew ? 'Add' : 'Edit'} Fee Detail Record</div>
        <div className="p-5 space-y-3">
          <label className="block relative">
            <div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">Student *</div>
            {student ? (
              <div className="flex items-center justify-between h-9 px-3 border border-slate-300 rounded text-sm bg-slate-50">
                <span>{student.name} <span className="text-slate-400 font-mono text-[12px]">({student.admission_no})</span></span>
                {isNew && <button onClick={() => setStudent(null)} className="text-slate-400 hover:text-slate-700 text-xs">change</button>}
              </div>
            ) : (
              <>
                <input autoFocus value={q} onChange={e=>setQ(e.target.value)} placeholder="Search name or admission no…" className="w-full h-9 px-3 border border-slate-300 rounded text-sm" />
                {results.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded shadow-lg max-h-56 overflow-y-auto">
                    {results.map(r => (
                      <button key={r.id} onClick={() => { setStudent(r); setResults([]); setQ(''); }} className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex justify-between">
                        <span>{r.name}</span><span className="text-slate-400 font-mono text-[12px]">{r.admission_no}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </label>
          <label className="block"><div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">Academic Year *</div>
            <input value={ay} onChange={e=>setAy(e.target.value)} placeholder="2026-27" className="w-full h-9 px-3 border border-slate-300 rounded text-sm" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">Total Fee</div>
              <input type="number" value={totalFee} onChange={e=>setTotalFee(e.target.value)} className="w-full h-9 px-3 border border-slate-300 rounded text-sm text-right font-mono" />
            </label>
            <label className="block"><div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">Total Paid</div>
              <input type="number" value={totalPaid} onChange={e=>setTotalPaid(e.target.value)} className="w-full h-9 px-3 border border-slate-300 rounded text-sm text-right font-mono" />
            </label>
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded p-2.5 text-sm flex justify-between">
            <span className="text-slate-600">Balance Fee (computed)</span>
            <span className="font-mono font-semibold">{inr(balance)}</span>
          </div>
          <label className="block"><div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">Previous Year Outstanding <span className="text-slate-400 normal-case">(carried forward from a prior year — kept separate, never added twice)</span></div>
            <input type="number" value={prevOutstanding} onChange={e=>setPrevOutstanding(e.target.value)} className="w-full h-9 px-3 border border-slate-300 rounded text-sm text-right font-mono" placeholder="Leave blank if none" />
          </label>
          <label className="block"><div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">Remarks / Source</div>
            <textarea value={remarks} onChange={e=>setRemarks(e.target.value)} rows={2} className="w-full px-3 py-2 border border-slate-300 rounded text-sm" />
          </label>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-200 bg-slate-50">
          <button onClick={onClose} className="h-9 px-3 border border-slate-300 rounded text-sm">Cancel</button>
          <button onClick={save} disabled={busy} data-testid="bfu-save" className="h-9 px-4 bg-blue-600 text-white rounded text-sm disabled:opacity-60">{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}
