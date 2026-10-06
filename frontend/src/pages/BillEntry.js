import React, { useEffect, useState } from 'react';
import api from '@/lib/api';
import { PageHeader, inr } from '@/components/Layout';
import { useAuth } from '@/context/AuthContext';
import { toast } from 'sonner';
import { FileText, Plus, Search, Ban, Building2, Tag, X, Pencil } from 'lucide-react';
import { queueOperation } from '@/lib/syncEngine';
import useLiveRefresh from '@/lib/useLiveRefresh';

// Same offline-safe pattern as NewReceipt.js/Expenses.js.
async function postBillOrQueue(payload) {
  try {
    const { data } = await api.post('/bills', payload);
    return { data, queued: false };
  } catch (e) {
    if (!e.response) {
      const op = await queueOperation('create_bill', payload);
      return { data: null, queued: true, localId: op.local_id, duplicate: !!op.duplicate };
    }
    throw e;
  }
}

const CAN_MANAGE = ['administrator', 'manager', 'accountant', 'cashier'];
const CAN_VOID = ['administrator', 'manager'];
const STATUSES = [
  { v: 'pending', l: 'Pending' },
  { v: 'paid', l: 'Paid' },
  { v: 'partially_paid', l: 'Partially Paid' },
];

const emptyForm = {
  school_id: '', invoice_no: '', bill_date: new Date().toISOString().slice(0, 10),
  supplier_name: '', category: '', description: '', amount: '', gst: '', due_date: '',
  status: 'pending', who_brought_bill: '', remarks: '',
};

export default function BillEntry() {
  const { user } = useAuth();
  const canManage = CAN_MANAGE.includes(user?.role);
  const canVoid = CAN_VOID.includes(user?.role);

  const [schools, setSchools] = useState([]);
  const [categories, setCategories] = useState([]);
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showSchoolMgr, setShowSchoolMgr] = useState(false);
  const [showCatMgr, setShowCatMgr] = useState(false);
  const [newSchool, setNewSchool] = useState({ name: '', code: '', address: '', contact: '' });
  const [newCat, setNewCat] = useState('');

  const [q, setQ] = useState('');
  const [fSchool, setFSchool] = useState('');
  const [fCategory, setFCategory] = useState('');
  const [fSupplier, setFSupplier] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [fFrom, setFFrom] = useState('');
  const [fTo, setFTo] = useState('');

  const loadSchools = () => api.get('/bill-schools').then(r => setSchools(r.data || []));
  const loadCategories = () => api.get('/bill-categories').then(r => setCategories(r.data || []));
  const load = () => {
    const params = {};
    if (q) params.q = q;
    if (fSchool) params.school_id = fSchool;
    if (fCategory) params.category = fCategory;
    if (fSupplier) params.supplier_name = fSupplier;
    if (fStatus) params.status = fStatus;
    if (fFrom) params.date_from = fFrom;
    if (fTo) params.date_to = fTo;
    return api.get('/reports/bills/register', { params }).then(r => { setRows(r.data.bills || []); setSummary(r.data); });
  };

  useEffect(() => { loadSchools(); loadCategories(); load(); /* eslint-disable-next-line */ }, []);
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [q, fSchool, fCategory, fSupplier, fStatus, fFrom, fTo]);
  useLiveRefresh(load, 10000);

  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }));
  const canSubmit = form.school_id && form.supplier_name.trim() && form.category && form.description.trim() && Number(form.amount) > 0 && !busy;

  const openCreate = () => { setForm(emptyForm); setEditingId(null); setShowForm(true); };
  const openEdit = (r) => {
    setForm({
      school_id: r.school_id, invoice_no: r.invoice_no || '', bill_date: r.bill_date,
      supplier_name: r.supplier_name, category: r.category, description: r.description,
      amount: r.amount, gst: r.gst || '', due_date: r.due_date || '', status: r.status,
      who_brought_bill: r.who_brought_bill || '', remarks: r.remarks || '',
    });
    setEditingId(r.id); setShowForm(true);
  };

  const submit = async () => {
    setBusy(true);
    try {
      const body = {
        school_id: form.school_id, invoice_no: form.invoice_no.trim() || null, bill_date: form.bill_date,
        supplier_name: form.supplier_name.trim(), category: form.category, description: form.description.trim(),
        amount: Number(form.amount), gst: form.gst ? Number(form.gst) : 0, due_date: form.due_date || null,
        status: form.status, who_brought_bill: form.who_brought_bill.trim() || null, remarks: form.remarks.trim() || null,
      };
      if (editingId) {
        await api.patch(`/bills/${editingId}`, body);
        toast.success('Bill updated');
      } else {
        const { data, queued, duplicate } = await postBillOrQueue(body);
        if (queued) toast.success(duplicate ? 'This bill is already waiting to sync on this PC, so it was not added a second time.' : 'Server unreachable — bill queued offline. It will be recorded automatically once connection returns.');
        else toast.success(`Bill ${data.bill_no} recorded`);
      }
      setShowForm(false); setForm(emptyForm); setEditingId(null);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Failed to save bill');
    } finally { setBusy(false); }
  };

  const voidBill = async (row) => {
    const reason = window.prompt(`Reason to VOID/CANCEL bill ${row.bill_no}:`);
    if (reason === null) return;
    if (!reason.trim()) { toast.error('A reason is required'); return; }
    try {
      await api.post(`/bills/${row.id}/void`, { reason: reason.trim() });
      toast.success('Bill voided');
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Failed to void bill'); }
  };

  const addSchool = async () => {
    if (!newSchool.name.trim()) return;
    try {
      await api.post('/bill-schools', newSchool);
      setNewSchool({ name: '', code: '', address: '', contact: '' }); loadSchools();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Failed to add school'); }
  };
  const addCategory = async () => {
    if (!newCat.trim()) return;
    try {
      await api.post('/bill-categories', { name: newCat.trim() });
      setNewCat(''); loadCategories();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Failed to add category'); }
  };

  const statusLabel = (s) => STATUSES.find(x => x.v === s)?.l || s;

  return (
    <>
      <PageHeader title="Bill Entry" subtitle="Independent bill/invoice document record — separate from Expenses and Fee Collection"
        actions={canManage && (
          <div className="flex gap-2">
            <button onClick={() => setShowSchoolMgr(v => !v)} className="h-9 px-3 border border-slate-300 rounded text-sm flex items-center gap-1.5 hover:bg-slate-100"><Building2 className="w-4 h-4" /> School Master</button>
            <button onClick={() => setShowCatMgr(v => !v)} className="h-9 px-3 border border-slate-300 rounded text-sm flex items-center gap-1.5 hover:bg-slate-100"><Tag className="w-4 h-4" /> Categories</button>
            <button data-testid="bill-new" onClick={openCreate} className="h-9 px-3 bg-blue-600 text-white rounded text-sm flex items-center gap-1.5 hover:bg-blue-700"><Plus className="w-4 h-4" /> Create Bill</button>
          </div>
        )}
      />
      <div className="p-6 space-y-4">
        {showSchoolMgr && (
          <div className="bg-white border border-slate-200 rounded-lg p-4">
            <div className="text-[11px] uppercase tracking-widest text-slate-600 font-bold mb-2">Bill Entry — School Master</div>
            <table className="w-full text-[12px] mb-3">
              <thead><tr className="text-left text-[10px] uppercase text-slate-500 border-b"><th className="py-1">Name</th><th>Code</th><th>Address</th><th>Contact</th><th>Status</th></tr></thead>
              <tbody>{schools.map(s => (
                <tr key={s.id} className="border-b border-slate-100"><td className="py-1">{s.name}</td><td>{s.code || '—'}</td><td>{s.address || '—'}</td><td>{s.contact || '—'}</td><td>{s.active !== false ? 'Active' : 'Inactive'}</td></tr>
              ))}</tbody>
            </table>
            <div className="grid grid-cols-4 gap-2 max-w-3xl">
              <input value={newSchool.name} onChange={e => setNewSchool(p => ({ ...p, name: e.target.value }))} placeholder="School Name" className="h-9 px-2 border border-slate-300 rounded text-sm" />
              <input value={newSchool.code} onChange={e => setNewSchool(p => ({ ...p, code: e.target.value }))} placeholder="Code (optional)" className="h-9 px-2 border border-slate-300 rounded text-sm" />
              <input value={newSchool.address} onChange={e => setNewSchool(p => ({ ...p, address: e.target.value }))} placeholder="Address (optional)" className="h-9 px-2 border border-slate-300 rounded text-sm" />
              <div className="flex gap-2">
                <input value={newSchool.contact} onChange={e => setNewSchool(p => ({ ...p, contact: e.target.value }))} placeholder="Contact (optional)" className="flex-1 h-9 px-2 border border-slate-300 rounded text-sm" />
                <button onClick={addSchool} className="h-9 px-3 bg-slate-900 text-white rounded text-sm">Add</button>
              </div>
            </div>
          </div>
        )}

        {showCatMgr && (
          <div className="bg-white border border-slate-200 rounded-lg p-4">
            <div className="text-[11px] uppercase tracking-widest text-slate-600 font-bold mb-2">Bill Categories</div>
            <div className="flex flex-wrap gap-2 mb-3">{categories.map(c => <span key={c.id} className="px-2.5 py-1 bg-slate-100 rounded text-[12px]">{c.name}</span>)}</div>
            <div className="flex gap-2 max-w-md">
              <input value={newCat} onChange={e => setNewCat(e.target.value)} placeholder="New category name" className="flex-1 h-9 px-3 border border-slate-300 rounded text-sm" />
              <button onClick={addCategory} className="h-9 px-3 bg-slate-900 text-white rounded text-sm">Add</button>
            </div>
          </div>
        )}

        {showForm && canManage && (
          <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-[13px] font-bold text-slate-800">{editingId ? 'Alter Bill' : 'Create Bill'}</div>
              <button onClick={() => { setShowForm(false); setEditingId(null); }}><X className="w-4 h-4 text-slate-400" /></button>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Field label="School" required>
                <select data-testid="bill-school" value={form.school_id} onChange={e => set('school_id', e.target.value)} className="w-full h-10 px-3 border border-slate-300 rounded bg-white">
                  <option value="">Select school…</option>
                  {schools.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
              <Field label="Bill / Invoice No."><input value={form.invoice_no} onChange={e => set('invoice_no', e.target.value)} className="w-full h-10 px-3 border border-slate-300 rounded" /></Field>
              <Field label="Bill Date" required><input type="date" value={form.bill_date} onChange={e => set('bill_date', e.target.value)} className="w-full h-10 px-3 border border-slate-300 rounded" /></Field>
              <Field label="Supplier / Vendor Name" required><input value={form.supplier_name} onChange={e => set('supplier_name', e.target.value)} className="w-full h-10 px-3 border border-slate-300 rounded" /></Field>
              <Field label="Bill Category" required>
                <select data-testid="bill-category" value={form.category} onChange={e => set('category', e.target.value)} className="w-full h-10 px-3 border border-slate-300 rounded bg-white">
                  <option value="">Select category…</option>
                  {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                </select>
              </Field>
              <Field label="Bill Status">
                <select value={form.status} onChange={e => set('status', e.target.value)} className="w-full h-10 px-3 border border-slate-300 rounded bg-white">
                  {STATUSES.map(s => <option key={s.v} value={s.v}>{s.l}</option>)}
                </select>
              </Field>
              <Field label="Description" span={3} required><input value={form.description} onChange={e => set('description', e.target.value)} className="w-full h-10 px-3 border border-slate-300 rounded" /></Field>
              <Field label="Amount (₹)" required><input type="number" min="0" step="1" value={form.amount} onChange={e => set('amount', e.target.value)} className="w-full h-10 px-3 border border-slate-300 rounded text-right font-mono" /></Field>
              <Field label="GST (₹, if applicable)"><input type="number" min="0" step="1" value={form.gst} onChange={e => set('gst', e.target.value)} className="w-full h-10 px-3 border border-slate-300 rounded text-right font-mono" /></Field>
              <Field label="Total Bill Amount">
                <div className="w-full h-10 px-3 border border-slate-200 bg-slate-50 rounded flex items-center font-mono text-right justify-end" data-testid="bill-total-preview">
                  {inr((Number(form.amount) || 0) + (Number(form.gst) || 0))}
                </div>
              </Field>
              <Field label="Due Date (if applicable)"><input type="date" value={form.due_date} onChange={e => set('due_date', e.target.value)} className="w-full h-10 px-3 border border-slate-300 rounded" /></Field>
              <Field label="Who Brought the Bill"><input value={form.who_brought_bill} onChange={e => set('who_brought_bill', e.target.value)} className="w-full h-10 px-3 border border-slate-300 rounded" /></Field>
              <Field label="Remarks" span={2}><input value={form.remarks} onChange={e => set('remarks', e.target.value)} className="w-full h-10 px-3 border border-slate-300 rounded" /></Field>
            </div>
            <button data-testid="bill-submit" disabled={!canSubmit} onClick={submit}
              className="w-full h-11 bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white rounded text-sm font-semibold flex items-center justify-center gap-2">
              <FileText className="w-4 h-4" /> {editingId ? 'Save Changes' : 'Create Bill'}
            </button>
          </div>
        )}

        {summary && (
          <div className="grid grid-cols-4 gap-3">
            <SummaryCard label="Total Bills" value={summary.total_bills} />
            <SummaryCard label="Total Amount" value={inr(summary.total_amount)} />
            <SummaryCard label="Total GST" value={inr(summary.total_gst)} />
            <SummaryCard label="Total Bill Value" value={inr(summary.total_bill_value)} />
          </div>
        )}

        <div className="bg-white border border-slate-200 rounded-lg p-3 flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search bill no / invoice / supplier / description" className="w-full h-9 pl-9 pr-3 border border-slate-300 rounded text-sm" />
          </div>
          <select value={fSchool} onChange={e => setFSchool(e.target.value)} className="h-9 px-2 border border-slate-300 rounded text-sm bg-white"><option value="">All Schools</option>{schools.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          <select value={fCategory} onChange={e => setFCategory(e.target.value)} className="h-9 px-2 border border-slate-300 rounded text-sm bg-white"><option value="">All Categories</option>{categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}</select>
          <input value={fSupplier} onChange={e => setFSupplier(e.target.value)} placeholder="Supplier" className="h-9 px-2 border border-slate-300 rounded text-sm w-32" />
          <select value={fStatus} onChange={e => setFStatus(e.target.value)} className="h-9 px-2 border border-slate-300 rounded text-sm bg-white"><option value="">All Statuses</option>{STATUSES.map(s => <option key={s.v} value={s.v}>{s.l}</option>)}</select>
          <input type="date" value={fFrom} onChange={e => setFFrom(e.target.value)} className="h-9 px-2 border border-slate-300 rounded text-sm" />
          <span className="text-slate-400 text-xs">to</span>
          <input type="date" value={fTo} onChange={e => setFTo(e.target.value)} className="h-9 px-2 border border-slate-300 rounded text-sm" />
        </div>

        <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[10px] uppercase text-slate-500 border-b border-slate-200 bg-slate-50">
                <th className="py-2 px-3">S.No</th><th className="px-3">Bill No.</th><th className="px-3">Invoice No.</th><th className="px-3">Bill Date</th>
                <th className="px-3">School</th><th className="px-3">Supplier</th><th className="px-3">Category</th><th className="px-3">Description</th>
                <th className="px-3 text-right">Amount</th><th className="px-3 text-right">GST</th><th className="px-3 text-right">Total</th><th className="px-3">Status</th><th className="px-3"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id} className="border-b border-slate-100">
                  <td className="py-2 px-3">{i + 1}</td>
                  <td className="px-3 font-mono">{r.bill_no}</td>
                  <td className="px-3">{r.invoice_no || '—'}</td>
                  <td className="px-3">{r.bill_date}</td>
                  <td className="px-3">{r.school_name}</td>
                  <td className="px-3">{r.supplier_name}</td>
                  <td className="px-3">{r.category}</td>
                  <td className="px-3">{r.description}</td>
                  <td className="px-3 text-right font-mono">{inr(r.amount)}</td>
                  <td className="px-3 text-right font-mono">{inr(r.gst)}</td>
                  <td className="px-3 text-right font-mono font-semibold">{inr(r.total_bill_amount)}</td>
                  <td className="px-3"><StatusBadge s={r.status} label={statusLabel(r.status)} /></td>
                  <td className="px-3 whitespace-nowrap">
                    {canManage && <button onClick={() => openEdit(r)} title="Alter" className="text-blue-600 hover:text-blue-800 mr-2"><Pencil className="w-4 h-4" /></button>}
                    {canVoid && <button onClick={() => voidBill(r)} title="Void / Cancel" className="text-red-600 hover:text-red-800"><Ban className="w-4 h-4" /></button>}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan="13" className="py-8 text-center text-slate-400">No bills found</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

const Field = ({ label, children, span = 1, required = false }) => (
  <label className={`block ${span === 2 ? 'col-span-2' : span === 3 ? 'col-span-3' : ''}`}>
    <div className="text-[11px] uppercase tracking-widest text-slate-600 mb-1">{label}{required && <span className="text-red-600 ml-0.5">*</span>}</div>
    {children}
  </label>
);

const SummaryCard = ({ label, value }) => (
  <div className="bg-white border border-slate-200 rounded-lg p-3">
    <div className="text-[10px] uppercase tracking-widest text-slate-500">{label}</div>
    <div className="text-lg font-mono font-bold text-slate-900">{value}</div>
  </div>
);

const StatusBadge = ({ s, label }) => {
  const cls = s === 'paid' ? 'bg-emerald-100 text-emerald-800' : s === 'partially_paid' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-700';
  return <span className={`px-2 py-0.5 rounded text-[11px] font-semibold ${cls}`}>{label}</span>;
};
