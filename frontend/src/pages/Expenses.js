import React, { useEffect, useMemo, useState } from 'react';
import api from '@/lib/api';
import { PageHeader, inr } from '@/components/Layout';
import { useAuth } from '@/context/AuthContext';
import { toast } from 'sonner';
import { Wallet, Plus, Search, Ban, Settings2, Fuel, X, BarChart3, Pencil } from 'lucide-react';
import { queueOperation } from '@/lib/syncEngine';
import useLiveRefresh from '@/lib/useLiveRefresh';
import { busOptions } from '@/lib/busOptions';
import { formatAddedOn } from '@/lib/dateTime';

// Same offline-safe pattern as NewReceipt.js: the ONLINE path is completely
// unchanged; only a genuine network failure (server unreachable) queues the
// expense locally to be created for real, with a real expense number, once
// connectivity returns - never on a real validation rejection.
async function postExpenseOrQueue(payload) {
  try {
    const { data } = await api.post('/expenses', payload);
    return { data, queued: false };
  } catch (e) {
    if (!e.response) {
      const op = await queueOperation('create_expense', payload);
      return { data: null, queued: true, localId: op.local_id };
    }
    throw e;
  }
}

const PAYMENT_MODES = [
  { v: 'cash', l: 'Cash' },
  { v: 'upi', l: 'UPI' },
  { v: 'bank_cheque', l: 'Bank / Cheque' },
];
const FUEL_CATEGORY = 'Petrol / Diesel';
const OTHER_CATEGORY = 'Other';
const CAN_MANAGE = ['administrator', 'manager', 'accountant', 'cashier'];
const CAN_VOID = ['administrator', 'manager'];

const emptyForm = {
  date: new Date().toISOString().slice(0, 10), category: '', description: '',
  to_whom: '', who_brought_bill: '', amount: '', payment_mode: 'cash', cheque_no: '',
  bus_route_id: '', fuel_type: 'Diesel', quantity_litres: '', rate_per_litre: '', odometer_km: '', invoice_no: '', remarks: '',
  custom_expense_name: '',
};

export default function Expenses() {
  const { user } = useAuth();
  const canManage = CAN_MANAGE.includes(user?.role);
  const canVoid = CAN_VOID.includes(user?.role);

  const [categories, setCategories] = useState([]);
  const [busRoutes, setBusRoutes] = useState([]);
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [showCatMgr, setShowCatMgr] = useState(false);
  const [newCat, setNewCat] = useState('');
  const [showFuelReport, setShowFuelReport] = useState(false);
  const [fuelReport, setFuelReport] = useState(null);

  const [q, setQ] = useState('');
  const [fCategory, setFCategory] = useState('');
  const [fMode, setFMode] = useState('');
  const [fFrom, setFFrom] = useState('');
  const [fTo, setFTo] = useState('');
  const [fBus, setFBus] = useState('');
  const [fFuelType, setFFuelType] = useState('');
  const [fVendor, setFVendor] = useState('');

  const loadCategories = () => api.get('/expense-categories').then(r => setCategories(r.data || []));
  const loadBusRoutes = () => api.get('/bus-routes').then(r => setBusRoutes(r.data || [])).catch(() => setBusRoutes([]));
  const load = () => {
    const params = {};
    if (q) params.q = q;
    if (fCategory) params.category = fCategory;
    if (fMode) params.payment_mode = fMode;
    if (fFrom) params.date_from = fFrom;
    if (fTo) params.date_to = fTo;
    return api.get('/expenses', { params }).then(r => setRows(r.data || []));
  };

  const loadFuelReport = () => api.get('/reports/expenses/bus-fuel', { params: {
    date_from: fFrom || undefined, date_to: fTo || undefined, bus_route_id: fBus || undefined,
    fuel_type: fFuelType || undefined, vendor: fVendor || undefined,
  } }).then(r => setFuelReport(r.data));

  useEffect(() => { loadCategories(); loadBusRoutes(); load(); /* eslint-disable-next-line */ }, []);
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [q, fCategory, fMode, fFrom, fTo]);
  useLiveRefresh(load, 10000);
  useEffect(() => { if (showFuelReport) loadFuelReport(); /* eslint-disable-next-line */ }, [showFuelReport, fFrom, fTo, fBus, fFuelType, fVendor]);

  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }));
  const isFuel = form.category === FUEL_CATEGORY;
  const isOther = form.category === OTHER_CATEGORY;
  const isChequeMode = form.payment_mode === 'bank_cheque';

  // Changing away from "Other" clears the custom name so it can never be
  // silently carried over/submitted against a different category.
  const setCategory = (v) => setForm(prev => ({ ...prev, category: v, custom_expense_name: v === OTHER_CATEGORY ? prev.custom_expense_name : '' }));

  const computedFromQtyRate = useMemo(() => {
    const qty = Number(form.quantity_litres), rate = Number(form.rate_per_litre);
    if (isFuel && qty > 0 && rate > 0) return Math.round(qty * rate * 100) / 100;
    return null;
  }, [isFuel, form.quantity_litres, form.rate_per_litre]);

  const useComputed = () => { if (computedFromQtyRate != null) set('amount', String(computedFromQtyRate)); };

  const canSubmit = form.category && form.description.trim() && form.to_whom.trim() &&
    form.who_brought_bill.trim() && Number(form.amount) > 0 &&
    (!isChequeMode || form.cheque_no.trim()) && (!isOther || form.custom_expense_name.trim()) && !busy;

  const submit = async () => {
    setBusy(true);
    try {
      const body = {
        date: form.date, category: form.category, description: form.description.trim(),
        to_whom: form.to_whom.trim(), who_brought_bill: form.who_brought_bill.trim(),
        amount: isFuel && computedFromQtyRate != null ? computedFromQtyRate : Number(form.amount), payment_mode: form.payment_mode,
        cheque_no: isChequeMode ? form.cheque_no.trim() : null,
        remarks: form.remarks.trim() || null,
        custom_expense_name: isOther ? form.custom_expense_name.trim() : null,
      };
      if (isFuel) {
        Object.assign(body, {
          bus_route_id: form.bus_route_id || null,
          fuel_type: form.fuel_type || 'Diesel',
          quantity_litres: form.quantity_litres ? Number(form.quantity_litres) : null,
          rate_per_litre: form.rate_per_litre ? Number(form.rate_per_litre) : null,
          odometer_km: form.odometer_km !== '' ? Number(form.odometer_km) : null,
          invoice_no: form.invoice_no.trim() || null,
        });
      }
      if (editingId) {
        const { data } = await api.patch(`/expenses/${editingId}`, body);
        toast.success(`Expense ${data.expense_no} updated`);
      } else {
        const { data, queued } = await postExpenseOrQueue(body);
        if (queued) toast.success('Server unreachable — expense queued offline. It will be recorded automatically once connection returns.');
        else toast.success(`Expense ${data.expense_no} recorded`);
      }
      setForm(emptyForm); setShowForm(false); setEditingId(null);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Failed to save expense');
    } finally { setBusy(false); }
  };

  const openCreate = () => { setForm(emptyForm); setEditingId(null); setShowForm(true); };
  const openEdit = (r) => {
    setForm({
      date: r.date, category: r.category, description: r.description,
      to_whom: r.to_whom, who_brought_bill: r.who_brought_bill, amount: r.amount,
      payment_mode: r.payment_mode, cheque_no: r.cheque_no || '',
      bus_route_id: r.bus_route_id || '', fuel_type: r.fuel_type || 'Diesel',
      quantity_litres: r.quantity_litres ?? '', rate_per_litre: r.rate_per_litre ?? '',
      odometer_km: r.odometer_km ?? '', invoice_no: r.invoice_no || '',
      remarks: r.remarks || '', custom_expense_name: r.custom_expense_name || '',
    });
    setEditingId(r.id); setShowForm(true);
  };

  const addCategory = async () => {
    if (!newCat.trim()) return;
    try {
      await api.post('/expense-categories', { name: newCat.trim() });
      setNewCat(''); loadCategories();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Failed to add category'); }
  };

  const voidExpense = async (row) => {
    const reason = window.prompt(`Reason to VOID expense ${row.expense_no}:`);
    if (reason === null) return;
    if (!reason.trim()) { toast.error('A reason is required'); return; }
    try {
      await api.post(`/expenses/${row.id}/void`, { reason: reason.trim() });
      toast.success('Expense voided');
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Failed to void expense'); }
  };

  const totalAmount = rows.filter(r => r.status !== 'void').reduce((s, r) => s + Number(r.amount || 0), 0);

  return (
    <>
      <PageHeader title="Expenses" subtitle="Record and track actual school expense payments — independent of Bill Entry"
        actions={canManage && (
          <div className="flex gap-2">
            <button onClick={() => setShowCatMgr(v => !v)} className="h-9 px-3 border border-slate-300 rounded text-sm flex items-center gap-1.5 hover:bg-slate-100"><Settings2 className="w-4 h-4" /> Categories</button>
            <button data-testid="exp-fuel-report-toggle" onClick={() => setShowFuelReport(v => !v)} className="h-9 px-3 border border-amber-300 text-amber-800 bg-amber-50 rounded text-sm flex items-center gap-1.5 hover:bg-amber-100"><BarChart3 className="w-4 h-4" /> Bus Fuel Report</button>
            <button data-testid="exp-new" onClick={openCreate} className="h-9 px-3 bg-blue-600 text-white rounded text-sm flex items-center gap-1.5 hover:bg-blue-700"><Plus className="w-4 h-4" /> New Expense</button>
          </div>
        )}
      />
      <div className="p-6 space-y-4">
        {showCatMgr && (
          <div className="bg-white border border-slate-200 rounded-lg p-4">
            <div className="text-[11px] uppercase tracking-widest text-slate-600 font-bold mb-2">Expense Categories</div>
            <div className="flex flex-wrap gap-2 mb-3">
              {categories.map(c => <span key={c.id} className="px-2.5 py-1 bg-slate-100 rounded text-[12px]">{c.name}</span>)}
            </div>
            <div className="flex gap-2 max-w-md">
              <input value={newCat} onChange={e => setNewCat(e.target.value)} placeholder="New category name" className="flex-1 h-9 px-3 border border-slate-300 rounded text-sm" />
              <button onClick={addCategory} className="h-9 px-3 bg-slate-900 text-white rounded text-sm">Add</button>
            </div>
          </div>
        )}

        {showFuelReport && fuelReport && (
          <div data-testid="exp-fuel-report" className="bg-white border border-amber-200 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[11px] uppercase tracking-widest text-amber-800 font-bold flex items-center gap-1.5"><Fuel className="w-3.5 h-3.5" /> Bus-wise Fuel Expense (uses the date range above)</div>
              <button onClick={() => setShowFuelReport(false)}><X className="w-4 h-4 text-slate-400" /></button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-3 text-[12px]">
              <select data-testid="exp-report-bus" value={fBus} onChange={e => setFBus(e.target.value)} className="h-9 px-2 border border-slate-300 rounded bg-white">
                <option value="">All buses</option>
                {busOptions(busRoutes).map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
              <select data-testid="exp-report-fuel" value={fFuelType} onChange={e => setFFuelType(e.target.value)} className="h-9 px-2 border border-slate-300 rounded bg-white">
                <option value="">All fuel types</option>
                <option value="Diesel">Diesel</option>
              </select>
              <input data-testid="exp-report-vendor" value={fVendor} onChange={e => setFVendor(e.target.value)} placeholder="Vendor / fuel station" className="h-9 px-2 border border-slate-300 rounded" />
              <div className="col-span-2 md:col-span-2 text-[11px] text-slate-500 flex items-center">Date range: use the From / To filters above.</div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3" data-testid="exp-report-summary">
              <div className="border border-amber-200 rounded p-2"><div className="text-[10px] uppercase text-slate-500">Total fuel quantity</div><div className="font-mono font-semibold">{fuelReport.grand_total_litres} L</div></div>
              <div className="border border-amber-200 rounded p-2"><div className="text-[10px] uppercase text-slate-500">Total fuel expense</div><div className="font-mono font-semibold">{inr(fuelReport.grand_total_amount)}</div></div>
              <div className="border border-amber-200 rounded p-2"><div className="text-[10px] uppercase text-slate-500">Average rate / litre</div><div className="font-mono font-semibold">{fuelReport.grand_average_rate != null ? inr(fuelReport.grand_average_rate) : '—'}</div></div>
              <div className="border border-amber-200 rounded p-2"><div className="text-[10px] uppercase text-slate-500">Fuel entries</div><div className="font-mono font-semibold">{fuelReport.grand_entries}</div></div>
            </div>
            <table className="w-full text-[12.5px] mb-3">
              <thead><tr className="text-left text-[10px] uppercase text-slate-500 border-b"><th className="py-1">Bus</th><th className="text-right">Entries</th><th className="text-right">Litres</th><th className="text-right">Average Rate</th><th className="text-right">Fuel Cost</th></tr></thead>
              <tbody>
                {fuelReport.by_bus.map((b, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    <td className="py-1">{b.bus_short ? `${b.bus_short} — ${b.bus_no}` : (b.bus_no || '(unassigned)')}</td>
                    <td className="text-right">{b.entries}</td>
                    <td className="text-right font-mono">{b.total_litres}</td>
                    <td className="text-right font-mono">{b.average_rate_per_litre != null ? inr(b.average_rate_per_litre) : '—'}</td>
                    <td className="text-right font-mono">{inr(b.total_amount)}</td>
                  </tr>
                ))}
                {fuelReport.by_bus.length === 0 && <tr><td colSpan="5" className="py-4 text-center text-slate-400">No fuel expenses recorded yet</td></tr>}
              </tbody>
              <tfoot><tr className="bg-amber-50 font-semibold border-t border-amber-200">
                <td colSpan="2" className="py-1.5">Grand Total</td>
                <td className="text-right font-mono">{fuelReport.grand_total_litres}</td>
                <td></td>
                <td className="text-right font-mono">{inr(fuelReport.grand_total_amount)}</td>
              </tr></tfoot>
            </table>
          </div>
        )}

        {showForm && canManage && (
          <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-[13px] font-bold text-slate-800">{editingId ? 'Alter Expense' : 'New Expense Entry'}</div>
              <button onClick={() => { setShowForm(false); setEditingId(null); }}><X className="w-4 h-4 text-slate-400" /></button>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Date" required><input type="date" value={form.date} onChange={e => set('date', e.target.value)} className="w-full h-10 px-3 border border-slate-300 rounded" /></Field>
              <Field label="Expense Category" required>
                <select data-testid="exp-category" value={form.category} onChange={e => setCategory(e.target.value)} className="w-full h-10 px-3 border border-slate-300 rounded bg-white">
                  <option value="">Select category…</option>
                  {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                </select>
              </Field>
              {isOther && (
                <Field label="Expense Name" required>
                  <input data-testid="exp-custom-name" value={form.custom_expense_name} onChange={e => set('custom_expense_name', e.target.value)} className="w-full h-10 px-3 border border-slate-300 rounded" placeholder="e.g. School Event Decoration" />
                </Field>
              )}
              <Field label="Amount (₹)" required>
                <input data-testid="exp-amount" type="number" min="0" step="1" value={form.amount} onChange={e => set('amount', e.target.value)} className="w-full h-10 px-3 border border-slate-300 rounded text-right font-mono" />
              </Field>
              <Field label="Description / Purpose" span={3} required>
                <input value={form.description} onChange={e => set('description', e.target.value)} className="w-full h-10 px-3 border border-slate-300 rounded" placeholder="e.g. Monthly electricity bill – July" />
              </Field>
              <Field label="To Whom" required>
                <input data-testid="exp-to-whom" value={form.to_whom} onChange={e => set('to_whom', e.target.value)} className="w-full h-10 px-3 border border-slate-300 rounded" placeholder="Payee / vendor" />
              </Field>
              <Field label="Who Brought the Bill" required>
                <input data-testid="exp-brought-by" value={form.who_brought_bill} onChange={e => set('who_brought_bill', e.target.value)} className="w-full h-10 px-3 border border-slate-300 rounded" />
              </Field>
              <Field label="Payment Mode" required>
                <select data-testid="exp-mode" value={form.payment_mode} onChange={e => set('payment_mode', e.target.value)} className="w-full h-10 px-3 border border-slate-300 rounded bg-white">
                  {PAYMENT_MODES.map(m => <option key={m.v} value={m.v}>{m.l}</option>)}
                </select>
              </Field>
              {isChequeMode && (
                <Field label="Cheque No." required>
                  <input data-testid="exp-cheque-no" value={form.cheque_no} onChange={e => set('cheque_no', e.target.value)} className="w-full h-10 px-3 border border-slate-300 rounded" />
                </Field>
              )}
              <Field label="Remarks" span={isChequeMode ? 1 : 2}>
                <input value={form.remarks} onChange={e => set('remarks', e.target.value)} className="w-full h-10 px-3 border border-slate-300 rounded" />
              </Field>
            </div>

            {isFuel && (
              <div data-testid="exp-fuel-block" className="border-t border-slate-200 pt-4">
                <div className="text-[11px] uppercase tracking-widest text-amber-700 font-bold mb-2 flex items-center gap-1.5"><Fuel className="w-3.5 h-3.5" /> Petrol / Diesel — Bus Details</div>
                <div className="grid grid-cols-4 gap-3">
                  <Field label="Bus No.">
                    <select data-testid="exp-bus" value={form.bus_route_id} onChange={e => set('bus_route_id', e.target.value)} className="w-full h-10 px-3 border border-slate-300 rounded bg-white">
                      <option value="">Select bus…</option>
                      {busOptions(busRoutes).map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                    </select>
                    {busRoutes.length === 0 && <div className="text-[11px] text-slate-400 mt-1">No buses in Bus Master yet</div>}
                  </Field>
                  <Field label="Fuel Type">
                    <select data-testid="exp-fuel-type" value={form.fuel_type} onChange={e => set('fuel_type', e.target.value)} className="w-full h-10 px-3 border border-slate-300 rounded bg-white">
                      <option value="">Select…</option>
                      <option value="Diesel">Diesel</option>
                      {form.fuel_type === 'Petrol' && <option value="Petrol">Petrol (historical)</option>}
                    </select>
                  </Field>
                  <Field label="Quantity (Litres)">
                    <input type="number" min="0" step="0.01" value={form.quantity_litres} onChange={e => set('quantity_litres', e.target.value)} className="w-full h-10 px-3 border border-slate-300 rounded text-right font-mono" />
                  </Field>
                  <Field label="Rate per Litre (₹)">
                    <input type="number" min="0" step="0.01" value={form.rate_per_litre} onChange={e => set('rate_per_litre', e.target.value)} className="w-full h-10 px-3 border border-slate-300 rounded text-right font-mono" />
                  </Field>
                  <Field label="Odometer Reading (km)">
                    <input data-testid="exp-odometer" type="number" min="0" step="1" value={form.odometer_km} onChange={e => set('odometer_km', e.target.value)} className="w-full h-10 px-3 border border-slate-300 rounded text-right font-mono" />
                  </Field>
                  <Field label="Bill / Invoice No.">
                    <input data-testid="exp-invoice" type="text" value={form.invoice_no} onChange={e => set('invoice_no', e.target.value)} className="w-full h-10 px-3 border border-slate-300 rounded font-mono" />
                  </Field>
                  {computedFromQtyRate != null && (
                    <div className="col-span-2 flex items-end">
                      <button type="button" onClick={useComputed} className="h-10 px-3 border border-amber-300 bg-amber-50 text-amber-800 rounded text-[12px] w-full">
                        Qty × Rate = {inr(computedFromQtyRate)} — click to use as Amount
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            <button data-testid="exp-submit" disabled={!canSubmit} onClick={submit}
              className="w-full h-11 bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white rounded text-sm font-semibold flex items-center justify-center gap-2">
              <Wallet className="w-4 h-4" /> {editingId ? 'Save Changes' : 'Record Expense'}{form.amount ? ` · ${inr(Number(form.amount))}` : ''}
            </button>
          </div>
        )}

        <div className="bg-white border border-slate-200 rounded-lg p-3 flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search expense no / description / to whom / who brought / bus no" className="w-full h-9 pl-9 pr-3 border border-slate-300 rounded text-sm" />
          </div>
          <select value={fCategory} onChange={e => setFCategory(e.target.value)} className="h-9 px-2 border border-slate-300 rounded text-sm bg-white">
            <option value="">All Categories</option>
            {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
          </select>
          <select value={fMode} onChange={e => setFMode(e.target.value)} className="h-9 px-2 border border-slate-300 rounded text-sm bg-white">
            <option value="">All Modes</option>
            {PAYMENT_MODES.map(m => <option key={m.v} value={m.v}>{m.l}</option>)}
          </select>
          <input type="date" value={fFrom} onChange={e => setFFrom(e.target.value)} className="h-9 px-2 border border-slate-300 rounded text-sm" />
          <span className="text-slate-400 text-xs">to</span>
          <input type="date" value={fTo} onChange={e => setFTo(e.target.value)} className="h-9 px-2 border border-slate-300 rounded text-sm" />
        </div>

        <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[10px] uppercase text-slate-500 border-b border-slate-200 bg-slate-50">
                <th className="py-2 px-3">Expense No.</th><th className="px-3">Date</th><th className="px-3">Added On</th><th className="px-3">Category</th>
                <th className="px-3">Description</th><th className="px-3">To Whom</th><th className="px-3">Brought By</th>
                <th className="px-3">Mode</th><th className="px-3 text-right">Amount</th><th className="px-3">Status</th><th className="px-3"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className={`border-b border-slate-100 ${r.status === 'void' ? 'opacity-50' : ''}`}>
                  <td className="py-2 px-3 font-mono">{r.expense_no}</td>
                  <td className="px-3">{r.date}</td>
                  <td className="px-3 text-[12px] text-slate-600 whitespace-nowrap" data-testid="exp-added-on">{formatAddedOn(r.created_at)}</td>
                  <td className="px-3">{r.category_display || r.category}{r.category === FUEL_CATEGORY && r.bus_no ? ` (${r.bus_no})` : ''}</td>
                  <td className="px-3">{r.description}</td>
                  <td className="px-3">{r.to_whom}</td>
                  <td className="px-3">{r.who_brought_bill}</td>
                  <td className="px-3 uppercase text-[11px]">{r.payment_mode.replace('_', ' ')}</td>
                  <td className="px-3 text-right font-mono">{inr(r.amount)}</td>
                  <td className="px-3">{r.status === 'void' ? <span className="text-red-600 text-[11px] font-semibold">VOID</span> : <span className="text-emerald-700 text-[11px]">Issued</span>}</td>
                  <td className="px-3 whitespace-nowrap">
                    {canManage && r.status !== 'void' && (
                      <button onClick={() => openEdit(r)} title="Alter" className="text-blue-600 hover:text-blue-800 mr-2"><Pencil className="w-4 h-4" /></button>
                    )}
                    {canVoid && r.status !== 'void' && (
                      <button onClick={() => voidExpense(r)} title="Void / Cancel" className="text-red-600 hover:text-red-800"><Ban className="w-4 h-4" /></button>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan="10" className="py-8 text-center text-slate-400">No expenses found</td></tr>}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr className="bg-slate-50 font-semibold border-t border-slate-300">
                  <td colSpan="7" className="py-2 px-3 text-right">Total (excl. void)</td>
                  <td className="px-3 text-right font-mono">{inr(totalAmount)}</td>
                  <td colSpan="2"></td>
                </tr>
              </tfoot>
            )}
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
