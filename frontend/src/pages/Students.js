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
  const [medium, setMedium] = useState('');
  const [stream, setStream] = useState('');
  const [section, setSection] = useState('');
  const [classFilter, setClassFilter] = useState('');
  const [openNew, setOpenNew] = useState(false);
  const [openImport, setOpenImport] = useState(false);
  const nav = useNavigate();

  // Junior College students are separated by stream (Arts/Commerce/Science/
  // Bi-Focal), never by English/Marathi medium — so the Medium filter is
  // meaningless (and disabled) whenever this department is selected.
  const isJuniorCollege = depts.find(d => d.id === dept)?.code === 'JC';

  const load = () => {
    const p = new URLSearchParams();
    if (q) p.set('q', q);
    if (dept) p.set('department_id', dept);
    if (medium && !isJuniorCollege) p.set('medium', medium);
    // Stream (Arts/Commerce/Science/Bi-Focal) is the ONLY thing that
    // actually narrows a "Class 11"/"Class 12" selection down to one group —
    // class_name alone matches every stream sharing that class name. Without
    // this, selecting a class + stream in the UI silently showed every
    // stream mixed together.
    if (stream && isJuniorCollege) p.set('stream', stream);
    // Section (A/B/C) — same exact-match pattern as Medium/Stream above, and
    // the same free-text field Live Fee Update already uses for it, so this
    // is one consistent filtering system rather than a per-screen one-off.
    // Applies to whichever class actually has sections (mainly 1-8); a
    // harmless no-op filter for classes that don't use sections.
    if (section) p.set('section', section);
    if (classFilter) p.set('class_name', classFilter);
    api.get(`/students?${p.toString()}`).then(r => setRows(r.data));
  };

  useEffect(() => {
    api.get('/departments').then(r => setDepts(r.data));
    api.get('/classes').then(r => setClasses(r.data));
  }, []);
  // Switching into Junior College always clears any stale English/Marathi
  // selection rather than silently filtering by a medium that can't apply.
  useEffect(() => { if (isJuniorCollege && medium) setMedium(''); }, [isJuniorCollege]); // eslint-disable-line
  // Switching OUT of Junior College clears any stale stream selection the
  // same way — a stream filter can't apply outside Junior College either.
  useEffect(() => { if (!isJuniorCollege && stream) setStream(''); }, [isJuniorCollege]); // eslint-disable-line
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [dept, medium, stream, section, classFilter]);

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
          <select
            data-testid="students-medium"
            value={isJuniorCollege ? '' : medium}
            onChange={(e)=>setMedium(e.target.value)}
            disabled={isJuniorCollege}
            title={isJuniorCollege ? 'Not applicable — Junior College is separated by stream, not medium' : undefined}
            className={`h-10 px-3 border border-slate-300 rounded text-sm ${isJuniorCollege ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-white'}`}
          >
            {isJuniorCollege ? (
              <option value="">Not Applicable</option>
            ) : (
              <>
                <option value="">All Mediums</option>
                <option value="English Medium">English</option>
                <option value="Semi Medium (Marathi)">Marathi</option>
              </>
            )}
          </select>
          <select
            data-testid="students-stream"
            value={isJuniorCollege ? stream : ''}
            onChange={(e)=>setStream(e.target.value)}
            disabled={!isJuniorCollege}
            title={!isJuniorCollege ? 'Not applicable — only Junior College is separated by stream' : undefined}
            className={`h-10 px-3 border border-slate-300 rounded text-sm ${!isJuniorCollege ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-white'}`}
          >
            {!isJuniorCollege ? (
              <option value="">Not Applicable</option>
            ) : (
              <>
                <option value="">All Streams</option>
                <option value="Arts">Arts</option>
                <option value="Commerce">Commerce</option>
                <option value="Science">Science</option>
                <option value="Bi-Focal">Bi-Focal</option>
              </>
            )}
          </select>
          <select data-testid="students-class" value={classFilter} onChange={(e)=>setClassFilter(e.target.value)} className="h-10 px-3 border border-slate-300 rounded text-sm bg-white">
            <option value="">All Classes</option>
            {classNameOptions.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <input
            data-testid="students-section"
            value={section} onChange={(e)=>setSection(e.target.value)}
            placeholder="Section (A/B/C)"
            className="h-10 w-32 px-3 border border-slate-300 rounded text-sm"
          />
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

const JC_STREAMS = ['Arts', 'Commerce', 'Science', 'Bi-Focal'];

function NewStudent({ depts, classes, onClose }) {
  const [f, setF] = useState({ admission_no:'', name:'', department_id:'', class_id:'', guardian_name:'', guardian_mobile:'', address:'' });
  // Junior College needs its own Class-name + Stream state because a single
  // "Class 12" NAME maps to five different underlying class_id rows (one per
  // stream) - that's what let the plain class_id dropdown show "Class 12"
  // duplicated once per stream. Class name and Stream are asked separately
  // here and only THEN resolved down to the one real class_id underneath.
  const [jcClassName, setJcClassName] = useState('');
  const [stream, setStream] = useState('');
  const [firstYearInCollege, setFirstYearInCollege] = useState(false);
  const [feePreview, setFeePreview] = useState(null); // {loading} | {data} | {error}
  const [err, setErr] = useState('');
  const set = (k, v) => setF({ ...f, [k]: v });

  const isJC = depts.find(d => d.id === f.department_id)?.code === 'JC';
  const availClasses = classes.filter(c => c.department_id === f.department_id);
  const jcClassNames = [...new Set(availClasses.map(c => c.name))].sort();
  const resolvedJcClassId = isJC ? (availClasses.find(c => c.name === jcClassName && c.stream === stream)?.id || '') : '';

  useEffect(() => { setJcClassName(''); setStream(''); setFirstYearInCollege(false); setFeePreview(null); }, [f.department_id]);
  useEffect(() => { setStream(''); setFeePreview(null); }, [jcClassName]);

  // Immediately look up the real applicable fee for this exact Academic Year
  // + Class + Stream via the same resolver bulk-import already uses — never
  // a generic Class 11/12 figure, and never guessed on the frontend.
  useEffect(() => {
    if (!isJC || !jcClassName || !stream) { setFeePreview(null); return; }
    let cancelled = false;
    setFeePreview({ loading: true });
    api.get('/fee-structures/resolve', { params: { medium: 'Junior College', class_name: jcClassName, stream, first_year_in_college: firstYearInCollege } })
      .then(r => { if (!cancelled) setFeePreview({ data: r.data }); })
      .catch(ex => { if (!cancelled) setFeePreview({ error: ex?.response?.data?.detail || 'No fee structure configured for this Class + Stream yet.' }); });
    return () => { cancelled = true; };
  }, [isJC, jcClassName, stream, firstYearInCollege]);

  const submit = async (e) => {
    e.preventDefault(); setErr('');
    let payload = { ...f };
    if (isJC) {
      if (!stream) { setErr('Stream is required for Junior College.'); return; }
      if (!resolvedJcClassId) { setErr('Could not resolve this Class + Stream — contact admin.'); return; }
      payload = { ...payload, class_id: resolvedJcClassId, medium: 'Junior College', stream, first_year_in_college: firstYearInCollege };
      if (feePreview?.data?.id) payload.fee_structure_id = feePreview.data.id;
    }
    try { await api.post('/students', payload); onClose(); }
    catch (ex) {
      const d = ex?.response?.data?.detail;
      setErr(typeof d === 'string' ? d : 'Failed to save');
    }
  };
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
          {isJC ? (
            <Field label="Class *"><select required data-testid="ns-class" className={inp} value={jcClassName} onChange={e=>setJcClassName(e.target.value)}><option value="">Select…</option>{jcClassNames.map(n => <option key={n} value={n}>{n}</option>)}</select></Field>
          ) : (
            <Field label="Class *"><select required data-testid="ns-class" className={inp} value={f.class_id} onChange={e=>set('class_id', e.target.value)}><option value="">Select…</option>{availClasses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          )}
          {isJC && jcClassName && (
            <Field label="Stream *"><select required data-testid="ns-stream" className={inp} value={stream} onChange={e=>setStream(e.target.value)}><option value="">Select…</option>{JC_STREAMS.map(s => <option key={s} value={s}>{s}</option>)}</select></Field>
          )}
          {isJC && jcClassName === 'Class 12' && stream && (
            <div className="col-span-2 flex items-center gap-2 text-sm text-slate-700 -mt-1">
              <input type="checkbox" id="ns-first-year" data-testid="ns-first-year" checked={firstYearInCollege} onChange={e=>setFirstYearInCollege(e.target.checked)} />
              <label htmlFor="ns-first-year">New admission to Class 12 (not promoted from Class 11 at this school)</label>
            </div>
          )}
          {isJC && jcClassName && stream && (
            <div className="col-span-2" data-testid="ns-fee-preview">
              {feePreview?.loading && <div className="text-sm text-slate-500">Checking applicable fee…</div>}
              {feePreview?.error && <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">{feePreview.error}</div>}
              {feePreview?.data && (
                <div className="border border-blue-200 bg-blue-50 rounded p-3">
                  <div className="text-[11px] uppercase tracking-widest text-blue-700 font-semibold">Applicable Fee — {jcClassName} · {stream} · {feePreview.data.academic_year}</div>
                  <div className="text-xl font-bold text-slate-900 mt-0.5">₹{Number(feePreview.data.total).toLocaleString('en-IN')}</div>
                  <div className="text-[12px] text-slate-600 mt-1">{(feePreview.data.items || []).map(it => `${it.fee_head_name}: ₹${Number(it.amount).toLocaleString('en-IN')}`).join(' · ')}</div>
                </div>
              )}
            </div>
          )}
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
