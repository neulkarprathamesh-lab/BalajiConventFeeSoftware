import React, { useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import api from '@/lib/api';
import { PageHeader } from '@/components/Layout';
import { toast } from 'sonner';
import { Lock, UserCircle, ShieldAlert, KeyRound } from 'lucide-react';

export default function Profile() {
  const { user, setUser } = useAuth();
  const [name, setName] = useState(user?.name || '');
  const [cur, setCur] = useState('');
  const [neu, setNeu] = useState('');
  const [conf, setConf] = useState('');
  const [busy, setBusy] = useState(false);
  const [hasPin, setHasPin] = useState(false);
  const [pinCurrent, setPinCurrent] = useState('');
  const [pinNew, setPinNew] = useState('');
  const [pinPassword, setPinPassword] = useState('');

  useEffect(() => {
    api.get('/auth/me/pin-status').then(r => setHasPin(r.data.has_pin));
  }, []);

  const saveName = async (e) => {
    e.preventDefault();
    if (!name.trim()) return toast.error('Name is required');
    setBusy(true);
    try { const { data } = await api.patch('/auth/me', { name }); setUser(data); toast.success('Profile updated'); }
    catch (e) { toast.error(e?.response?.data?.detail || 'Failed'); }
    setBusy(false);
  };

  const savePwd = async (e) => {
    e.preventDefault();
    if (neu !== conf) return toast.error('New password and confirmation do not match');
    if (neu.length < 6) return toast.error('New password must be at least 6 characters');
    setBusy(true);
    try {
      await api.patch('/auth/me', { current_password: cur, new_password: neu });
      toast.success('Password changed');
      setCur(''); setNeu(''); setConf('');
    } catch (e) { toast.error(e?.response?.data?.detail || 'Failed'); }
    setBusy(false);
  };

  const savePin = async (e) => {
    e.preventDefault();
    if (!/^\d{4}$/.test(pinNew)) return toast.error('PIN must be exactly 4 digits');
    setBusy(true);
    try {
      const payload = { new_pin: pinNew };
      if (hasPin) payload.current_pin = pinCurrent;
      else payload.current_password = pinPassword;
      await api.post('/auth/me/pin', payload);
      toast.success(hasPin ? 'PIN changed' : 'PIN set — use the 🔒 Lock button in the sidebar to lock your screen');
      setPinCurrent(''); setPinNew(''); setPinPassword(''); setHasPin(true);
    } catch (e) { toast.error(e?.response?.data?.detail || 'Failed'); }
    setBusy(false);
  };

  const removePin = async () => {
    if (!window.confirm('Remove your screen-lock PIN? You will need to enter your password to set it again.')) return;
    setBusy(true);
    try { await api.delete('/auth/me/pin'); toast.success('PIN removed'); setHasPin(false); }
    catch (e) { toast.error(e?.response?.data?.detail || 'Failed'); }
    setBusy(false);
  };

  return (
    <>
      <PageHeader title="My Profile" subtitle="Edit your name, password and screen-lock PIN. Your login ID and role are set by the administrator." />
      <div className="p-6 grid grid-cols-1 lg:grid-cols-2 gap-6 max-w-5xl">

        <div className="bg-white border border-slate-200 rounded p-5">
          <div className="flex items-center gap-2 mb-4"><UserCircle className="w-5 h-5 text-slate-600" /><h3 className="font-heading font-medium">Identity</h3></div>
          <div className="text-[13px] text-slate-600 space-y-2 mb-4">
            <div className="flex justify-between border-b border-slate-100 py-1"><span className="text-slate-500">Login ID</span><span className="font-mono text-slate-900">{user?.email}</span></div>
            <div className="flex justify-between border-b border-slate-100 py-1"><span className="text-slate-500">Role</span><span className="uppercase text-[11px] px-1.5 py-0.5 rounded bg-slate-200 text-slate-800">{user?.role}</span></div>
            <div className="flex justify-between border-b border-slate-100 py-1"><span className="text-slate-500">Account created</span><span>{user?.created_at ? new Date(user.created_at).toLocaleDateString('en-IN') : '—'}</span></div>
          </div>
          <div className="flex items-center gap-2 text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">
            <ShieldAlert className="w-4 h-4" /> Your login ID and role can only be changed by the administrator.
          </div>
        </div>

        <form onSubmit={saveName} className="bg-white border border-slate-200 rounded p-5">
          <div className="flex items-center gap-2 mb-4"><UserCircle className="w-5 h-5 text-slate-600" /><h3 className="font-heading font-medium">Display Name</h3></div>
          <F label="Full Name"><input data-testid="prof-name" required className={inp} value={name} onChange={e=>setName(e.target.value)} /></F>
          <button data-testid="prof-save-name" disabled={busy} className="mt-4 h-9 px-4 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-60">Save Name</button>
        </form>

        <form onSubmit={savePwd} className="bg-white border border-slate-200 rounded p-5">
          <div className="flex items-center gap-2 mb-4"><Lock className="w-5 h-5 text-slate-600" /><h3 className="font-heading font-medium">Change Password</h3></div>
          <div className="space-y-3">
            <F label="Current Password"><input data-testid="prof-cur" type="password" required className={inp} value={cur} onChange={e=>setCur(e.target.value)} /></F>
            <div className="grid grid-cols-2 gap-3">
              <F label="New Password"><input data-testid="prof-new" type="password" required className={inp} value={neu} onChange={e=>setNeu(e.target.value)} /></F>
              <F label="Confirm New Password"><input data-testid="prof-conf" type="password" required className={inp} value={conf} onChange={e=>setConf(e.target.value)} /></F>
            </div>
          </div>
          <button data-testid="prof-save-pwd" disabled={busy} className="mt-4 h-9 px-4 bg-slate-900 text-white rounded text-sm hover:bg-slate-800 disabled:opacity-60">Change Password</button>
        </form>

        <form onSubmit={savePin} className="bg-white border border-slate-200 rounded p-5">
          <div className="flex items-center gap-2 mb-2"><KeyRound className="w-5 h-5 text-slate-600" /><h3 className="font-heading font-medium">Screen-Lock PIN</h3>
            {hasPin && <span className="ml-auto text-[10px] uppercase tracking-widest bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded">Active</span>}
          </div>
          <p className="text-[13px] text-slate-600 mb-3">A 4-digit PIN to lock the screen between customers — quicker than logging out. Set once, then tap 🔒 in the sidebar to lock.</p>
          <div className="space-y-3">
            {hasPin ? (
              <F label="Current PIN"><input data-testid="prof-pin-cur" type="password" inputMode="numeric" maxLength={4} className={inp} value={pinCurrent} onChange={e=>setPinCurrent(e.target.value.replace(/\D/g,''))} /></F>
            ) : (
              <F label="Current Password (to set your first PIN)"><input data-testid="prof-pin-pwd" type="password" className={inp} value={pinPassword} onChange={e=>setPinPassword(e.target.value)} /></F>
            )}
            <F label="New 4-digit PIN"><input data-testid="prof-pin-new" type="password" inputMode="numeric" maxLength={4} className={inp} value={pinNew} onChange={e=>setPinNew(e.target.value.replace(/\D/g,''))} placeholder="••••" /></F>
          </div>
          <div className="mt-4 flex items-center gap-2">
            <button data-testid="prof-save-pin" disabled={busy} className="h-9 px-4 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-60">{hasPin ? 'Change PIN' : 'Set PIN'}</button>
            {hasPin && <button type="button" onClick={removePin} className="h-9 px-3 border border-red-300 text-red-700 rounded text-sm hover:bg-red-50">Remove PIN</button>}
          </div>
        </form>
      </div>
    </>
  );
}
const inp = "w-full h-9 px-3 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-600 focus:border-blue-600 focus:outline-none bg-white";
const F = ({label, children}) => <label className="block"><div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">{label}</div>{children}</label>;

