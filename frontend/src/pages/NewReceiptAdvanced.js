import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import api from '@/lib/api';
import { PageHeader, inr } from '@/components/Layout';
import { Plus, Trash2, Search } from 'lucide-react';
import { toast } from 'sonner';

const TYPES = [
  { v: 'school', l: 'School Fee', needsStudent: true },
  { v: 'admission', l: 'Admission', needsStudent: true },
  { v: 'bus', l: 'Bus Fee', needsStudent: true },
  { v: 'misc', l: 'Miscellaneous', needsStudent: true },
  { v: 'department', l: 'Department', needsStudent: false },
  { v: 'general_money', l: 'General Money', needsStudent: false },
  { v: 'refund', l: 'Refund', needsStudent: true },
  { v: 'debit_voucher', l: 'Debit Voucher', needsStudent: false },
  { v: 'general_collection', l: 'General Collection', needsStudent: false },
];

export default function NewReceipt() {
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const [type, setType] = useState('school');
  const [depts, setDepts] = useState([]);
  const [feeHeads, setFeeHeads] = useState([]);
  const [dept, setDept] = useState('');
  const [receiptTypes, setReceiptTypes] = useState([]);
  const [receiptTypeId, setReceiptTypeId] = useState('');
  const [rtidTouched, setRtidTouched] = useState(false);
  const [studentQ, setStudentQ] = useState('');
  const [studentResults, setStudentResults] = useState([]);
  const [student, setStudent] = useState(null);
  const [payerName, setPayerName] = useState('');
  const [purpose, setPurpose] = useState('');
  const [mode, setMode] = useState('cash');
  const [ref, setRef] = useState('');
  const [remarks, setRemarks] = useState('');
  const [lines, setLines] = useState([{ fee_head_id: '', fee_head_name: '', amount: 0, note: '' }]);
  const [meta, setMeta] = useState({});
  const [saving, setSaving] = useState(false);

  const setM = (k, v) => setMeta({ ...meta, [k]: v });

  useEffect(() => {
    api.get('/departments').then(r => { setDepts(r.data); if (r.data[0]) setDept(r.data[0].id); });
    api.get('/fee-heads').then(r => setFeeHeads(r.data));
    api.get('/receipt-types').then(r => setReceiptTypes((r.data || []).filter(t => t.enabled !== false)));
    const sid = sp.get('student');
    if (sid) api.get(`/students/${sid}`).then(r => { setStudent(r.data); setDept(r.data.department_id); });
  }, []);

  // Suggest the matching receipt template for the selected department, but never
  // override a choice the cashier already made themselves.
  const deptCode = depts.find(d => d.id === dept)?.code;
  useEffect(() => {
    if (rtidTouched || !deptCode || receiptTypes.length === 0) return;
    const match = receiptTypes.find(t => (t.applicable_dept_codes || []).length === 1 && t.applicable_dept_codes[0] === deptCode)
      || receiptTypes.find(t => (t.applicable_dept_codes || []).includes(deptCode));
    if (match) setReceiptTypeId(match.id);
  }, [deptCode, receiptTypes]); // eslint-disable-line

  const searchStudents = async () => {
    if (!studentQ) return;
    const { data } = await api.get(`/students?q=${encodeURIComponent(studentQ)}`);
    setStudentResults(data);
  };

  const activeType = TYPES.find(t => t.v === type);
  const total = lines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0);

  const addLine = () => setLines([...lines, { fee_head_id:'', fee_head_name:'', amount: 0, note:'' }]);
  const removeLine = (i) => setLines(lines.filter((_, idx) => idx !== i));
  const setLine = (i, k, v) => setLines(lines.map((l, idx) => idx === i ? { ...l, [k]: v } : l));

  const submit = async () => {
    if (activeType.needsStudent && !student) { toast.error('Please select a student'); return; }
    if (!dept) { toast.error('Select department'); return; }
    if (lines.some(l => !l.fee_head_name || !l.amount)) { toast.error('Fill all line items'); return; }
    setSaving(true);
    try {
      const { data } = await api.post('/receipts', {
        receipt_type: type, department_id: dept,
        receipt_type_id: receiptTypeId || null,
        student_id: student?.id || null,
        payer_name: payerName || student?.name || null,
        purpose: purpose || null, payment_mode: mode, payment_reference: ref || null,
        lines, remarks: remarks || null,
        metadata: {
          ...meta,
          class_name: student ? undefined : meta.class_name,
          session: meta.session || undefined,
        },
      });
      toast.success(`Receipt ${data.number} issued`);
      nav(`/receipts/${data.id}`);
    } catch (e) {
      const d = e?.response?.data?.detail;
      toast.error(typeof d === 'string' ? d : 'Failed');
    } finally { setSaving(false); }
  };

  return (
    <>
      <PageHeader title="New Receipt" subtitle="Unified receipt engine — select type, capture details, issue instantly" />
      <div className="p-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white border border-slate-200 rounded p-4">
            <div className="text-[11px] uppercase tracking-widest text-slate-600 mb-2">Receipt Type</div>
            <div className="grid grid-cols-3 md:grid-cols-5 gap-2">
              {TYPES.map(t => (
                <button
                  key={t.v}
                  data-testid={`rtype-${t.v}`}
                  onClick={() => setType(t.v)}
                  className={`px-2.5 py-2 text-xs rounded border transition-colors duration-150 ${type===t.v ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-slate-300 text-slate-700 hover:border-slate-400'}`}
                >{t.l}</button>
              ))}
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded p-4 space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <Field label="Department *">
                <select data-testid="nr-dept" value={dept} onChange={e=>setDept(e.target.value)} className={inp}>
                  {depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </Field>
              <Field label="Receipt Format *">
                <select data-testid="nr-receipt-format" value={receiptTypeId}
                  onChange={e => { setRtidTouched(true); setReceiptTypeId(e.target.value); }} className={inp}>
                  <option value="">— Select —</option>
                  {receiptTypes.map(t => {
                    const compatible = !t.applicable_dept_codes || t.applicable_dept_codes.includes(deptCode);
                    return <option key={t.id} value={t.id}>{t.code} — {t.name}{compatible ? '' : ' (not for this department)'}</option>;
                  })}
                </select>
              </Field>
              <Field label="Payment Mode">
                <select data-testid="nr-mode" value={mode} onChange={e=>setMode(e.target.value)} className={inp}>
                  {['cash','cheque','dd','upi','neft','card','other'].map(m => <option key={m}>{m}</option>)}
                </select>
              </Field>
            </div>

            {activeType.needsStudent ? (
              <div>
                <div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">Student *</div>
                {student ? (
                  <div className="flex items-center justify-between border border-slate-300 rounded px-3 py-2">
                    <div className="text-sm">
                      <span className="font-mono text-[12px] mr-2 text-slate-500">{student.admission_no}</span>
                      <span className="font-medium">{student.name}</span>
                    </div>
                    <button onClick={() => setStudent(null)} className="text-xs text-red-600 hover:underline">Change</button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <div className="flex-1 relative">
                        <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                        <input data-testid="nr-student-search" value={studentQ} onChange={e=>setStudentQ(e.target.value)} onKeyDown={e=>e.key==='Enter'&&searchStudents()} placeholder="Search admission no / name / mobile…" className={`${inp} pl-9`} />
                      </div>
                      <button onClick={searchStudents} className="h-9 px-3 bg-slate-900 text-white rounded text-sm hover:bg-slate-800">Search</button>
                    </div>
                    {studentResults.length > 0 && (
                      <div className="border border-slate-200 rounded max-h-48 overflow-y-auto">
                        {studentResults.map(s => (
                          <button key={s.id} data-testid={`nr-student-result-${s.admission_no}`} onClick={() => { setStudent(s); setDept(s.department_id); setStudentResults([]); }}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 border-b border-slate-100 last:border-0">
                            <span className="font-mono text-[12px] text-slate-500 mr-2">{s.admission_no}</span> {s.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                <Field label="Payer Name *"><input data-testid="nr-payer" value={payerName} onChange={e=>setPayerName(e.target.value)} className={inp} /></Field>
                <Field label="Purpose"><input value={purpose} onChange={e=>setPurpose(e.target.value)} className={inp} /></Field>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <Field label="Payment Reference (Cheque/UPI/DD No.)"><input value={ref} onChange={e=>setRef(e.target.value)} className={inp} /></Field>
              <Field label="Remarks"><input value={remarks} onChange={e=>setRemarks(e.target.value)} className={inp} /></Field>
            </div>

            {/* Receipt-type-specific extra fields */}
            {type === 'bus' && (
              <div className="grid grid-cols-3 gap-4 border-t border-slate-200 pt-4">
                <Field label="Village Name"><input className={inp} value={meta.village_name || ''} onChange={e=>setM('village_name', e.target.value)} placeholder="Butibori / Wardha Road / ..." /></Field>
                <Field label="For the Month of"><input className={inp} value={meta.month || ''} onChange={e=>setM('month', e.target.value)} placeholder="April 2026" /></Field>
                <Field label="Bus No."><input className={inp} value={meta.bus_no || ''} onChange={e=>setM('bus_no', e.target.value)} placeholder="MH-31-AB-1234" /></Field>
              </div>
            )}
            {type === 'debit_voucher' && (
              <div className="grid grid-cols-2 gap-4 border-t border-slate-200 pt-4">
                <Field label="Paid to"><input className={inp} value={meta.paid_to || ''} onChange={e=>setM('paid_to', e.target.value)} placeholder="Vendor / Payee name" /></Field>
                <Field label="A/C Head"><input className={inp} value={meta.ac_head || ''} onChange={e=>setM('ac_head', e.target.value)} placeholder="Stationery / Repairs / Salary / ..." /></Field>
              </div>
            )}
            {(type === 'general_money' || type === 'general_collection') && (
              <div className="grid grid-cols-2 gap-4 border-t border-slate-200 pt-4">
                <Field label="On Account of"><input className={inp} value={meta.on_account_of || ''} onChange={e=>setM('on_account_of', e.target.value)} placeholder="Donation / Certificate fee / ..." /></Field>
                <Field label="Class (if applicable)"><input className={inp} value={meta.class_name || ''} onChange={e=>setM('class_name', e.target.value)} /></Field>
              </div>
            )}
            {activeType.needsStudent && student && (
              <div className="grid grid-cols-3 gap-4 border-t border-slate-200 pt-4">
                <Field label="Class"><input className={inp} value={meta.class_name || ''} onChange={e=>setM('class_name', e.target.value)} placeholder="e.g. 5th / A" /></Field>
                <Field label="Roll No"><input className={inp} value={meta.roll_no || ''} onChange={e=>setM('roll_no', e.target.value)} /></Field>
                <Field label="Medium"><select className={inp} value={meta.medium || ''} onChange={e=>setM('medium', e.target.value)}>
                  <option value="">Auto</option><option>English</option><option>Semi English</option><option>Marathi</option><option>Junior College</option>
                </select></Field>
                <Field label="Guardian Name"><input className={inp} value={meta.guardian_name || ''} onChange={e=>setM('guardian_name', e.target.value)} /></Field>
                <Field label="Mother Name"><input className={inp} value={meta.mother_name || ''} onChange={e=>setM('mother_name', e.target.value)} /></Field>
                <Field label="Contact No"><input className={inp} value={meta.guardian_mobile || ''} onChange={e=>setM('guardian_mobile', e.target.value)} /></Field>
                {type === 'admission' && <Field label="Session"><input className={inp} value={meta.session || ''} onChange={e=>setM('session', e.target.value)} placeholder="2026-27" /></Field>}
                {dept && depts.find(d=>d.id===dept)?.code === 'JC' && <Field label="Faculti"><input className={inp} value={meta.faculti || ''} onChange={e=>setM('faculti', e.target.value)} placeholder="Science / Commerce / Arts" /></Field>}
              </div>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
              <h3 className="font-heading font-medium">Line Items</h3>
              <button onClick={addLine} className="text-xs text-blue-700 hover:underline flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> Add line</button>
            </div>
            <table className="w-full dense-table">
              <thead><tr className="text-left text-[11px] uppercase tracking-wide text-slate-600"><th>Fee Head</th><th>Note / Installment</th><th className="text-right">Amount</th><th></th></tr></thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i}>
                    <td>
                      <select data-testid={`nr-line-fh-${i}`} value={l.fee_head_id} onChange={(e) => {
                        const fh = feeHeads.find(x => x.id === e.target.value);
                        setLines(lines.map((x, idx) => idx===i ? { ...x, fee_head_id: e.target.value, fee_head_name: fh?.name || '' } : x));
                      }} className={`${inp} h-8`}>
                        <option value="">-- select --</option>
                        {feeHeads.map(fh => <option key={fh.id} value={fh.id}>{fh.name}</option>)}
                      </select>
                    </td>
                    <td><input value={l.note} onChange={e=>setLine(i,'note',e.target.value)} className={`${inp} h-8`} /></td>
                    <td><input data-testid={`nr-line-amt-${i}`} type="number" step="0.01" value={l.amount} onChange={e=>setLine(i,'amount',e.target.value)} className={`${inp} h-8 text-right tabular`} /></td>
                    <td className="w-10">{lines.length > 1 && <button onClick={()=>removeLine(i)} className="text-red-600 hover:text-red-800"><Trash2 className="w-4 h-4" /></button>}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-200 bg-slate-50">
                  <td colSpan="2" className="text-right font-medium">Total</td>
                  <td className="text-right font-mono tabular text-lg font-semibold" data-testid="nr-total">{inr(total)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded p-5 h-fit sticky top-6">
          <div className="text-[11px] uppercase tracking-widest text-slate-500 mb-1">Summary</div>
          <div className="font-heading text-3xl font-semibold tabular mb-1">{inr(total)}</div>
          <div className="text-[13px] text-slate-600 capitalize">{activeType.l} · {mode}</div>
          <div className="border-t border-slate-200 my-4"></div>
          <div className="text-[12px] space-y-1 text-slate-600">
            <div>Department: <span className="text-slate-900">{depts.find(d=>d.id===dept)?.name || '-'}</span></div>
            {student && <div>Student: <span className="text-slate-900">{student.name}</span></div>}
            <div>Lines: <span className="text-slate-900">{lines.filter(l=>l.amount).length}</span></div>
          </div>
          <button data-testid="nr-submit" onClick={submit} disabled={saving || total <= 0} className="mt-5 w-full h-11 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium rounded transition-colors duration-150">
            {saving ? 'Issuing…' : `Issue Receipt · ${inr(total)}`}
          </button>
        </div>
      </div>
    </>
  );
}

const inp = "w-full h-9 px-3 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-600 focus:border-blue-600 focus:outline-none bg-white";
const Field = ({ label, children }) => (
  <label className="block"><div className="text-[11px] tracking-wide uppercase text-slate-600 mb-1">{label}</div>{children}</label>
);
