import React, { useEffect, useState } from 'react';
import api from '@/lib/api';
import { PageHeader } from '@/components/Layout';
import { toast } from 'sonner';
import { Search, Users } from 'lucide-react';

export default function AssignStudents() {
  const [depts, setDepts] = useState([]);
  const [classes, setClasses] = useState([]);
  const [structures, setStructures] = useState([]);
  const [fromDept, setFromDept] = useState('');
  const [fromClass, setFromClass] = useState('');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState({});
  const [toClass, setToClass] = useState('');
  const [toFs, setToFs] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/departments').then(r => setDepts(r.data));
    api.get('/classes').then(r => setClasses(r.data));
    api.get('/fee-structures').then(r => setStructures(r.data));
  }, []);

  const searchStudents = async () => {
    const p = new URLSearchParams({ limit: '500' });
    if (q) p.set('q', q);
    if (fromDept) p.set('department_id', fromDept);
    if (fromClass) p.set('class_id', fromClass);
    const { data } = await api.get(`/students?${p.toString()}`);
    setRows(data);
    setSelected(Object.fromEntries(data.map(s => [s.id, true])));
  };
  useEffect(() => { searchStudents(); /* eslint-disable-next-line */ }, [fromDept, fromClass]);

  const availFromClasses = classes.filter(c => !fromDept || c.department_id === fromDept);
  const targetClass = classes.find(c => c.id === toClass);
  const availTargetFs = structures.filter(s => s.class_id === toClass);
  const selectedIds = Object.keys(selected).filter(id => selected[id]);
  const cName = (id) => classes.find(c => c.id === id)?.name || '-';
  const dName = (id) => depts.find(d => d.id === id)?.name || '-';

  const submit = async () => {
    if (!toClass) return toast.error('Pick a target class');
    if (selectedIds.length === 0) return toast.error('Select at least one student');
    if (!window.confirm(`Move ${selectedIds.length} students to ${cName(toClass)}? Their receipts, adjustments and audit trail stay intact.`)) return;
    setBusy(true);
    try {
      const { data } = await api.post('/students/bulk-reassign', {
        student_ids: selectedIds, to_class_id: toClass, to_fee_structure_id: toFs || null,
      });
      toast.success(`✓ ${data.reassigned} of ${selectedIds.length} students reassigned`);
      setRows([]); setSelected({}); setToClass(''); setToFs('');
    } catch (e) { toast.error(e?.response?.data?.detail || 'Failed'); }
    setBusy(false);
  };

  return (
    <>
      <PageHeader title="Assign Students to Classes" subtitle="Bulk-move students onto the correct English / Semi-English / JC class after seeding fee structures" />
      <div className="p-6 grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Search / filter */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white border border-slate-200 rounded p-4 flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-[220px] relative">
              <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
              <input value={q} onChange={e=>setQ(e.target.value)} onKeyDown={e=>e.key==='Enter'&&searchStudents()} placeholder="Search admission no, name or mobile…" className={`${inp} pl-9`} />
            </div>
            <select value={fromDept} onChange={e=>{setFromDept(e.target.value); setFromClass('');}} className={inp+' w-44'}><option value="">All depts</option>{depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
            <select value={fromClass} onChange={e=>setFromClass(e.target.value)} className={inp+' w-52'}><option value="">All classes</option>{availFromClasses.map(c => <option key={c.id} value={c.id}>{dName(c.department_id)} · {c.name}{c.medium?` (${c.medium})`:''}</option>)}</select>
            <button onClick={searchStudents} className="h-9 px-4 bg-slate-900 text-white rounded text-sm">Search</button>
          </div>

          <div className="bg-white border border-slate-200 rounded overflow-hidden">
            <div className="px-4 py-2 border-b border-slate-200 flex items-center justify-between">
              <div className="text-sm text-slate-700"><b>{rows.length}</b> shown · <b>{selectedIds.length}</b> selected</div>
              <button onClick={() => { const all = rows.every(s => selected[s.id]); setSelected(Object.fromEntries(rows.map(s => [s.id, !all]))); }} className="text-xs text-blue-700 hover:underline">Toggle all</button>
            </div>
            <table className="w-full dense-table">
              <thead><tr className="text-left text-[11px] uppercase tracking-wide text-slate-600"><th className="w-8"></th><th>Adm No</th><th>Student</th><th>Current Class</th><th>Dept</th></tr></thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan="5" className="text-center py-6 text-slate-500">No students found</td></tr>}
                {rows.map(s => (
                  <tr key={s.id}>
                    <td><input data-testid={`as-sel-${s.admission_no}`} type="checkbox" checked={!!selected[s.id]} onChange={() => setSelected({...selected, [s.id]: !selected[s.id]})} /></td>
                    <td className="font-mono text-[12px]">{s.admission_no}</td>
                    <td className="font-medium">{s.name}</td>
                    <td className="text-[12px]">{cName(s.class_id)}</td>
                    <td className="text-[12px]">{dName(s.department_id)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Target picker */}
        <div className="bg-white border border-slate-200 rounded p-5 h-fit sticky top-6">
          <div className="flex items-center gap-2 mb-3"><Users className="w-5 h-5 text-slate-600" /><h3 className="font-heading font-medium">Target Class</h3></div>
          <div className="space-y-3">
            <label className="block"><div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">Class</div>
              <select data-testid="as-to-class" value={toClass} onChange={e=>{setToClass(e.target.value); setToFs('');}} className={inp}>
                <option value="">Select…</option>
                {classes.map(c => <option key={c.id} value={c.id}>{dName(c.department_id)} · {c.name}{c.medium?` (${c.medium})`:''}</option>)}
              </select>
            </label>
            {targetClass && (
              <label className="block"><div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">Fee Structure ({availTargetFs.length} available)</div>
                <select value={toFs} onChange={e=>setToFs(e.target.value)} className={inp}>
                  <option value="">Leave unassigned</option>
                  {availTargetFs.map(fs => <option key={fs.id} value={fs.id}>{fs.academic_year} · ₹{fs.total?.toLocaleString('en-IN')} · {fs.items?.length} items</option>)}
                </select>
              </label>
            )}
            <button data-testid="as-submit" onClick={submit} disabled={busy || !toClass || selectedIds.length===0} className="w-full h-10 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded text-sm">
              {busy ? (
                <span className="inline-flex items-center gap-2"><span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></span> Moving {selectedIds.length}…</span>
              ) : `Move ${selectedIds.length} Student${selectedIds.length===1?'':'s'}`}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
const inp = "h-9 px-3 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-600 focus:border-blue-600 focus:outline-none bg-white w-full";
