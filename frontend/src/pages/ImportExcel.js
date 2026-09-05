import React, { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import api from '@/lib/api';
import { PageHeader } from '@/components/Layout';
import { toast } from 'sonner';
import { Download, Upload, FileSpreadsheet, CheckCircle2, XCircle, AlertTriangle, RefreshCw, Undo2, History } from 'lucide-react';

const KINDS = {
  students: {
    label: 'Students',
    endpoint: '/students/bulk-import',
    undoEndpoint: '/students/bulk-delete',
    filename: 'balaji_students_template.xlsx',
    required: ['admission_no', 'name', 'medium', 'class_name'],
    optional: ['stream', 'section', 'roll_no', 'father_name', 'mother_name', 'guardian_mobile', 'academic_year', 'first_year_in_college', 'bus_stop_no', 'address'],
    hint: 'Medium: English Medium / Semi Medium (Marathi) / Junior College. Stream mandatory for JC. bus_stop_no is optional — use the master stop number.',
    sample: [
      ['BC-EP-101', 'Aarav Sharma',    'English Medium',        'Class 3',  '',          'A', '11', 'Rajesh Sharma',   'Priya Sharma',    '9876500001', '2026-27', '',    12, 'Butibori'],
      ['BC-MP-045', 'Rohan Deshmukh',  'Semi Medium (Marathi)', 'Class 4',  '',          'B', '07', 'Prakash Deshmukh','Sunita Deshmukh', '9876500003', '2026-27', '',    '',  'Butibori'],
      ['BC-JC-088', 'Anjali Kulkarni', 'Junior College',        'Class 11', 'Science',   '',  '',  'Vinod Kulkarni',  'Meena Kulkarni',  '9876500006', '2026-27', 'yes', 27,  'Butibori'],
      ['BC-JC-089', 'Karan Joshi',     'Junior College',        'Class 12', 'Commerce',  '',  '',  'Nitin Joshi',     'Rekha Joshi',     '9876500007', '2026-27', 'no',  '',  'Butibori'],
    ],
    idKeyForUndo: 'admission_no',
  },
  fees: {
    label: 'Fee Structures',
    endpoint: '/fee-structures/bulk-import',
    undoEndpoint: '/fee-structures/bulk-delete',
    filename: 'balaji_fees_template.xlsx',
    required: ['department_code', 'class_name', 'academic_year', 'fee_head_name', 'amount'],
    optional: [],
    sample: [
      ['EP', 'Class 3', '2026-27', 'Admission Fee', 8500],
      ['EP', 'Class 3', '2026-27', 'Tuition Q1', 2900],
      ['EP', 'Class 3', '2026-27', 'Tuition Q2', 2600],
      ['EP', 'Class 3', '2026-27', 'Tuition Q3', 2800],
      ['JC', 'Class 12 - Science', '2026-27', 'Tuition Fee', 10500],
    ],
    idKeyForUndo: null,
  },
};
const BATCH = 10;

export default function ImportExcel() {
  const [kind, setKind] = useState('students');
  const spec = KINDS[kind];
  const fileRef = useRef();
  const [rows, setRows] = useState([]);
  const [headers, setHeaders] = useState([]);
  const [mapping, setMapping] = useState({});
  const [needsMapping, setNeedsMapping] = useState(false);
  const [progress, setProgress] = useState({ done: 0, added: 0, skipped: 0, errors: [], current: null, running: false, finished: false });
  const [importedIds, setImportedIds] = useState([]);
  const [batchId, setBatchId] = useState(null);
  const [filename, setFilename] = useState('');
  const [busStops, setBusStops] = useState([]);
  useEffect(() => {
    api.get('/bus-stops').then(r => setBusStops(r.data || [])).catch(() => {});
  }, []);

  const reset = () => { setRows([]); setHeaders([]); setMapping({}); setNeedsMapping(false); setImportedIds([]); setBatchId(null); setFilename(''); setProgress({ done: 0, added: 0, skipped: 0, errors: [], current: null, running: false, finished: false }); if (fileRef.current) fileRef.current.value = ''; };

  const downloadTemplate = async () => {
    if (kind !== 'students') {
      const ws = XLSX.utils.aoa_to_sheet([[...spec.required, ...spec.optional], ...spec.sample]);
      ws['!cols'] = [...spec.required, ...spec.optional].map(() => ({ wch: 20 }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, spec.label);
      XLSX.writeFile(wb, spec.filename);
      toast.success('Template downloaded');
      return;
    }

    // Rich Excel with real dropdown data-validation for Medium / Stream / bus_stop_no
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Balaji Convent Fee Software';
    wb.created = new Date();

    const ws = wb.addWorksheet('Students', { views: [{ state: 'frozen', ySplit: 1 }] });
    const columns = [...spec.required, ...spec.optional];
    ws.columns = columns.map(c => ({ header: c, key: c, width: c.length > 14 ? c.length + 4 : 18 }));
    // Header styling
    ws.getRow(1).eachCell(cell => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    });
    ws.getRow(1).height = 22;
    // Sample rows
    for (const row of spec.sample) ws.addRow(row);

    // ---- Lookups sheet ----
    const lk = wb.addWorksheet('Lookups', { state: 'visible' });
    lk.columns = [
      { header: 'Medium',     key: 'medium',   width: 26 },
      { header: 'Stream',     key: 'stream',   width: 16 },
      { header: 'FirstYear',  key: 'fy',       width: 12 },
      { header: 'BusStopNo',  key: 'stop_no',  width: 12 },
      { header: 'BusStopName',key: 'stop_name',width: 40 },
    ];
    lk.getRow(1).font = { bold: true };
    const mediumOptions = ['English Medium', 'Semi Medium (Marathi)', 'Junior College'];
    const streamOptions = ['Arts', 'Commerce', 'Science', 'Electronics', 'Fisheries'];
    const fyOptions     = ['yes', 'no'];
    const stopRows = busStops.length ? busStops : [{ stop_no: '', stop_name: '(load bus stops via Admin → Bus Routes → Seed 2026-27)' }];
    const maxRows = Math.max(mediumOptions.length, streamOptions.length, fyOptions.length, stopRows.length);
    for (let i = 0; i < maxRows; i++) {
      lk.addRow({
        medium:    mediumOptions[i] || null,
        stream:    streamOptions[i] || null,
        fy:        fyOptions[i] || null,
        stop_no:   stopRows[i]?.stop_no ?? null,
        stop_name: stopRows[i]?.stop_name ?? null,
      });
    }

    // Named ranges (auto-adjust with the row counts above)
    wb.definedNames.add(`Lookups!$A$2:$A$${mediumOptions.length + 1}`, 'MediaList');
    wb.definedNames.add(`Lookups!$B$2:$B$${streamOptions.length + 1}`, 'StreamList');
    wb.definedNames.add(`Lookups!$C$2:$C$${fyOptions.length + 1}`, 'FYList');
    if (stopRows.length && stopRows[0]?.stop_no !== '') {
      wb.definedNames.add(`Lookups!$D$2:$D$${stopRows.length + 1}`, 'BusStopList');
    }

    // ---- Attach data validations ----
    const colLetter = (idx) => String.fromCharCode(65 + idx);   // 0→A
    const idxOf = (n) => columns.indexOf(n);
    const attach = (colName, formula, opts = {}) => {
      const i = idxOf(colName);
      if (i < 0) return;
      const L = colLetter(i);
      // Apply to rows 2 through 5000
      for (let r = 2; r <= 5000; r++) {
        ws.getCell(`${L}${r}`).dataValidation = { type: 'list', allowBlank: opts.allowBlank !== false, formulae: [formula], showErrorMessage: true, errorTitle: 'Invalid value', error: opts.error || 'Please pick from the dropdown list' };
      }
    };
    attach('medium', '=MediaList',  { allowBlank: false, error: 'Choose English Medium / Semi Medium (Marathi) / Junior College' });
    attach('stream', '=StreamList', { allowBlank: true,  error: 'Choose Arts, Commerce, Science, Electronics or Fisheries' });
    attach('first_year_in_college', '=FYList', { allowBlank: true });
    if (stopRows.length && stopRows[0]?.stop_no !== '') {
      attach('bus_stop_no', '=BusStopList', { allowBlank: true, error: 'Pick a stop number from the master list' });
    }

    // Instructions comment on header cells
    ws.getCell('C1').note = 'MANDATORY. Pick from dropdown.';
    ws.getCell('D1').note = 'MANDATORY. Use "Class 1..10", "K.G. I/II", "Nursery", "Class 11/12".';
    if (idxOf('stream') >= 0) ws.getCell(`${colLetter(idxOf('stream'))}1`).note = 'MANDATORY for Junior College rows. Leave blank otherwise.';
    if (idxOf('bus_stop_no') >= 0) ws.getCell(`${colLetter(idxOf('bus_stop_no'))}1`).note = 'Pick a stop from the master list; leave blank if the student is not on the bus.';

    // Save
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = spec.filename;
    document.body.appendChild(a); a.click(); a.remove();
    toast.success(`Template downloaded with ${stopRows.length && stopRows[0]?.stop_no !== '' ? stopRows.length : 0} bus stops in the dropdown`);
  };

  const normalizeRows = (parsed, map) => parsed.map(r => {
    const o = {};
    for (const req of [...spec.required, ...spec.optional]) {
      const src = map[req] || req;
      o[req] = src && r[src] !== undefined ? String(r[src]).trim() : '';
    }
    return o;
  }).filter(r => Object.values(r).some(v => v));

  const onFile = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    setFilename(file.name);
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const parsed = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
    if (!parsed.length) return toast.error('No rows found in file');
    const detected = Object.keys(parsed[0]).map(k => k.trim());
    setHeaders(detected);
    // Try direct match: normalize both sides
    const norm = (s) => s.toLowerCase().replace(/\s+|_/g, '');
    const auto = {};
    for (const req of [...spec.required, ...spec.optional]) {
      const hit = detected.find(h => norm(h) === norm(req));
      if (hit) auto[req] = hit;
    }
    setMapping(auto);
    const missing = spec.required.filter(r => !auto[r]);
    if (missing.length) {
      setNeedsMapping(true);
      setRows(parsed);  // raw for later re-mapping
      toast.warning(`Column mapping needed for: ${missing.join(', ')}`);
    } else {
      setRows(normalizeRows(parsed, auto));
      setNeedsMapping(false);
      toast.success(`✓ Loaded ${parsed.length} rows from ${file.name}`);
    }
  };

  const applyMapping = () => {
    const missing = spec.required.filter(r => !mapping[r]);
    if (missing.length) return toast.error(`Still missing: ${missing.join(', ')}`);
    setRows(prev => normalizeRows(prev, mapping));
    setNeedsMapping(false);
    toast.success('✓ Columns mapped — ready to import');
  };

  const startImport = async () => {
    if (!rows.length) return;
    setProgress(p => ({ ...p, running: true, finished: false }));
    let added = 0, skipped = 0; const errs = []; const idsThisRun = [];
    // Generate one batch_id for the whole file so undo is atomic
    const bid = `imp-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
    setBatchId(bid);
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const current = batch[0]?.name || batch[0]?.class_name || batch[0]?.admission_no || '—';
      setProgress(p => ({ ...p, current: `${current} (row ${i+1})`, done: i }));
      try {
        const { data } = await api.post(spec.endpoint, { rows: batch, batch_id: bid });
        added += data.created; skipped += data.skipped;
        for (const e of (data.errors || [])) errs.push({ ...e, row: i + e.row });
        if (spec.idKeyForUndo) for (const b of batch) if (b[spec.idKeyForUndo]) idsThisRun.push(b[spec.idKeyForUndo]);
      } catch (ex) {
        for (let j = 0; j < batch.length; j++) errs.push({ row: i + j + 1, error: ex?.response?.data?.detail || 'Batch failed', data: batch[j] });
      }
      setProgress(p => ({ ...p, added, skipped, errors: errs, done: Math.min(i + BATCH, rows.length) }));
      await new Promise(r => setTimeout(r, 60));
    }
    if (spec.idKeyForUndo) setImportedIds(idsThisRun); // just for count display
    setProgress(p => ({ ...p, running: false, finished: true, current: null, done: rows.length }));
    toast.success(`✓ Import complete — ${added} added, ${skipped} ${kind!=='students'?'updated':'skipped'}, ${errs.length} errors`);
  };

  const undoImport = async () => {
    if (!batchId) return;
    const label = kind === 'students' ? `${importedIds.length} imported students` : `${spec.label} batch`;
    if (!window.confirm(`Roll back the last ${label}? Records already referenced (with receipts / assigned students) will be kept safely.`)) return;
    try {
      const { data } = await api.post(spec.undoEndpoint, { batch_id: batchId });
      const kept = data.protected_referenced ?? data.protected_with_receipts ?? 0;
      toast.success(`✓ Undo done — ${data.deleted} deleted · ${kept || 0} kept (in use)`);
      setImportedIds([]); setBatchId(null);
    } catch (e) { toast.error(e?.response?.data?.detail || 'Undo failed'); }
  };

  const downloadErrors = () => {
    if (!progress.errors.length) return;
    const hdr = ['Row', 'Error', ...spec.required, ...spec.optional];
    const out = [hdr];
    for (const e of progress.errors) out.push([e.row, e.error, ...[...spec.required, ...spec.optional].map(k => e.data?.[k] || '')]);
    const ws = XLSX.utils.aoa_to_sheet(out);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Errors');
    XLSX.writeFile(wb, `import_errors_${Date.now()}.xlsx`);
  };

  const pct = rows.length ? Math.round((progress.done / rows.length) * 100) : 0;
  const remaining = rows.length - progress.done;

  return (
    <>
      <PageHeader title="Excel Import" subtitle="Download the template · fill in Excel · upload with live progress"
        actions={
          <div className="flex gap-2 no-print">
            <Link to="/imports-history" data-testid="ie-history-link" className="h-9 px-3 border border-slate-300 rounded text-sm hover:bg-white flex items-center gap-1.5"><History className="w-4 h-4" /> Import History</Link>
            <div className="flex gap-1 border border-slate-300 rounded overflow-hidden">
              {Object.entries(KINDS).map(([k, v]) => (
                <button key={k} data-testid={`imp-tab-${k}`} onClick={() => { setKind(k); reset(); }} className={`h-9 px-4 text-sm ${kind===k ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}>{v.label}</button>
              ))}
            </div>
          </div>
        }
      />
      <div className="p-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white border border-slate-200 rounded p-5">
          <div className="text-[11px] uppercase tracking-widest text-slate-500">Step 1</div>
          <h3 className="font-heading font-semibold text-lg mt-1">Download {spec.label} Template</h3>
          <p className="text-[13px] text-slate-600 mt-2">Excel with exact headers and sample rows.</p>
          <button data-testid="tpl-download" onClick={downloadTemplate} className="mt-4 h-10 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-sm w-full flex items-center justify-center gap-2">
            <Download className="w-4 h-4" /> Download Template
          </button>
          <div className="text-[11px] text-slate-500 mt-3">Required: <span className="font-mono">{spec.required.join(', ')}</span></div>
          {spec.optional.length > 0 && <div className="text-[11px] text-slate-500">Optional: <span className="font-mono">{spec.optional.join(', ')}</span></div>}
        </div>

        <div className="bg-white border border-slate-200 rounded p-5">
          <div className="text-[11px] uppercase tracking-widest text-slate-500">Step 2</div>
          <h3 className="font-heading font-semibold text-lg mt-1">Upload Filled Excel</h3>
          <p className="text-[13px] text-slate-600 mt-2">.xlsx / .xls / .csv — parsed in your browser.</p>
          <label className="mt-4 h-10 px-4 border-2 border-dashed border-slate-300 hover:border-slate-500 rounded text-sm w-full flex items-center justify-center gap-2 cursor-pointer text-slate-700">
            <Upload className="w-4 h-4" /><span>{filename || 'Choose file…'}</span>
            <input data-testid="excel-upload" ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={onFile} className="hidden" />
          </label>
          {rows.length > 0 && !needsMapping && <div className="mt-3 p-3 bg-slate-50 border border-slate-200 rounded text-sm"><FileSpreadsheet className="w-4 h-4 inline mr-1 text-slate-500" /><b>{rows.length}</b> rows ready</div>}
        </div>

        <div className="bg-white border border-slate-200 rounded p-5">
          <div className="text-[11px] uppercase tracking-widest text-slate-500">Step 3</div>
          <h3 className="font-heading font-semibold text-lg mt-1">Import & Track</h3>
          <p className="text-[13px] text-slate-600 mt-2">Batches of {BATCH} · live progress · error report.</p>
          {!progress.finished ? (
            <button data-testid="import-start" onClick={startImport} disabled={progress.running || !rows.length || needsMapping} className="mt-4 h-10 px-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded text-sm w-full flex items-center justify-center gap-2">
              {progress.running ? <><span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></span> Importing…</> : <><Upload className="w-4 h-4" /> Start Import</>}
            </button>
          ) : (
            <div className="mt-4 space-y-2">
              {batchId && (
                <button data-testid="undo-import" onClick={undoImport} className="h-10 px-4 border-2 border-red-300 text-red-700 hover:bg-red-50 rounded text-sm w-full flex items-center justify-center gap-2">
                  <Undo2 className="w-4 h-4" /> Undo Last Import{kind!=='students' ? '' : ` (${importedIds.length} students)`}
                </button>
              )}
              <button data-testid="import-reset" onClick={reset} className="h-10 px-4 border border-slate-300 rounded text-sm w-full flex items-center justify-center gap-2 hover:bg-slate-50">
                <RefreshCw className="w-4 h-4" /> Import Another File
              </button>
            </div>
          )}
        </div>

        {/* Column mapping panel */}
        {needsMapping && (
          <div className="lg:col-span-3 bg-amber-50 border-2 border-amber-400 rounded p-5" data-testid="mapping-panel">
            <div className="flex items-center gap-2 mb-2"><AlertTriangle className="w-5 h-5 text-amber-700" /><h3 className="font-heading font-semibold text-amber-900">Column Mapping Needed</h3></div>
            <p className="text-[13px] text-amber-800 mb-4">Your Excel headers don't match exactly. Match each required column to a column from your file:</p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {[...spec.required, ...spec.optional].map(col => (
                <label key={col} className="block">
                  <div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">
                    {col} {spec.required.includes(col) && <span className="text-red-600">*</span>}
                  </div>
                  <select className="w-full h-9 px-3 border border-slate-300 rounded text-sm bg-white" value={mapping[col] || ''} onChange={e => setMapping({ ...mapping, [col]: e.target.value })}>
                    <option value="">— skip —</option>
                    {headers.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </label>
              ))}
            </div>
            <button data-testid="mapping-apply" onClick={applyMapping} className="mt-4 h-9 px-4 bg-amber-600 hover:bg-amber-700 text-white rounded text-sm">Apply Mapping →</button>
          </div>
        )}

        {(progress.running || progress.finished) && (
          <div className="lg:col-span-3 bg-white border-2 border-blue-200 rounded p-5">
            <div className="flex items-baseline justify-between mb-3">
              <h3 className="font-heading font-semibold text-lg">{progress.finished ? '✓ Import Complete' : 'Importing…'}</h3>
              <div className="text-[13px] text-slate-500 tabular font-mono">{progress.done} / {rows.length} · {pct}%</div>
            </div>
            <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden mb-4"><div className="h-full bg-gradient-to-r from-blue-500 to-emerald-500 transition-all duration-300" style={{ width: `${pct}%` }} /></div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <Stat icon={FileSpreadsheet} label={`Total in Excel`} value={rows.length} tone="text-slate-900" />
              <Stat icon={CheckCircle2} label={kind!=='students' ? 'Created' : 'Added'} value={progress.added} tone="text-emerald-700" />
              <Stat icon={AlertTriangle} label={kind!=='students' ? 'Updated' : 'Skipped'} value={progress.skipped} tone="text-amber-700" />
              <Stat icon={XCircle} label="Errors" value={progress.errors.length} tone="text-red-700" />
            </div>
            <div className="grid grid-cols-2 gap-3 mb-3 text-sm">
              <div className="bg-slate-50 border border-slate-200 rounded p-3"><div className="text-[10px] uppercase tracking-widest text-slate-500">Currently processing</div><div className="font-semibold text-slate-900 mt-0.5">{progress.current || (progress.finished ? '— Done —' : '…')}</div></div>
              <div className="bg-slate-50 border border-slate-200 rounded p-3"><div className="text-[10px] uppercase tracking-widest text-slate-500">Remaining</div><div className="font-heading text-xl font-semibold tabular text-slate-900">{remaining}</div></div>
            </div>
            {progress.errors.length > 0 && (
              <div className="border border-red-200 bg-red-50 rounded p-3 mt-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm text-red-800 font-semibold flex items-center gap-1.5"><XCircle className="w-4 h-4" /> {progress.errors.length} error{progress.errors.length===1?'':'s'}</div>
                  <button data-testid="err-download" onClick={downloadErrors} className="text-xs h-8 px-3 bg-red-600 hover:bg-red-700 text-white rounded flex items-center gap-1.5"><Download className="w-3.5 h-3.5" /> Download Error Report</button>
                </div>
                <div className="max-h-40 overflow-y-auto text-[12px] space-y-0.5">
                  {progress.errors.slice(0, 20).map((e, i) => (
                    <div key={i} className="text-red-800"><span className="font-mono">Row {e.row}:</span> {e.error}</div>
                  ))}
                  {progress.errors.length > 20 && <div className="text-red-600 italic mt-1">…and {progress.errors.length - 20} more.</div>}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
const Stat = ({ icon:Icon, label, value, tone }) => (
  <div className="bg-white border border-slate-200 rounded p-3">
    <div className="flex justify-between items-center mb-1"><div className="text-[10px] uppercase tracking-widest text-slate-500">{label}</div><Icon className="w-4 h-4 text-slate-400" strokeWidth={1.75} /></div>
    <div className={`font-heading text-2xl font-bold tabular ${tone}`}>{value}</div>
  </div>
);
