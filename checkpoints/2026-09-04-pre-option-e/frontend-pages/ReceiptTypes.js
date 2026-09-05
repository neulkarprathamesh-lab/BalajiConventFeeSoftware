import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import api from '@/lib/api';
import { PageHeader } from '@/components/Layout';
import AdminPinPrompt from '@/components/AdminPinPrompt';
import { Plus, Edit2, Trash2, Eye, EyeOff, Save, X, Shield, Globe, RotateCcw, Loader2 } from 'lucide-react';
import { PAPER_SIZES, paperOptions } from '@/components/receipt/PaperSizes';
import { doPrint } from '@/components/receipt/receiptExporter';

const CATEGORIES = [
  { v: 'school',  label: 'School' },
  { v: 'bus',     label: 'Bus' },
  { v: 'finance', label: 'Finance' },
  { v: 'misc',    label: 'Misc' },
];
const ICON_CHOICES = ['GraduationCap','BookOpen','Award','Bus','ClipboardList','Wallet','School'];
const FIELD_KEYS = ['admission_no','roll_no','parent_name','mobile','class','division','department','academic_year','session','fee_head','amount_in_words','payment_mode','transaction_id','cashier_name','authorized_by','remarks'];
const FIELD_LABELS = { admission_no:'Admission No', roll_no:'Roll No', parent_name:'Parent Name', mobile:'Mobile', class:'Class', division:'Division', department:'Department', academic_year:'Academic Year', session:'Session', fee_head:'Fee Head', amount_in_words:'Amount in Words', payment_mode:'Payment Mode', transaction_id:'Transaction ID', cashier_name:'Cashier Name', authorized_by:'Authorized By', remarks:'Remarks' };

const empty = {
  code:'', name:'', department_name:'', category:'school', description:'', icon:'GraduationCap',
  display_order:100, enabled:true, tabs:['school','installment','misc'],
  paper_size:'A5', orientation:'portrait',
  theme:'bw', signature_layout:'row',
  signatures_config: { receiver:true, accountant:true, principal:true, director:true },
  margins_mm: { top:8, right:8, bottom:8, left:8 },
  header_text:'', footer_text:'', watermark_text:'', watermark_enabled:false,
  barcode_enabled:false, qr_enabled:true, signature_area_enabled:true, computer_generated_note:'This is a computer-generated receipt.',
  starting_number:1, auto_reset_yearly:true,
  fields: FIELD_KEYS.reduce((a,k)=>({...a,[k]: ['roll_no','division','session','authorized_by'].includes(k) ? false : true}), {}),
};


export default function ReceiptTypes() {
  const [rows, setRows] = useState([]);
  const [editing, setEditing] = useState(null); // full row or 'new'
  const [prompt, setPrompt] = useState(null);
  const [preview, setPreview] = useState(null);
  const [resetSeq, setResetSeq] = useState(null);
  const [applyAllConfirm, setApplyAllConfirm] = useState(null); // {rt, headers}
  const [resettingFormat, setResettingFormat] = useState(false);

  const load = () => api.get('/receipt-types?include_disabled=true').then(r => setRows(r.data)).catch(()=>toast.error('Failed to load'));
  useEffect(() => { load(); }, []);

  const withPin = (title, message, fn, dual = false) => setPrompt({ mode: dual ? 'dual' : 'pin', title, message, onOk: async (headers) => { await fn(headers); load(); } });

  const doSave = async (body, headers, applyToAll) => {
    let saved;
    if (editing === 'new') {
      const r = await api.post('/receipt-types', body, { headers });
      saved = r.data;
      toast.success('Receipt type created');
    } else {
      const r = await api.patch(`/receipt-types/${editing.id}`, body, { headers });
      saved = r.data;
      toast.success('Receipt type updated');
    }
    setEditing(null);
    // The "Apply to all receipt types" confirmation happens AFTER the save
    // succeeds and reuses the PIN already verified for this save - no need
    // to make the administrator re-enter it for what is really one action.
    if (applyToAll && saved?.id) setApplyAllConfirm({ rt: saved, headers });
  };

  const applyFormatToAll = async () => {
    if (!applyAllConfirm) return;
    try {
      const { data } = await api.post(`/receipt-types/${applyAllConfirm.rt.id}/apply-format-to-all`, null, { headers: applyAllConfirm.headers });
      toast.success(`Applied to all ${data.applied_to} receipt types — this is now the school-wide format.`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Failed to apply format to all receipt types');
    } finally {
      setApplyAllConfirm(null);
      load();
    }
  };

  const resetFormatToDefault = () => withPin(
    'Reset Receipt Format to Default',
    'This restores the school\'s original factory receipt format on every receipt type (paper size, margins, signatures, watermark, visible fields). Historical receipts already issued are never changed.',
    async (headers) => {
      setResettingFormat(true);
      try {
        const { data } = await api.post('/receipt-types/format/reset-to-default', null, { headers });
        toast.success(`Reset ${data.reset_count} receipt types to the default format.`);
      } finally { setResettingFormat(false); }
    },
  );

  const doDelete = async (row, headers) => {
    try { await api.delete(`/receipt-types/${row.id}`, { headers }); toast.success('Deleted'); }
    catch (e) {
      const d = e?.response?.data?.detail;
      if (typeof d === 'object' && d?.can_archive) {
        if (window.confirm(`${d.message}\n\nArchive instead?`)) {
          await api.post(`/receipt-types/${row.id}/archive`, null, { headers });
          toast.success('Archived — history preserved');
        }
      } else { toast.error(typeof d === 'string' ? d : 'Delete failed'); }
    }
  };

  const toggle = (row) => withPin('Enable / Disable Receipt Type', 'Toggle visibility for cashiers.',
    async (h) => { await api.patch(`/receipt-types/${row.id}`, { enabled: !row.enabled }, { headers: h }); toast.success(row.enabled ? 'Disabled' : 'Enabled'); });

  return (
    <>
      <PageHeader title="Receipt Type Management"
        subtitle="Add, edit, archive receipt types. All changes require the Administrator PIN."
        actions={
          <div className="flex items-center gap-2">
            <button data-testid="rtm-reset-format" onClick={resetFormatToDefault} disabled={resettingFormat}
              className="h-9 px-3 border border-slate-300 rounded text-sm hover:bg-slate-50 disabled:opacity-60 flex items-center gap-1.5" title="Restore the original receipt format on every receipt type">
              {resettingFormat ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />} Reset to Default
            </button>
            <button data-testid="rtm-new" onClick={() => setEditing('new')} className="h-9 px-4 bg-slate-900 text-white rounded text-sm flex items-center gap-1.5"><Plus className="w-4 h-4" /> New Receipt Type</button>
          </div>
        }
      />
      <div className="p-6">
        <div className="bg-amber-50 border border-amber-200 rounded p-3 text-[12px] text-amber-900 mb-4 flex items-center gap-2">
          <Shield className="w-4 h-4" /> Every add / edit / delete / disable requires your Administrator PIN. Set the PIN in <b>My Profile → Security</b> if you haven't yet.
        </div>
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-[11px] uppercase tracking-wide text-slate-600">
              <tr className="text-left">
                <th className="px-3 py-2">Order</th><th className="px-3 py-2">Prefix</th><th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Department</th><th className="px-3 py-2">Category</th>
                <th className="px-3 py-2">Status</th><th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan="7" className="p-6 text-center text-slate-500 text-[13px]">No receipt types</td></tr>}
              {rows.map((r, i) => (
                <tr key={r.id} data-testid={`rtm-row-${r.code}`} className={`border-b border-slate-100 last:border-0 ${r.archived ? 'bg-slate-50 text-slate-400' : ''}`}>
                  <td className="px-3 py-2 font-mono text-[11px]">{r.display_order}</td>
                  <td className="px-3 py-2"><span className="font-mono font-bold px-2 py-0.5 rounded bg-slate-900 text-white text-[11px]">{r.code}</span></td>
                  <td className="px-3 py-2 font-medium">{r.name}</td>
                  <td className="px-3 py-2 text-[12px] text-slate-600">{r.department_name || '—'}</td>
                  <td className="px-3 py-2 capitalize text-[12px]">{r.category}</td>
                  <td className="px-3 py-2">
                    {r.archived ? <span className="text-[11px] text-slate-500 bg-slate-100 border border-slate-200 rounded-full px-2 py-0.5">Archived</span>
                     : r.enabled ? <span className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">Active</span>
                     : <span className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">Disabled</span>}
                  </td>
                  <td className="px-3 py-2 text-right space-x-1">
                    <button data-testid={`rtm-edit-${r.code}`} onClick={()=>setEditing(r)} className="p-1.5 border border-slate-300 rounded text-slate-700 hover:bg-slate-50" title="Edit"><Edit2 className="w-3.5 h-3.5" /></button>
                    <button onClick={()=>toggle(r)} className="p-1.5 border border-slate-300 rounded text-slate-700 hover:bg-slate-50" title={r.enabled ? 'Disable' : 'Enable'}>{r.enabled ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}</button>
                    <button data-testid={`rtm-del-${r.code}`} onClick={()=>withPin('Delete Receipt Type', `Delete "${r.name}"?`, (h) => doDelete(r, h))} className="p-1.5 border border-red-300 text-red-700 rounded hover:bg-red-50" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editing && <EditModal row={editing === 'new' ? empty : editing} isNew={editing === 'new'}
        onCancel={() => setEditing(null)}
        onPreview={(current) => setPreview(current)}
        onResetSeq={(cur) => setResetSeq(cur)}
        onSave={(body, applyToAll) => withPin(editing === 'new' ? 'Create Receipt Type' : 'Edit Receipt Type', 'This action modifies receipt configuration.', (h) => doSave(body, h, applyToAll))} />}
      {preview && <PreviewModal rt={preview} onClose={()=>setPreview(null)} />}
      {resetSeq && <ResetSequenceModal rt={resetSeq} onClose={()=>setResetSeq(null)} onDone={load} />}
      {applyAllConfirm && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4" data-testid="rtm-apply-all-confirm">
          <div className="bg-white rounded-lg shadow-2xl w-full max-w-sm border-t-4 border-blue-600">
            <div className="p-5 border-b border-slate-200 flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-700 flex items-center justify-center flex-shrink-0"><Globe className="w-5 h-5" /></div>
              <div className="flex-1">
                <div className="font-heading font-bold text-slate-900">Apply this receipt format to all future receipts?</div>
                <div className="text-[12px] text-slate-600 mt-1">
                  "{applyAllConfirm.rt.name}"'s printing format becomes the school-wide template used by every receipt type, every Client PC, and everyone permitted to print receipts. Receipts already issued are not changed.
                </div>
              </div>
            </div>
            <div className="p-4 flex items-center justify-end gap-2">
              <button onClick={() => setApplyAllConfirm(null)} data-testid="rtm-apply-all-cancel" className="h-9 px-4 border border-slate-300 rounded text-sm hover:bg-slate-50">Cancel</button>
              <button onClick={applyFormatToAll} data-testid="rtm-apply-all-confirm-btn" className="h-9 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm font-semibold">Apply to All Receipts</button>
            </div>
          </div>
        </div>
      )}
      <AdminPinPrompt prompt={prompt} onClose={()=>setPrompt(null)} />
    </>
  );
}

const EditModal = ({ row, isNew, onCancel, onSave, onResetSeq, onPreview }) => {
  const [f, setF] = useState({ ...empty, ...row, fields: { ...empty.fields, ...(row.fields || {}) } });
  const [tab, setTab] = useState('general');
  const [applyToAll, setApplyToAll] = useState(false);
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const setField = (k, v) => setF(x => ({ ...x, fields: { ...x.fields, [k]: v } }));
  const submit = (e) => {
    e.preventDefault();
    if (!f.code || !f.name) return;
    onSave({ ...f, code: f.code.toUpperCase(), display_order: Number(f.display_order) || 100, starting_number: Number(f.starting_number) || 1 }, applyToAll);
  };
  const TABS = [['general','General'],['printing','Printing'],['numbering','Numbering'],['fields','Fields']];
  return (
    <div className="fixed inset-0 bg-slate-900/60 z-40 flex items-center justify-center p-4" onClick={onCancel}>
      <form onSubmit={submit} onClick={e=>e.stopPropagation()} className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between">
          <div className="font-heading font-semibold">{isNew ? 'New Receipt Type' : `Edit — ${row.name}`}</div>
          <button type="button" onClick={onCancel} className="text-slate-400 hover:text-slate-700"><X className="w-4 h-4" /></button>
        </div>
        <div className="px-5 pt-3 border-b border-slate-200 flex gap-1">
          {TABS.map(([v,l]) => (
            <button key={v} type="button" onClick={()=>setTab(v)} data-testid={`rtm-tab-${v}`}
              className={`px-3 pb-2 -mb-px border-b-2 text-[13px] ${tab===v ? 'border-blue-600 text-blue-700 font-semibold' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>{l}</button>
          ))}
        </div>
        <div className="p-5 overflow-y-auto flex-1">
          {tab==='general' && (
            <div className="grid grid-cols-2 gap-3 text-[13px]">
              <Field label="Prefix (e.g. EP, MP, JCACS)" required><input data-testid="rtm-code" value={f.code} onChange={e=>set('code', e.target.value.toUpperCase())} maxLength={8} className="w-full h-9 px-3 border border-slate-300 rounded font-mono text-sm uppercase" placeholder="EP" /></Field>
              <Field label="Category"><select value={f.category} onChange={e=>set('category', e.target.value)} className="w-full h-9 px-3 border border-slate-300 rounded bg-white">{CATEGORIES.map(c => <option key={c.v} value={c.v}>{c.label}</option>)}</select></Field>
              <Field label="Receipt Name" required span={2}><input data-testid="rtm-name" value={f.name} onChange={e=>set('name', e.target.value)} className="w-full h-9 px-3 border border-slate-300 rounded text-sm" /></Field>
              <Field label="Department Name (printed)" span={2}><input value={f.department_name || ''} onChange={e=>set('department_name', e.target.value)} className="w-full h-9 px-3 border border-slate-300 rounded text-sm" /></Field>
              <Field label="Description" span={2}><textarea value={f.description || ''} onChange={e=>set('description', e.target.value)} rows={2} className="w-full px-3 py-2 border border-slate-300 rounded text-sm" /></Field>
              <Field label="Icon"><select value={f.icon || 'GraduationCap'} onChange={e=>set('icon', e.target.value)} className="w-full h-9 px-3 border border-slate-300 rounded bg-white">{ICON_CHOICES.map(i => <option key={i}>{i}</option>)}</select></Field>
              <Field label="Display Order"><input type="number" value={f.display_order || 100} onChange={e=>set('display_order', e.target.value)} className="w-full h-9 px-3 border border-slate-300 rounded" /></Field>
              <Field label="Enabled" span={2}>
                <label className="inline-flex items-center gap-2"><input type="checkbox" checked={!!f.enabled} onChange={e=>set('enabled', e.target.checked)} /> Show this receipt type to cashiers</label>
              </Field>
            </div>
          )}
          {tab==='printing' && (
            <div className="grid grid-cols-2 gap-3 text-[13px]">
              <Field label="Paper Size"><select value={f.paper_size} onChange={e=>set('paper_size', e.target.value)} className="w-full h-9 px-3 border border-slate-300 rounded bg-white">{paperOptions().map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select></Field>
              <Field label="Orientation"><select value={f.orientation} onChange={e=>set('orientation', e.target.value)} className="w-full h-9 px-3 border border-slate-300 rounded bg-white">{['portrait','landscape'].map(x=><option key={x}>{x}</option>)}</select></Field>
              <Field label="Header Text" span={2}><input value={f.header_text || ''} onChange={e=>set('header_text', e.target.value)} className="w-full h-9 px-3 border border-slate-300 rounded" placeholder="Extra line printed above the school name" /></Field>
              <Field label="Footer Text" span={2}><input value={f.footer_text || ''} onChange={e=>set('footer_text', e.target.value)} className="w-full h-9 px-3 border border-slate-300 rounded" placeholder="Extra line printed at the bottom" /></Field>
              <Field label="Watermark Text"><input value={f.watermark_text || ''} onChange={e=>set('watermark_text', e.target.value)} className="w-full h-9 px-3 border border-slate-300 rounded" placeholder="e.g. ORIGINAL / DUPLICATE" /></Field>
              <Field label="Watermark Enabled">
                <label className="inline-flex items-center gap-2 h-9"><input type="checkbox" checked={!!f.watermark_enabled} onChange={e=>set('watermark_enabled', e.target.checked)} /> Show watermark on printed receipt</label>
              </Field>
              <Field label="QR Code"><label className="inline-flex items-center gap-2 h-9"><input type="checkbox" checked={!!f.qr_enabled} onChange={e=>set('qr_enabled', e.target.checked)} /> Print verification QR</label></Field>
              <Field label="Barcode"><label className="inline-flex items-center gap-2 h-9"><input type="checkbox" checked={!!f.barcode_enabled} onChange={e=>set('barcode_enabled', e.target.checked)} /> Print receipt-no barcode</label></Field>
              <Field label="Signature Area"><label className="inline-flex items-center gap-2 h-9"><input type="checkbox" checked={!!f.signature_area_enabled} onChange={e=>set('signature_area_enabled', e.target.checked)} /> Show signature block</label></Field>
              <Field label="Computer Generated Note" span={2}><input value={f.computer_generated_note || ''} onChange={e=>set('computer_generated_note', e.target.value)} className="w-full h-9 px-3 border border-slate-300 rounded" /></Field>
              {!isNew && (
                <div className="col-span-2 mt-1 p-3 bg-blue-50 border border-blue-200 rounded">
                  <label className="inline-flex items-start gap-2 cursor-pointer">
                    <input type="checkbox" checked={applyToAll} onChange={e=>setApplyToAll(e.target.checked)} className="mt-0.5" data-testid="rtm-apply-to-all-checkbox" />
                    <span className="text-[12.5px] text-blue-900">
                      <span className="font-semibold">Apply changes to all receipts</span> — make this the school-wide receipt format for every receipt type, on every Client PC. Historical receipts already issued are never changed; you'll be asked to confirm after saving.
                    </span>
                  </label>
                </div>
              )}
            </div>
          )}
          {tab==='numbering' && (
            <div className="grid grid-cols-2 gap-3 text-[13px]">
              <Field label="Starting Number"><input type="number" value={f.starting_number || 1} onChange={e=>set('starting_number', e.target.value)} className="w-full h-9 px-3 border border-slate-300 rounded font-mono" /></Field>
              <Field label="Current Number (read-only)"><input type="number" value={f.current_number ?? ''} readOnly className="w-full h-9 px-3 border border-slate-300 rounded font-mono bg-slate-50" placeholder="auto" /></Field>
              <Field label="Auto-Reset on new Academic Year" span={2}>
                <label className="inline-flex items-center gap-2 h-9"><input type="checkbox" checked={!!f.auto_reset_yearly} onChange={e=>set('auto_reset_yearly', e.target.checked)} /> Sequence resets to Starting Number every academic year</label>
              </Field>
              <div className="col-span-2 border-t border-slate-200 pt-3 mt-1">
                <div className="p-3 bg-red-50 border-2 border-red-300 rounded">
                  <div className="flex items-center gap-2 mb-2"><Shield className="w-4 h-4 text-red-700" /><span className="font-heading font-bold text-red-900 text-sm">Manual Sequence Reset</span></div>
                  <div className="text-[12px] text-red-800 mb-2">High-risk. Requires <b>dual authorisation</b> (Admin PIN + Password) and a reason. Prevents duplicate numbers by refusing values ≤ highest existing receipt.</div>
                  {!isNew && <button type="button" data-testid="rtm-reset-seq" onClick={() => onResetSeq(row)} className="h-8 px-3 border border-red-600 bg-white text-red-700 hover:bg-red-100 rounded text-[12px] font-semibold">Reset Current Sequence…</button>}
                  {isNew && <div className="text-[11px] text-red-700 italic">Save this receipt type first before resetting the sequence.</div>}
                </div>
              </div>
            </div>
          )}
          {tab==='fields' && (
            <div>
              <div className="text-[12px] text-slate-600 mb-3">Toggle which fields appear on this receipt template. Turning a field off hides it on both the entry form and the printed page.</div>
              <div className="grid grid-cols-2 gap-2">
                {FIELD_KEYS.map(k => (
                  <label key={k} className={`flex items-center justify-between px-3 py-2 border rounded ${f.fields?.[k] ? 'bg-emerald-50 border-emerald-200' : 'bg-slate-50 border-slate-200'}`}>
                    <span className="text-[13px]">{FIELD_LABELS[k]}</span>
                    <input data-testid={`rtm-field-${k}`} type="checkbox" checked={!!f.fields?.[k]} onChange={e=>setField(k, e.target.checked)} />
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="px-5 py-3 border-t border-slate-200 flex justify-between gap-2">
          <button type="button" onClick={() => onPreview(f)} data-testid="rtm-preview" className="h-9 px-4 border border-slate-300 rounded text-sm hover:bg-slate-50 flex items-center gap-1.5"><Eye className="w-4 h-4" /> Live Preview</button>
          <div className="flex gap-2">
            <button type="button" onClick={onCancel} className="h-9 px-4 border border-slate-300 rounded text-sm">Cancel</button>
            <button type="submit" data-testid="rtm-save" className="h-9 px-4 bg-slate-900 text-white rounded text-sm font-semibold flex items-center gap-1.5"><Save className="w-4 h-4" /> Save (requires PIN)</button>
          </div>
        </div>
      </form>
    </div>
  );
};
const Field = ({ label, children, span = 1, required = false }) => (
  <label className={`block ${span === 2 ? 'col-span-2' : ''}`}>
    <div className="text-[11px] uppercase tracking-widest text-slate-600 mb-1">{label}{required && <span className="text-red-600 ml-0.5">*</span>}</div>
    {children}
  </label>
);

// ---------- Live Preview Modal ----------
const PreviewModal = ({ rt, onClose }) => {
  const [testCopy, setTestCopy] = useState(false);
  const doTestPrint = () => { setTestCopy(true); setTimeout(() => { doPrint(paper); setTestCopy(false); }, 200); };
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });
  const paper = rt?.paper_size || 'A4';
  const paperDef = PAPER_SIZES[paper] || PAPER_SIZES.A4;
  const orient = rt?.orientation || paperDef.orientation || 'portrait';
  const F = rt?.fields || {};
  const show = (k) => F[k] !== false;
  const qrOn = rt?.qr_enabled !== false;
  const barcodeOn = !!rt?.barcode_enabled;
  const wmOn = !!rt?.watermark_enabled || testCopy;
  const wmText = testCopy ? 'TEST COPY' : (rt?.watermark_text || 'OFFICIAL');
  const sampleNumber = `${rt?.code || 'PRE'}-2026-000999`;
  return (
    <div className="fixed inset-0 bg-slate-900/70 z-50 flex items-start justify-center p-4 overflow-y-auto print:relative print:bg-white print:p-0" onClick={onClose}>
      <style>{`@media print { @page { size: ${paperDef.print}; margin: 8mm; } .no-print { display: none !important; } }`}</style>
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-[820px] my-6 print:my-0 print:max-w-none print:shadow-none" onClick={e=>e.stopPropagation()}>
        <div className="px-4 py-2 border-b border-slate-200 flex items-center justify-between no-print">
          <div>
            <div className="font-heading font-semibold">Live Preview — {rt?.name || 'New receipt type'}</div>
            <div className="text-[11px] text-slate-500">Paper: {paper} · {orient} · reflects unsaved changes · WYSIWYG</div>
          </div>
          <div className="flex gap-2">
            <button onClick={doTestPrint} data-testid="rtm-test-print" className="h-9 px-4 bg-amber-500 hover:bg-amber-600 text-white rounded text-sm font-semibold">Test Print</button>
            <button onClick={()=>doPrint(paper)} className="h-9 px-4 bg-slate-900 text-white rounded text-sm font-semibold">Print</button>
            <button onClick={onClose} className="h-9 px-3 border border-slate-300 rounded text-sm">Close</button>
          </div>
        </div>
        <div className="p-6 relative text-[13px] text-slate-900">
          {wmOn && (
            <div aria-hidden className="absolute inset-0 pointer-events-none flex items-center justify-center print:flex" style={{ zIndex: 0 }}>
              <div className={`font-heading font-black text-[120px] tracking-tighter rotate-[-24deg] ${testCopy ? 'text-red-600 opacity-30' : 'text-slate-900 opacity-[0.06]'} select-none`}>{wmText}</div>
            </div>
          )}
          <div className="relative bg-slate-900 text-white flex items-center justify-between px-4 py-2 -mx-6 -mt-6 mb-4">
            <div className="flex items-center gap-2.5">
              <img src="/school-logo.jpeg" alt="logo" className="w-8 h-8 rounded-full object-cover ring-1 ring-slate-700" />
              <div className="leading-tight">
                <div className="font-heading font-semibold text-[13px]">{rt?.name || 'Balaji Convent · Receipt Manager'}</div>
                <div className="text-[9px] uppercase tracking-widest text-slate-300">Official Fee Receipt</div>
              </div>
            </div>
            <div className="text-right text-[10px] leading-tight">
              <div className="font-mono font-bold text-[12px]">{sampleNumber}</div>
              <div className="text-slate-300">{dateStr}</div>
            </div>
          </div>
          {rt?.header_text && <div className="relative text-center text-[11px] font-semibold uppercase tracking-widest text-slate-700 pb-2 border-b border-slate-200 mb-2">{rt.header_text}</div>}
          <div className="relative grid grid-cols-12 gap-3 pb-4 border-b-2 border-slate-900">
            <div className="col-span-6 flex items-start gap-3">
              <img src="/school-logo.jpeg" alt="logo" className="w-20 h-20 rounded-full object-cover ring-1 ring-slate-300" />
              <div>
                <div className="font-heading font-black text-xl tracking-tight uppercase">{(rt?.name || 'BALAJI CONVENT').toUpperCase()}</div>
                <div className="text-[13px] font-bold tracking-wide uppercase text-slate-800">BUTIBORI, NAGPUR</div>
                <div className="text-[10px] text-slate-600">{rt?.department_name || '—'}</div>
                {rt?.description && <div className="text-[10px] text-slate-600">{rt.description}</div>}
              </div>
            </div>
            <div className="col-span-3 text-center border-x border-slate-300 px-3">
              <div className="inline-block bg-slate-900 text-white px-4 py-1 font-bold tracking-widest text-[13px]">FEE RECEIPT</div>
            </div>
            <div className="col-span-3 text-right text-[11px]">
              <div className="text-slate-500 uppercase tracking-widest text-[9px]">Receipt No.</div>
              <div className="font-mono font-bold">{sampleNumber}</div>
              {qrOn && <div className="flex justify-end mt-1"><div className="w-14 h-14 bg-slate-200 rounded flex items-center justify-center text-[9px] text-slate-500">QR</div></div>}
            </div>
          </div>
          <div className="relative mt-3 border border-slate-300">
            <div className="bg-slate-100 border-b border-slate-300 text-center py-1 text-[11px] font-bold tracking-widest">DETAILS</div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 p-3 text-[12px]">
              {show('admission_no') && <div><span className="text-slate-500">ADMISSION NO. :</span> <b className="font-mono">BC-EP-999</b></div>}
              {show('parent_name') && <div><span className="text-slate-500">PARENT :</span> <b>Rajesh Sharma</b></div>}
              {show('class') && <div><span className="text-slate-500">CLASS :</span> <b>Class 3</b></div>}
              {show('mobile') && <div><span className="text-slate-500">MOBILE :</span> <b className="font-mono">98765XXXXX</b></div>}
              {show('roll_no') && <div><span className="text-slate-500">ROLL NO. :</span> <b>15</b></div>}
              {show('department') && <div><span className="text-slate-500">DEPT :</span> <b>{rt?.department_name || 'English Primary'}</b></div>}
              {show('session') && <div><span className="text-slate-500">SESSION :</span> <b>2026-27</b></div>}
              {show('academic_year') && <div><span className="text-slate-500">ACADEMIC YEAR :</span> <b>2026-27</b></div>}
            </div>
          </div>
          {barcodeOn && (
            <div className="relative mt-3 text-center">
              <div className="inline-block h-8" style={{ background: 'repeating-linear-gradient(to right, #000 0 2px, #fff 2px 3px, #000 3px 5px, #fff 5px 6px, #000 6px 8px, #fff 8px 9px, #000 9px 12px, #fff 12px 13px)', width: '360px' }} />
              <div className="font-mono text-[10px] tracking-[0.2em] mt-0.5">{sampleNumber}</div>
            </div>
          )}
          <div className="relative grid grid-cols-12 gap-3 mt-3 text-[12px]">
            <div className="col-span-8 border border-slate-400 p-2">
              {show('fee_head') && <div className="flex justify-between border-b border-slate-200 py-1"><span>Tuition Q1</span><span className="font-mono">₹ 2,700.00</span></div>}
              <div className="flex justify-between font-bold pt-1"><span>TOTAL</span><span className="font-mono">₹ 2,700.00</span></div>
            </div>
            <div className="col-span-4 border border-slate-400">
              {show('amount_in_words') && <div className="p-2 border-b border-slate-200"><div className="text-[9px] uppercase tracking-widest text-slate-500">Amount in Words</div><div className="text-[11px] font-semibold">Two Thousand Seven Hundred Only</div></div>}
              {show('payment_mode') && <div className="p-2 border-b border-slate-200"><div className="text-[9px] uppercase tracking-widest text-slate-500">Payment Mode</div><div className="text-[12px] font-semibold">Cash</div></div>}
              {show('transaction_id') && <div className="p-2 border-b border-slate-200"><div className="text-[9px] uppercase tracking-widest text-slate-500">Transaction ID</div><div className="text-[10px] font-mono">CASH/{sampleNumber}</div></div>}
              <div className="p-2 bg-slate-900 text-white text-center"><div className="text-[9px] uppercase tracking-widest">Amount Received</div><div className="font-heading font-bold font-mono">₹ 2,700.00</div></div>
            </div>
          </div>
          {rt?.signature_area_enabled !== false && (
            <div className="relative grid grid-cols-3 gap-6 mt-4 text-[11px]">
              <div><b className="text-[10px] tracking-widest">NOTES:</b><ul className="list-disc pl-4 text-slate-600"><li>{rt?.computer_generated_note || 'This is a computer generated receipt.'}</li></ul></div>
              {show('cashier_name') && <div className="text-center pt-6"><div className="border-t border-slate-500 pt-1 text-[10px] tracking-widest">RECEIVED BY</div><div className="text-[10px] text-slate-600">Cashier</div></div>}
              {show('authorized_by') && <div className="text-center pt-6"><div className="border-t border-slate-500 pt-1 text-[10px] tracking-widest">AUTHORIZED BY</div></div>}
            </div>
          )}
          {rt?.footer_text && <div className="relative text-center text-[10px] italic text-slate-600 mt-2 border-t border-slate-200 pt-1">{rt.footer_text}</div>}
        </div>
      </div>
    </div>
  );
};

// ---------- Reset Sequence Modal (dual-auth) ----------
const ResetSequenceModal = ({ rt, onClose, onDone }) => {
  const [newNum, setNewNum] = useState('');
  const [reason, setReason] = useState('');
  const [pin, setPin] = useState('');
  const [pwd, setPwd] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const preview = newNum ? `${rt.code}-2026-${String(newNum).padStart(6,'0')}` : '—';
  const submit = async (e) => {
    e.preventDefault();
    if (!confirmed) return toast.error('Please tick the confirmation checkbox');
    if (!newNum || Number(newNum) < 1) return toast.error('Enter a valid new number');
    if (reason.trim().length < 5) return toast.error('Reason must be at least 5 characters');
    if (pin.length < 4) return toast.error('PIN required');
    if (!pwd) return toast.error('Password required');
    setBusy(true);
    try {
      const { data } = await api.post(`/receipt-types/${rt.id}/reset-sequence`,
        { new_number: Number(newNum), reason: reason.trim(), academic_year: '2026-27' },
        { headers: { 'X-Admin-PIN': pin, 'X-Admin-Password': pwd }});
      toast.success(`Sequence reset — next receipt will be ${data.next_will_be} (was seq ${data.previous_seq})`);
      onDone(); onClose();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Reset failed'); }
    finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 bg-slate-900/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <form onSubmit={submit} onClick={e=>e.stopPropagation()} className="bg-white rounded-lg shadow-2xl w-full max-w-md border-t-4 border-red-600">
        <div className="p-5 border-b border-slate-200">
          <div className="font-heading font-bold text-slate-900 flex items-center gap-2"><Shield className="w-5 h-5 text-red-600" /> Reset Receipt Sequence — {rt.code}</div>
          <div className="text-[12px] text-slate-600 mt-1">High-risk. Dual-auth + audit + reason mandatory. New number must be higher than the highest issued.</div>
        </div>
        <div className="p-5 space-y-3 text-[13px]">
          <div className="bg-slate-50 border border-slate-200 rounded p-2 text-[12px]">
            <div>Current stored counter: <b className="font-mono">{rt.current_number ?? '—'}</b></div>
            <div>Next issued preview: <b className="font-mono text-emerald-700" data-testid="reset-preview">{preview}</b></div>
          </div>
          <Field label="New Starting Number (next issued number)" required><input data-testid="reset-new" type="number" min="1" value={newNum} onChange={e=>setNewNum(e.target.value)} className="w-full h-9 px-3 border border-slate-300 rounded font-mono" /></Field>
          <Field label="Reason (mandatory, ≥5 chars)" required><textarea data-testid="reset-reason" value={reason} onChange={e=>setReason(e.target.value)} rows={2} className="w-full px-3 py-2 border border-slate-300 rounded text-sm" placeholder="e.g. Physical receipt book started at 5000 this year" /></Field>
          <Field label="Administrator PIN" required><input data-testid="reset-pin" type="password" inputMode="numeric" value={pin} onChange={e=>setPin(e.target.value.replace(/\D/g,''))} maxLength={8} className="w-full h-9 px-3 border-2 border-red-300 rounded font-mono tracking-widest text-center" /></Field>
          <Field label="Administrator Password" required><input data-testid="reset-pwd" type="password" value={pwd} onChange={e=>setPwd(e.target.value)} className="w-full h-9 px-3 border-2 border-red-300 rounded" /></Field>
          <label className="flex items-start gap-2 text-[12px] text-slate-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">
            <input type="checkbox" data-testid="reset-confirm" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} />
            <span>I understand this will change the next receipt number for <b>{rt.code}</b>. Duplicate numbers are prevented server-side. This action is logged with my name.</span>
          </label>
        </div>
        <div className="p-4 border-t border-slate-200 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-9 px-4 border border-slate-300 rounded text-sm">Cancel</button>
          <button type="submit" data-testid="reset-submit" disabled={busy} className="h-9 px-4 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white rounded text-sm font-semibold">Reset Sequence</button>
        </div>
      </form>
    </div>
  );
};
