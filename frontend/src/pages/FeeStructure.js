import React, { useEffect, useState } from 'react';
import api from '@/lib/api';
import { PageHeader, inr } from '@/components/Layout';
import { toast } from 'sonner';
import { Sparkles, Eye } from 'lucide-react';

export default function FeeStructure() {
  const [depts, setDepts] = useState([]);
  const [classes, setClasses] = useState([]);
  const [feeHeads, setFeeHeads] = useState([]);
  const [structures, setStructures] = useState([]);
  const [dept, setDept] = useState('');
  const [cls, setCls] = useState('');
  const [items, setItems] = useState([]);
  const [dup, setDup] = useState(null);
  const [seeding, setSeeding] = useState(false);
  const [preview, setPreview] = useState(null);
  const [yearFilter, setYearFilter] = useState('all');

  const reload = async () => {
    const [d, c, h, s] = await Promise.all([
      api.get('/departments'), api.get('/classes'), api.get('/fee-heads'), api.get('/fee-structures')
    ]);
    setDepts(d.data); setClasses(c.data); setFeeHeads(h.data); setStructures(s.data);
  };
  useEffect(() => { reload(); }, []);

  const seedYear = async (ay, label) => {
    if (!window.confirm(`Load all fee structures for ${ay} from the school's published fee-structure PDF (English Medium, Semi Medium (Marathi), Junior College)? Existing ${ay} structures loaded from this file will be REPLACED with the authoritative amounts.`)) return;
    setSeeding(true);
    try {
      const { data } = await api.post(`/fee-structures/seed?academic_year=${encodeURIComponent(ay)}&replace=true`);
      toast.success(`✓ ${label}: ${data.structures_created} structures loaded · ${data.classes_created} new classes · ${data.skipped} skipped (of ${data.total_rows} rows)`);
      await reload();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Failed'); }
    setSeeding(false);
  };

  const availableYears = [...new Set(structures.map(s => s.academic_year).filter(Boolean))].sort().reverse();
  const visibleStructures = yearFilter === 'all' ? structures : structures.filter(s => s.academic_year === yearFilter);

  useEffect(() => {
    api.get('/departments').then(r => setDepts(r.data));
    api.get('/classes').then(r => setClasses(r.data));
    api.get('/fee-heads').then(r => setFeeHeads(r.data));
    api.get('/fee-structures').then(r => setStructures(r.data));
  }, []);

  const availClasses = classes.filter(c => c.department_id === dept);
  const total = items.reduce((s,i)=>s+(parseFloat(i.amount)||0),0);

  const addItem = () => setItems([...items, { fee_head_id:'', amount:0 }]);
  const save = async () => {
    if (!dept || !cls) return toast.error('Select department & class');
    try {
      await api.post('/fee-structures', { department_id: dept, class_id: cls, academic_year:'2026-27', items });
      toast.success('Saved');
      await reload();
      setItems([]);
    } catch (e) { toast.error(e?.response?.data?.detail || 'Failed'); }
  };

  return (
    <>
      <PageHeader title="Fee Structure" subtitle="Define per department + class + academic year"
        actions={
          <div className="flex gap-2">
            <button data-testid="fs-seed" onClick={() => seedYear('2026-27', '2026-27')} disabled={seeding} className="h-9 px-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-sm rounded flex items-center gap-1.5">
              <Sparkles className="w-4 h-4" /> {seeding ? 'Loading…' : 'Load 2026-27 (current year)'}
            </button>
            <button data-testid="fs-seed-2025" onClick={() => seedYear('2025-26', '2025-26')} disabled={seeding} className="h-9 px-3 bg-slate-600 hover:bg-slate-700 disabled:opacity-60 text-white text-sm rounded flex items-center gap-1.5">
              <Sparkles className="w-4 h-4" /> {seeding ? 'Loading…' : 'Load 2025-26 (last year)'}
            </button>
          </div>
        }
      />
      <div className="p-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded p-4">
          <div className="grid grid-cols-2 gap-4 mb-4">
            <F label="Department"><select className={inp} value={dept} onChange={e=>{setDept(e.target.value); setCls('');}}><option value="">Select…</option>{depts.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></F>
            <F label="Class"><select className={inp} value={cls} onChange={e=>setCls(e.target.value)}><option value="">Select…</option>{availClasses.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></F>
          </div>
          <div className="text-[11px] uppercase tracking-wide text-slate-600 mb-2">Line Items</div>
          <table className="w-full dense-table">
            <thead><tr className="text-left text-[11px] uppercase text-slate-600"><th>Fee Head</th><th className="text-right">Amount</th></tr></thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i}>
                  <td><select className={`${inp} h-8`} value={it.fee_head_id} onChange={e=>{const c=[...items]; c[i].fee_head_id=e.target.value; setItems(c);}}>
                    <option value="">--</option>{feeHeads.map(fh=><option key={fh.id} value={fh.id}>{fh.name}</option>)}
                  </select></td>
                  <td><input type="number" className={`${inp} h-8 text-right`} value={it.amount} onChange={e=>{const c=[...items]; c[i].amount=e.target.value; setItems(c);}} /></td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr className="border-t border-slate-200 bg-slate-50"><td className="text-right font-medium">Total</td><td className="text-right font-mono tabular font-semibold">{inr(total)}</td></tr></tfoot>
          </table>
          <div className="flex justify-between mt-3">
            <button onClick={addItem} className="text-sm text-blue-700 hover:underline">+ Add item</button>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  if (!dept || !cls) return toast.error('Select department & class first');
                  const d = depts.find(x=>x.id===dept);
                  const c = classes.find(x=>x.id===cls);
                  setPreview({
                    department: d, klass: c, items,
                    total,
                    academic_year: '2026-27',
                    admission: items.filter(i => feeHeads.find(fh=>fh.id===i.fee_head_id)?.name?.toLowerCase() === 'admission fee').reduce((s,i)=>s+(+i.amount||0),0),
                    continuation: items.filter(i => feeHeads.find(fh=>fh.id===i.fee_head_id)?.name?.toLowerCase() === 'continuation fee').reduce((s,i)=>s+(+i.amount||0),0),
                  });
                }}
                data-testid="fs-preview"
                className="h-9 px-3 border border-slate-300 rounded text-sm hover:bg-slate-50 inline-flex items-center gap-1.5"
              ><Eye className="w-4 h-4" /> Preview</button>
              <button onClick={save} data-testid="fs-save" className="h-9 px-4 bg-blue-600 text-white rounded text-sm hover:bg-blue-700">Save Structure</button>
            </div>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded">
          <div className="px-4 py-2 border-b border-slate-200 flex items-center justify-between gap-2">
            <div className="font-heading font-medium text-sm">Existing Structures</div>
            <select data-testid="fs-year-filter" className="h-7 px-2 border border-slate-300 rounded text-xs bg-white" value={yearFilter} onChange={e=>setYearFilter(e.target.value)}>
              <option value="all">All years</option>
              {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div className="max-h-[500px] overflow-y-auto">
            {visibleStructures.length===0 && <div className="p-4 text-sm text-slate-500">None yet{yearFilter!=='all' ? ` for ${yearFilter}` : ''}</div>}
            {visibleStructures.map(s => {
              const d = depts.find(x=>x.id===s.department_id);
              const c = classes.find(x=>x.id===s.class_id);
              const isNewOnly = s.applies_to === 'new_only';
              const isReturningOnly = s.applies_to === 'returning_only';
              return <div key={s.id} className="p-3 border-b border-slate-100 text-sm flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium truncate">
                    {s.medium ? `${s.medium}` : d?.name} · {s.class_name || c?.name}
                    {s.stream && <span className="text-slate-500"> · {s.stream}</span>}
                  </div>
                  <div className="text-xs text-slate-500 flex items-center gap-2 flex-wrap">
                    <span>{s.academic_year}</span>
                    {isNewOnly && <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-semibold">NEW ADMISSION</span>}
                    {isReturningOnly && <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 text-[10px] font-semibold">RETURNING</span>}
                    <span className="font-mono tabular font-medium text-slate-900">{inr(s.total)}</span>
                    {(s.admission_fee > 0) && <span>· Adm {inr(s.admission_fee)}</span>}
                    {(s.continuation_fee > 0) && <span>· Cont {inr(s.continuation_fee)}</span>}
                    {(s.tuition_total > 0) && <span>· Tuition {inr(s.tuition_total)}</span>}
                  </div>
                </div>
                <button
                  data-testid={`fs-dup-${s.id}`}
                  onClick={() => setDup(s)}
                  className="text-xs h-7 px-2 border border-slate-300 rounded hover:bg-slate-50 text-slate-700 shrink-0"
                >Duplicate →</button>
              </div>;
            })}
          </div>
        </div>
      </div>
      {dup && <DuplicateModal src={dup} classes={classes} depts={depts} onClose={() => setDup(null)} onDone={async () => { setDup(null); const { data } = await api.get('/fee-structures'); setStructures(data); }} />}
      {preview && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 no-print" data-testid="fs-preview-modal">
          <div className="w-full max-w-2xl bg-white rounded-xl shadow-2xl overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="font-heading font-semibold">Structure Preview — {preview.department?.name} · {preview.klass?.name}</div>
              <button onClick={() => setPreview(null)} className="text-slate-400 hover:text-slate-700 text-xl leading-none">×</button>
            </div>
            <div className="p-6 space-y-4">
              <div className="text-[13px] text-slate-600">
                Review this structure before publishing. Once saved, students in this class will use these amounts automatically.
              </div>
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div className="bg-slate-50 p-3 rounded border border-slate-200">
                  <div className="text-[10px] uppercase tracking-widest text-slate-500">Admission (one-time)</div>
                  <div className="font-heading text-xl font-semibold tabular mt-1">{inr(preview.admission || 0)}</div>
                </div>
                <div className="bg-slate-50 p-3 rounded border border-slate-200">
                  <div className="text-[10px] uppercase tracking-widest text-slate-500">Continuation (returning)</div>
                  <div className="font-heading text-xl font-semibold tabular mt-1">{inr(preview.continuation || 0)}</div>
                </div>
                <div className="bg-blue-50 p-3 rounded border border-blue-200">
                  <div className="text-[10px] uppercase tracking-widest text-blue-700">Grand Total</div>
                  <div className="font-heading text-xl font-semibold tabular mt-1 text-blue-900">{inr(preview.total || 0)}</div>
                </div>
              </div>
              <div className="border border-slate-200 rounded overflow-hidden">
                <table className="w-full dense-table">
                  <thead><tr className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-600"><th className="pl-3 py-2">Fee Head</th><th className="text-right pr-3">Amount</th></tr></thead>
                  <tbody>
                    {preview.items.map((it, i) => {
                      const fh = feeHeads.find(h => h.id === it.fee_head_id);
                      return <tr key={i}><td className="pl-3 py-1.5">{fh?.name || '—'}</td><td className="text-right pr-3 tabular font-mono">{inr(+it.amount || 0)}</td></tr>;
                    })}
                    <tr className="bg-slate-100 border-t border-slate-300 font-semibold"><td className="pl-3 py-2">Total</td><td className="text-right pr-3 tabular font-mono">{inr(preview.total)}</td></tr>
                  </tbody>
                </table>
              </div>
            </div>
            <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-200 bg-slate-50">
              <button onClick={() => setPreview(null)} className="h-9 px-3 border border-slate-300 rounded text-sm">Keep Editing</button>
              <button
                data-testid="fs-preview-publish"
                onClick={async () => { setPreview(null); await save(); }}
                className="h-9 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-sm font-semibold"
              >Publish Structure →</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function DuplicateModal({ src, classes, depts, onClose, onDone }) {
  const [toClass, setToClass] = useState('');
  const [toAy, setToAy] = useState(src.academic_year || '');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (!toClass) return toast.error('Select target class');
    setBusy(true);
    try { await api.post(`/fee-structures/${src.id}/duplicate`, { to_class_id: toClass, to_academic_year: toAy }); toast.success('Fee structure duplicated'); onDone(); }
    catch (ex) { toast.error(ex?.response?.data?.detail || 'Failed'); }
    setBusy(false);
  };
  const srcClass = classes.find(c => c.id === src.class_id);
  const srcDept = depts.find(d => d.id === src.department_id);
  return (
    <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50 p-4">
      <form onSubmit={submit} className="bg-white rounded shadow-lg w-full max-w-md" data-testid="fs-dup-modal">
        <div className="px-5 py-3 border-b border-slate-200 font-heading font-medium">Duplicate Fee Structure</div>
        <div className="p-5 space-y-3">
          <div className="bg-slate-50 border border-slate-200 rounded p-3 text-sm">
            <div className="text-[11px] uppercase tracking-widest text-slate-500 mb-1">Source</div>
            <div>{srcDept?.name} · {srcClass?.name}</div>
            <div className="text-[12px] text-slate-500">{src.academic_year} · Total <span className="font-mono tabular font-medium">{inr(src.total)}</span> · {src.items?.length} items</div>
          </div>
          <label className="block"><div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">Target Class *</div>
            <select required className="w-full h-9 px-3 border border-slate-300 rounded text-sm bg-white" value={toClass} onChange={e=>setToClass(e.target.value)}>
              <option value="">Select…</option>
              {classes.filter(c => c.id !== src.class_id).map(c => {
                const d = depts.find(x => x.id === c.department_id);
                return <option key={c.id} value={c.id}>{d?.name} · {c.name}</option>;
              })}
            </select>
          </label>
          <label className="block"><div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">Target Academic Year</div>
            <input className="w-full h-9 px-3 border border-slate-300 rounded text-sm bg-white" value={toAy} onChange={e=>setToAy(e.target.value)} placeholder="2026-27" />
          </label>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-200 bg-slate-50">
          <button type="button" onClick={onClose} className="h-9 px-3 border border-slate-300 rounded text-sm">Cancel</button>
          <button data-testid="fs-dup-submit" disabled={busy} className="h-9 px-4 bg-blue-600 text-white rounded text-sm disabled:opacity-60">{busy ? 'Duplicating…' : 'Duplicate'}</button>
        </div>
      </form>
    </div>
  );
}
const inp = "w-full h-9 px-3 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-600 focus:border-blue-600 focus:outline-none bg-white";
const F = ({label,children}) => <label className="block"><div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">{label}</div>{children}</label>;
