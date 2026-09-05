import React, { useEffect, useState } from 'react';
import api from '@/lib/api';
import { PageHeader } from '@/components/Layout';
import { toast } from 'sonner';

export default function Admin() {
  const [users, setUsers] = useState([]);
  const [audit, setAudit] = useState([]);
  const [depts, setDepts] = useState([]);
  const [classes, setClasses] = useState([]);
  const [tab, setTab] = useState('users');
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ email:'', password:'', name:'', role:'cashier' });
  const [deptOpen, setDeptOpen] = useState(false);
  const [deptForm, setDeptForm] = useState({ name:'', code:'', academic_year:'2026-27' });
  const [classOpen, setClassOpen] = useState(false);
  const [classForm, setClassForm] = useState({ department_id:'', name:'', section:'' });

  const load = () => {
    api.get('/users').then(r => setUsers(r.data));
    api.get('/reports/audit?limit=200').then(r => setAudit(r.data));
    api.get('/departments').then(r => setDepts(r.data));
    api.get('/classes').then(r => setClasses(r.data));
  };
  useEffect(load, []);

  const submitDept = async (e) => {
    e.preventDefault();
    try {
      await api.post('/departments', { ...deptForm, code: deptForm.code.toUpperCase() });
      toast.success('Department created');
      setDeptOpen(false); setDeptForm({ name:'', code:'', academic_year:'2026-27' }); load();
    } catch (ex) { toast.error(ex?.response?.data?.detail || 'Failed to create department'); }
  };

  const submitClass = async (e) => {
    e.preventDefault();
    if (!classForm.department_id) return toast.error('Select a department');
    try {
      await api.post('/classes', { ...classForm, section: classForm.section || null });
      toast.success('Class created');
      setClassOpen(false); setClassForm({ department_id:'', name:'', section:'' }); load();
    } catch (ex) { toast.error(ex?.response?.data?.detail || 'Failed to create class'); }
  };

  const submit = async (e) => {
    e.preventDefault();
    try { await api.post('/users', f); toast.success('User created'); setOpen(false); setF({email:'',password:'',name:'',role:'cashier'}); load(); }
    catch (ex) { toast.error(ex?.response?.data?.detail || 'Failed'); }
  };

  return (
    <>
      <PageHeader title="Administration" subtitle="Users · audit log · settings" />
      <div className="p-6 space-y-4">
        <div className="flex gap-2 border-b border-slate-200">
          {[['users','Users'],['catalog','Departments & Classes'],['audit','Audit Log'],['install','Install Package']].map(([k,l]) => (
            <button key={k} onClick={()=>setTab(k)} className={`px-4 py-2 text-sm border-b-2 ${tab===k?'border-blue-600 text-blue-700 font-medium':'border-transparent text-slate-600'}`}>{l}</button>
          ))}
        </div>

        {tab==='users' && <>
          <div className="flex justify-end"><button data-testid="admin-new-user" onClick={()=>setOpen(true)} className="h-9 px-3 bg-blue-600 text-white rounded text-sm hover:bg-blue-700">New User</button></div>
          <div className="bg-white border border-slate-200 rounded overflow-hidden">
            <table className="w-full dense-table">
              <thead><tr className="text-left text-[11px] uppercase tracking-wide text-slate-600"><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Created</th><th></th></tr></thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id}><td className="font-medium">{u.name}</td><td className="font-mono text-[12px]">{u.email}</td>
                    <td><span className="text-[11px] uppercase px-1.5 py-0.5 rounded bg-slate-200">{u.role}</span></td>
                    <td>{u.active !== false ? <span className="text-[11px] text-emerald-700">active</span> : <span className="text-[11px] text-red-700">disabled</span>}</td>
                    <td className="text-[12px] text-slate-500">{new Date(u.created_at).toLocaleDateString('en-IN')}</td>
                    <td>
                      {u.email !== 'neulkarprathamesh@gmail.com' && (
                        <button
                          data-testid={`user-toggle-${u.id}`}
                          onClick={async () => {
                            const willDisable = u.active !== false;
                            if (!window.confirm(`${willDisable ? 'Suspend' : 'Reactivate'} ${u.name}? Their audit history stays intact.`)) return;
                            try { await api.patch(`/users/${u.id}`, { active: !willDisable }); toast.success(willDisable ? 'User suspended' : 'User reactivated'); load(); }
                            catch (e) { toast.error(e?.response?.data?.detail || 'Failed'); }
                          }}
                          className={`text-xs px-2 py-0.5 rounded ${u.active !== false ? 'border border-red-300 text-red-700 hover:bg-red-50' : 'border border-emerald-300 text-emerald-700 hover:bg-emerald-50'}`}
                        >{u.active !== false ? 'Suspend' : 'Reactivate'}</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>}

        {tab==='catalog' && <>
          <div className="grid lg:grid-cols-2 gap-4">
            <div className="bg-white border border-slate-200 rounded overflow-hidden">
              <div className="px-4 py-2.5 border-b border-slate-200 flex items-center justify-between">
                <div className="font-heading font-medium text-sm">Departments</div>
                <button data-testid="admin-new-dept" onClick={()=>setDeptOpen(true)} className="h-8 px-3 bg-blue-600 text-white rounded text-[12px] hover:bg-blue-700">New Department</button>
              </div>
              <table className="w-full dense-table">
                <thead><tr className="text-left text-[11px] uppercase tracking-wide text-slate-600"><th>Code</th><th>Name</th><th>Academic Year</th></tr></thead>
                <tbody>
                  {depts.length === 0 && <tr><td colSpan="3" className="p-4 text-center text-slate-500 text-[13px]">No departments yet</td></tr>}
                  {depts.map(d => (
                    <tr key={d.id}><td className="font-mono text-[11px] font-bold">{d.code}</td><td className="font-medium">{d.name}</td><td className="text-[12px] text-slate-500">{d.academic_year}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="bg-white border border-slate-200 rounded overflow-hidden">
              <div className="px-4 py-2.5 border-b border-slate-200 flex items-center justify-between">
                <div className="font-heading font-medium text-sm">Classes</div>
                <button data-testid="admin-new-class" onClick={()=>setClassOpen(true)} className="h-8 px-3 bg-blue-600 text-white rounded text-[12px] hover:bg-blue-700">New Class</button>
              </div>
              <table className="w-full dense-table">
                <thead><tr className="text-left text-[11px] uppercase tracking-wide text-slate-600"><th>Department</th><th>Class</th><th>Section</th></tr></thead>
                <tbody>
                  {classes.length === 0 && <tr><td colSpan="3" className="p-4 text-center text-slate-500 text-[13px]">No classes yet</td></tr>}
                  {classes.map(c => {
                    const d = depts.find(x=>x.id===c.department_id);
                    return <tr key={c.id}><td className="text-[12px] text-slate-600">{d?.name || '—'}</td><td className="font-medium">{c.name}</td><td className="text-[12px] text-slate-500">{c.section || '—'}</td></tr>;
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>}

        {tab==='install' && (
          <div className="bg-white border border-slate-200 rounded-lg p-6 max-w-3xl">
            <div className="flex items-start gap-4">
              <div className="w-14 h-14 rounded-lg bg-slate-900 text-white flex items-center justify-center flex-shrink-0">
                <svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              </div>
              <div className="flex-1">
                <div className="text-[11px] uppercase tracking-widest text-slate-500 font-bold">Self-Host Distribution</div>
                <h3 className="font-heading font-semibold text-xl text-slate-900 leading-tight mt-0.5">Balaji Convent Fee Software — Complete Install Package (v1.0)</h3>
                <p className="text-sm text-slate-600 mt-2">A single ZIP with everything to install and maintain the software on your school's LAN — Windows installers, complete source, database + services setup, Excel templates, role-based manuals, printer setup, backup guide, and optional SMS/email configuration.</p>
                <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1 text-[12px] text-slate-700">
                  <div>▪ <b>START_HERE.md</b> — install order</div>
                  <div>▪ Windows installer for Main PC</div>
                  <div>▪ Client PC (cashier) installer</div>
                  <div>▪ Full source (backend + frontend)</div>
                  <div>▪ MongoDB + service setup</div>
                  <div>▪ Excel import templates (2)</div>
                  <div>▪ User manuals (4 roles)</div>
                  <div>▪ LAN network guide</div>
                  <div>▪ Printer setup instructions</div>
                  <div>▪ Backup & restore drill</div>
                  <div>▪ SMS / email config (optional)</div>
                  <div>▪ Default admin day-one checklist</div>
                </div>
                <div className="mt-5 flex items-center gap-3">
                  <a data-testid="admin-download-zip" href="/downloads/BalajiConventFeeSoftware-v1.0.zip" download className="h-11 px-5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-semibold inline-flex items-center gap-2 shadow-sm">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    Download ZIP (1.6 MB)
                  </a>
                  <div className="text-[11px] text-slate-500">Version 1.0 · offline-ready · start by reading <code className="font-mono">START_HERE.md</code></div>
                </div>
                <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded text-[12px] text-amber-900">
                  <b>Install order (critical):</b> 1) Main Server PC first → 2) verify database + backend → 3) install client shortcut on every cashier / office PC → 4) set up printer → 5) schedule daily backup → 6) (optional) enable SMS/email.
                </div>
              </div>
            </div>
          </div>
        )}

        {tab==='audit' && (
          <div className="bg-white border border-slate-200 rounded overflow-hidden">
            <table className="w-full dense-table">
              <thead><tr className="text-left text-[11px] uppercase tracking-wide text-slate-600"><th>Timestamp</th><th>User</th><th>Role</th><th>Action</th><th>Entity</th><th>Details</th></tr></thead>
              <tbody>
                {audit.map(a => (
                  <tr key={a.id}>
                    <td className="text-[12px] font-mono">{new Date(a.timestamp).toLocaleString('en-IN')}</td>
                    <td className="text-[12px]">{a.user_email}</td>
                    <td className="text-[11px] uppercase">{a.user_role}</td>
                    <td className="text-[12px] font-medium capitalize">{a.action}</td>
                    <td className="text-[12px] capitalize">{a.entity}</td>
                    <td className="text-[11px] text-slate-500 font-mono max-w-md truncate">{JSON.stringify(a.details)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {open && (
        <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50 p-4">
          <form onSubmit={submit} className="bg-white rounded shadow-lg w-full max-w-md">
            <div className="px-5 py-3 border-b border-slate-200 font-heading font-medium">New Staff User</div>
            <div className="p-5 space-y-3">
              <F label="Full Name"><input required className={inp} value={f.name} onChange={e=>setF({...f,name:e.target.value})} /></F>
              <F label="Email"><input required type="email" className={inp} value={f.email} onChange={e=>setF({...f,email:e.target.value})} /></F>
              <F label="Password"><input required type="text" className={inp} value={f.password} onChange={e=>setF({...f,password:e.target.value})} /></F>
              <F label="Role"><select className={inp} value={f.role} onChange={e=>setF({...f,role:e.target.value})}>{['cashier','accountant','manager','administrator'].map(r=><option key={r}>{r}</option>)}</select></F>
            </div>
            <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-200 bg-slate-50">
              <button type="button" onClick={()=>setOpen(false)} className="h-9 px-3 border border-slate-300 rounded text-sm">Cancel</button>
              <button className="h-9 px-4 bg-blue-600 text-white rounded text-sm">Create</button>
            </div>
          </form>
        </div>
      )}

      {deptOpen && (
        <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50 p-4" onClick={()=>setDeptOpen(false)}>
          <form onSubmit={submitDept} onClick={e=>e.stopPropagation()} className="bg-white rounded shadow-lg w-full max-w-md">
            <div className="px-5 py-3 border-b border-slate-200 font-heading font-medium">New Department</div>
            <div className="p-5 space-y-3">
              <F label="Name"><input required data-testid="admin-dept-name" className={inp} value={deptForm.name} onChange={e=>setDeptForm({...deptForm,name:e.target.value})} placeholder="e.g. Senior Secondary" /></F>
              <F label="Code (prefix)"><input required data-testid="admin-dept-code" maxLength={8} className={`${inp} font-mono uppercase`} value={deptForm.code} onChange={e=>setDeptForm({...deptForm,code:e.target.value.toUpperCase()})} placeholder="e.g. SS" /></F>
              <F label="Academic Year"><input required className={inp} value={deptForm.academic_year} onChange={e=>setDeptForm({...deptForm,academic_year:e.target.value})} /></F>
            </div>
            <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-200 bg-slate-50">
              <button type="button" onClick={()=>setDeptOpen(false)} className="h-9 px-3 border border-slate-300 rounded text-sm">Cancel</button>
              <button data-testid="admin-dept-submit" className="h-9 px-4 bg-blue-600 text-white rounded text-sm">Create</button>
            </div>
          </form>
        </div>
      )}

      {classOpen && (
        <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50 p-4" onClick={()=>setClassOpen(false)}>
          <form onSubmit={submitClass} onClick={e=>e.stopPropagation()} className="bg-white rounded shadow-lg w-full max-w-md">
            <div className="px-5 py-3 border-b border-slate-200 font-heading font-medium">New Class</div>
            <div className="p-5 space-y-3">
              <F label="Department"><select required data-testid="admin-class-dept" className={inp} value={classForm.department_id} onChange={e=>setClassForm({...classForm,department_id:e.target.value})}>
                <option value="">Select…</option>{depts.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}
              </select></F>
              <F label="Class Name"><input required data-testid="admin-class-name" className={inp} value={classForm.name} onChange={e=>setClassForm({...classForm,name:e.target.value})} placeholder="e.g. Class 11 - Arts" /></F>
              <F label="Section (optional)"><input className={inp} value={classForm.section} onChange={e=>setClassForm({...classForm,section:e.target.value})} placeholder="e.g. A" /></F>
            </div>
            <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-200 bg-slate-50">
              <button type="button" onClick={()=>setClassOpen(false)} className="h-9 px-3 border border-slate-300 rounded text-sm">Cancel</button>
              <button data-testid="admin-class-submit" className="h-9 px-4 bg-blue-600 text-white rounded text-sm">Create</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
const inp = "w-full h-9 px-3 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-600 focus:border-blue-600 focus:outline-none bg-white";
const F = ({label,children}) => <label className="block"><div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">{label}</div>{children}</label>;
