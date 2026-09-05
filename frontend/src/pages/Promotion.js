import React, { useEffect, useState } from 'react';
import api from '@/lib/api';
import { PageHeader } from '@/components/Layout';
import { toast } from 'sonner';
import { ArrowRight, RefreshCw, AlertTriangle } from 'lucide-react';

export default function Promotion() {
  const [depts, setDepts] = useState([]);
  const [classes, setClasses] = useState([]);
  const [structures, setStructures] = useState([]);
  const [dept, setDept] = useState('');
  const [fromClass, setFromClass] = useState('');
  const [toClass, setToClass] = useState('');
  const [feeStructure, setFeeStructure] = useState('');
  const [ay, setAy] = useState('2027-28');
  const [preview, setPreview] = useState([]);
  const [fromAY, setFromAY] = useState('2026-27');
  const [toAY, setToAY] = useState('2027-28');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/departments').then(r => setDepts(r.data));
    api.get('/classes').then(r => setClasses(r.data));
    api.get('/fee-structures').then(r => setStructures(r.data));
  }, []);

  useEffect(() => {
    if (fromClass) api.get(`/students?class_id=${fromClass}&limit=1000`).then(r => setPreview(r.data));
    else setPreview([]);
  }, [fromClass]);

  const availClasses = classes.filter(c => c.department_id === dept);
  const toClassFS = structures.filter(s => s.class_id === toClass);

  const runPromote = async () => {
    if (!fromClass || !toClass) return toast.error('Choose from and to classes');
    if (!window.confirm(`Promote ${preview.length} students to the selected class?`)) return;
    setBusy(true);
    try {
      const { data } = await api.post('/students/promote', {
        from_class_id: fromClass, to_class_id: toClass,
        to_fee_structure_id: feeStructure || null, new_academic_year: ay || null,
      });
      toast.success(`${data.promoted} students promoted from ${data.from_class} → ${data.to_class}`);
      setPreview([]); setFromClass(''); setToClass('');
    } catch (e) { toast.error(e?.response?.data?.detail || 'Failed'); }
    setBusy(false);
  };

  const runRollover = async () => {
    if (!window.confirm(`Copy all fee structures from ${fromAY} to ${toAY}? Existing structures in ${toAY} will not be overwritten.`)) return;
    setBusy(true);
    try {
      const { data } = await api.post('/fee-structures/rollover', { from_academic_year: fromAY, to_academic_year: toAY });
      toast.success(`${data.created} fee structures rolled over`);
      const s = await api.get('/fee-structures'); setStructures(s.data);
      const d = await api.get('/departments'); setDepts(d.data);
    } catch (e) { toast.error(e?.response?.data?.detail || 'Failed'); }
    setBusy(false);
  };

  const cName = id => classes.find(c=>c.id===id)?.name || '-';

  return (
    <>
      <PageHeader title="Year-End Promotion" subtitle="Promote a class in bulk and roll over fee structures to the new academic year" />
      <div className="p-6 grid grid-cols-1 lg:grid-cols-3 gap-6">

        <div className="lg:col-span-2 bg-white border border-slate-200 rounded p-5 space-y-4">
          <div className="text-[11px] tracking-widest uppercase text-slate-500 font-medium">Class Promotion</div>
          <div className="grid grid-cols-2 gap-4">
            <F label="Department">
              <select className={inp} value={dept} onChange={e=>{setDept(e.target.value); setFromClass(''); setToClass('');}}>
                <option value="">Select…</option>{depts.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </F>
            <F label="New Academic Year">
              <input className={inp} value={ay} onChange={e=>setAy(e.target.value)} placeholder="2027-28" />
            </F>
          </div>
          <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-3">
            <F label="From Class">
              <select data-testid="promo-from" className={inp} value={fromClass} onChange={e=>setFromClass(e.target.value)}>
                <option value="">Select…</option>{availClasses.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </F>
            <ArrowRight className="w-5 h-5 text-slate-400 mb-2.5" />
            <F label="To Class">
              <select data-testid="promo-to" className={inp} value={toClass} onChange={e=>setToClass(e.target.value)}>
                <option value="">Select…</option>{availClasses.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </F>
          </div>
          <F label="New Fee Structure (optional — for the target class in the new year)">
            <select className={inp} value={feeStructure} onChange={e=>setFeeStructure(e.target.value)}>
              <option value="">Leave unassigned (office will assign later)</option>
              {toClassFS.map(s => <option key={s.id} value={s.id}>{s.academic_year} · ₹{s.total?.toLocaleString('en-IN')}</option>)}
            </select>
          </F>

          {preview.length > 0 && (
            <div className="border border-slate-200 rounded bg-slate-50">
              <div className="px-3 py-2 text-[12px] border-b border-slate-200 text-slate-700">
                <b>{preview.length}</b> active students will be promoted{fromClass && ` out of ${cName(fromClass)}`}
              </div>
              <div className="max-h-40 overflow-y-auto text-[12px]">
                {preview.map(s => (
                  <div key={s.id} className="px-3 py-1 border-b border-slate-100 last:border-0 flex justify-between">
                    <span><span className="font-mono text-slate-500">{s.admission_no}</span> · {s.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">
            <AlertTriangle className="w-4 h-4" /> Old ledger, receipts and audit trail remain intact. Only the current class + fee structure change.
          </div>

          <button data-testid="promo-submit" onClick={runPromote} disabled={busy || !fromClass || !toClass} className="h-10 px-4 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-60">
            Promote {preview.length} Student{preview.length===1?'':'s'}
          </button>
        </div>

        <div className="bg-white border border-slate-200 rounded p-5 space-y-4 h-fit">
          <div className="text-[11px] tracking-widest uppercase text-slate-500 font-medium">Fee Structure Rollover</div>
          <p className="text-[13px] text-slate-600">Clone every fee structure from the old academic year into the new one. Existing structures for the new year are preserved.</p>
          <F label="From Academic Year"><input className={inp} value={fromAY} onChange={e=>setFromAY(e.target.value)} /></F>
          <F label="To Academic Year"><input className={inp} value={toAY} onChange={e=>setToAY(e.target.value)} /></F>
          <button data-testid="rollover-submit" onClick={runRollover} disabled={busy} className="h-10 w-full px-4 bg-slate-900 text-white rounded text-sm hover:bg-slate-800 flex items-center justify-center gap-2 disabled:opacity-60">
            <RefreshCw className="w-4 h-4" /> Rollover Fee Structures
          </button>
          <div className="text-[11px] text-slate-500">This also bumps each department's current academic year to the new value.</div>
        </div>
      </div>
    </>
  );
}
const inp = "w-full h-9 px-3 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-600 focus:border-blue-600 focus:outline-none bg-white";
const F = ({label, children}) => <label className="block"><div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">{label}</div>{children}</label>;
