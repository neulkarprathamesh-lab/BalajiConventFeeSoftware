import React, { useEffect, useState } from 'react';
import api from '@/lib/api';
import { PageHeader } from '@/components/Layout';
import { Search, Plus, X, Upload } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

const CLASS_ORDER = ['Nursery', 'K.G. I', 'KG I', 'K.G. II', 'KG II', 'Junior Shishuvihar', 'Senior Shishuvihar', 'Balwadi',
  'Class 1', 'Class 2', 'Class 3', 'Class 4', 'Class 5', 'Class 6', 'Class 7', 'Class 8', 'Class 9', 'Class 10', 'Class 11', 'Class 12'];
const classSortKey = (name) => {
  const idx = CLASS_ORDER.indexOf(name);
  return idx === -1 ? [999, name] : [idx, name];
};

export default function Students() {
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState('');
  const [depts, setDepts] = useState([]);
  const [classes, setClasses] = useState([]);
  const [dept, setDept] = useState('');
  const [classFilter, setClassFilter] = useState('');
  const [openNew, setOpenNew] = useState(false);
  const [openImport, setOpenImport] = useState(false);
  const nav = useNavigate();

  const load = () => {
    const p = new URLSearchParams();
    if (q) p.set('q', q);
    if (dept) p.set('department_id', dept);
    if (classFilter) p.set('class_name', classFilter);
    api.get(`/students?${p.toString()}`).then(r => setRows(r.data));
  };

  useEffect(() => {
    api.get('/departments').then(r => setDepts(r.data));
    api.get('/classes').then(r => setClasses(r.data));
  }, []);
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [dept, classFilter]);

  // One entry per distinct class NAME, ignoring medium/stream/section entirely - "Class 9"
  // filters every 9th-grade student regardless of which medium they're in.
  const classNameOptions = [...new Set(classes.map(c => c.name))].sort((a, b) => {
    const [ai, an] = classSortKey(a);
    const [bi, bn] = classSortKey(b);
    return ai !== bi ? ai - bi : an.localeCompare(bn);
  });

  const className = (id) => classes.find(c => c.id === id)?.name || '-';
  const deptName = (id) => depts.find(d => d.id === id)?.name || '-';

  return (
    <>
      <PageHeader title="Students" subtitle={`${rows.length} shown`} actions={
        <div className="flex gap-2">
          <button data-testid="students-import" onClick={() => setOpenImport(true)} className="h-9 px-3 border border-slate-300 text-slate-800 text-sm rounded flex items-center gap-1.5 hover:bg-white">
            <Upload className="w-4 h-4" /> Bulk Import
          </button>
          <button data-testid="students-new" onClick={() => setOpenNew(true)} className="h-9 px-3 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded flex items-center gap-1.5">
            <Plus className="w-4 h-4" /> Add Student
          </button>
        </div>
      } />
      <div className="p-6 space-y-4">
        <div className="bg-white border border-slate-200 rounded p-4 flex gap-3 items-end">
          <div className="flex-1 relative">
            <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
            <input
              data-testid="students-search"
              value={q} onChange={(e)=>setQ(e.target.value)} onKeyDown={(e)=>e.key==='Enter'&&load()}
              placeholder="Search by admission no, name or mobile…"
              className="h-10 w-full pl-9 pr-3 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-600 focus:border-blue-600 focus:outline-none"
            />
          </div>
          <select data-testid="students-dept" value={dept} onChange={(e)=>setDept(e.target.value)} className="h-10 px-3 border border-slate-300 rounded text-sm bg-white">
            <option value="">All Departments</option>
            {depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <select data-testid="students-class" value={classFilter} onChange={(e)=>setClassFilter(e.target.value)} className="h-10 px-3 border border-slate-300 rounded text-sm bg-white">
            <option value="">All Classes</option>
            {classNameOptions.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <button onClick={load} className="h-10 px-4 bg-slate-900 text-white text-sm rounded hover:bg-slate-800">Search</button>
        </div>

        <div className="bg-white border border-slate-200 rounded overflow-hidden">
          <table className="w-full dense-table" data-testid="students-table">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-slate-600">
                <th>Admission No</th><th>Name</th><th>Department</th><th>Class</th><th>Guardian</th><th>Mobile</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan="7" className="text-center py-8 text-slate-500">No students found</td></tr>}
              {rows.map(s => (
                <tr key={s.id} className="cursor-pointer" onClick={() => nav(`/students/${s.id}`)}>
                  <td className="font-mono text-[12px]">{s.admission_no}</td>
                  <td className="font-medium">{s.name}</td>
                  <td>{deptName(s.department_id)}</td>
                  <td>{className(s.class_id)}</td>
                  <td>{s.guardian_name || '-'}</td>
                  <td className="font-mono text-[12px]">{s.guardian_mobile || '-'}</td>
                  <td><span className="text-[11px] px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 uppercase">{s.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {openNew && <NewStudent depts={depts} classes={classes} onClose={() => { setOpenNew(false); load(); }} />}
      {openImport && <BulkImport depts={depts} onClose={() => { setOpenImport(false); load(); }} />}
    </>
  );
}

function BulkImport({ depts, onClose }) {
  const [text, setText] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const template = `admission_no,name,department_code,class_name,guardian_name,guardian_mobile
BC-EP-100,Sample Student,EP,Class 3,Guardian Name,9876543210`;

  const parseCSV = (raw) => {
    const lines = raw.trim().split(/\r?\n/);
    if (lines.length < 2) return [];
    const headers = lines[0].split(',').map(h => h.trim());
    return lines.slice(1).filter(l => l.trim()).map(line => {
      const cols = line.split(',').map(c => c.trim());
      const obj = {};
      headers.forEach((h, i) => obj[h] = cols[i] || '');
      return obj;
    });
  };

  const submit = async () => {
    const rows = parseCSV(text);
    if (!rows.length) { toast.error('No rows parsed. Check the CSV format.'); return; }
    setBusy(true);
    try {
      const { data } = await api.post('/students/bulk-import', { rows });
      setResult(data);
      toast.success(`✓ ${data.created} of ${data.total} added · ${data.skipped} duplicates · ${data.errors.length} errors`);
    } catch (e) { toast.error(e?.response?.data?.detail || 'Import failed'); }
    setBusy(false);
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded shadow-lg w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col" data-testid="bulk-import">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <h3 className="font-heading font-medium">Bulk Import Students</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 overflow-y-auto space-y-3">
          <div className="text-sm text-slate-600">
            Paste CSV rows below. First row must be the header. Required columns:
            <code className="mx-1 bg-slate-100 px-1.5 py-0.5 rounded text-[11px]">admission_no, name, department_code, class_name</code>.
            Optional: <code className="bg-slate-100 px-1.5 py-0.5 rounded text-[11px]">guardian_name, guardian_mobile, address</code>.
          </div>
          <div className="text-[11px] text-slate-500">Department codes: {depts.map(d => `${d.code}=${d.name}`).join(' · ')}</div>
          <button onClick={() => setText(template)} className="text-xs text-blue-700 hover:underline">Insert template</button>
          <textarea
            data-testid="bulk-import-textarea"
            rows="10" value={text} onChange={e=>setText(e.target.value)}
            className="w-full font-mono text-[12px] border border-slate-300 rounded p-3 focus:ring-2 focus:ring-blue-600 focus:border-blue-600 focus:outline-none"
            placeholder={template}
          />
          {result && (
            <div className="border border-slate-200 rounded p-3 text-sm bg-slate-50">
              <div><span className="text-slate-500">Total rows: </span><b>{result.total}</b> · <span className="text-emerald-700">created {result.created}</span> · <span className="text-amber-700">skipped {result.skipped}</span> · <span className="text-red-700">errors {result.errors.length}</span></div>
              {result.errors.length > 0 && (
                <ul className="mt-2 text-[12px] text-red-700 space-y-0.5 max-h-32 overflow-y-auto">
                  {result.errors.map((e,i) => <li key={i}>Row {e.row}: {e.error}</li>)}
                </ul>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-200 bg-slate-50">
          <button type="button" onClick={onClose} className="h-9 px-3 border border-slate-300 rounded text-sm hover:bg-white">Close</button>
          <button data-testid="bulk-import-submit" disabled={busy} onClick={submit} className="h-9 px-4 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-60">{busy ? (
            <span className="flex items-center gap-2"><span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></span> Importing… please wait</span>
          ) : 'Import'}</button>
        </div>
      </div>
    </div>
  );
}

function NewStudent({ depts, classes, onClose }) {
  const [f, setF] = useState({ admission_no:'', name:'', department_id:'', class_id:'', guardian_name:'', guardian_mobile:'', address:'' });
  const [err, setErr] = useState('');
  const set = (k, v) => setF({ ...f, [k]: v });
  const submit = async (e) => {
    e.preventDefault(); setErr('');
    try { await api.post('/students', f); onClose(); }
    catch (ex) {
      const d = ex?.response?.data?.detail;
      setErr(typeof d === 'string' ? d : 'Failed to save');
    }
  };
  const availClasses = classes.filter(c => c.department_id === f.department_id);
  return (
    <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50 p-4">
      <form onSubmit={submit} className="bg-white rounded shadow-lg w-full max-w-lg" data-testid="new-student-form">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <h3 className="font-heading font-medium">New Student</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 grid grid-cols-2 gap-4">
          <Field label="Admission No *"><input required data-testid="ns-admno" className={inp} value={f.admission_no} onChange={e=>set('admission_no', e.target.value)} /></Field>
          <Field label="Full Name *"><input required data-testid="ns-name" className={inp} value={f.name} onChange={e=>set('name', e.target.value)} /></Field>
          <Field label="Department *"><select required data-testid="ns-dept" className={inp} value={f.department_id} onChange={e=>set('department_id', e.target.value)}><option value="">Select…</option>{depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
          <Field label="Class *"><select required data-testid="ns-class" className={inp} value={f.class_id} onChange={e=>set('class_id', e.target.value)}><option value="">Select…</option>{availClasses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          <Field label="Guardian Name"><input className={inp} value={f.guardian_name} onChange={e=>set('guardian_name', e.target.value)} /></Field>
          <Field label="Guardian Mobile"><input className={inp} value={f.guardian_mobile} onChange={e=>set('guardian_mobile', e.target.value)} /></Field>
          <div className="col-span-2"><Field label="Address"><textarea rows="2" className={inp} value={f.address} onChange={e=>set('address', e.target.value)} /></Field></div>
        </div>
        {err && <div className="mx-5 mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2">{err}</div>}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-200 bg-slate-50">
          <button type="button" onClick={onClose} className="h-9 px-3 border border-slate-300 rounded text-sm hover:bg-white">Cancel</button>
          <button data-testid="ns-submit" className="h-9 px-4 bg-blue-600 text-white rounded text-sm hover:bg-blue-700">Save</button>
        </div>
      </form>
    </div>
  );
}

const inp = "w-full h-9 px-3 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-600 focus:border-blue-600 focus:outline-none bg-white";
const Field = ({ label, children }) => (
  <label className="block">
    <div className="text-[11px] tracking-wide uppercase text-slate-600 mb-1">{label}</div>
    {children}
  </label>
);
