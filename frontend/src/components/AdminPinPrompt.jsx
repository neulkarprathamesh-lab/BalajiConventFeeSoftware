import React, { useState } from 'react';
import api from '@/lib/api';
import { toast } from 'sonner';
import { Shield, Lock, Loader2, X } from 'lucide-react';

// Reusable modal that verifies the Admin PIN (and optionally the password too, for dual auth)
// Usage:
//   const [prompt, setPrompt] = useState(null);   // {mode:'pin'|'dual', onOk:(headers)=>void, title, message}
//   <AdminPinPrompt prompt={prompt} onClose={()=>setPrompt(null)} />
export default function AdminPinPrompt({ prompt, onClose }) {
  const [pin, setPin] = useState('');
  const [pwd, setPwd] = useState('');
  const [busy, setBusy] = useState(false);
  if (!prompt) return null;
  const dual = prompt.mode === 'dual';

  const submit = async (e) => {
    e?.preventDefault();
    if (pin.length < 4) return toast.error('PIN must be at least 4 digits');
    if (dual && !pwd) return toast.error('Enter your admin password');
    setBusy(true);
    try {
      // Verify PIN first via probe endpoint (also raises 400 if PIN not set)
      await api.post('/auth/admin-pin/verify', { pin });
      const headers = { 'X-Admin-PIN': pin };
      if (dual) headers['X-Admin-Password'] = pwd;
      onClose();
      setPin(''); setPwd('');
      await prompt.onOk(headers);
    } catch (err) {
      const d = err?.response?.data?.detail;
      toast.error(typeof d === 'string' ? d : 'Verification failed');
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <form onSubmit={submit} onClick={e=>e.stopPropagation()} className="bg-white rounded-lg shadow-2xl w-full max-w-sm border-t-4 border-red-600">
        <div className="p-5 border-b border-slate-200 flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-red-50 text-red-700 flex items-center justify-center flex-shrink-0">
            <Shield className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <div className="font-heading font-bold text-slate-900">{prompt.title || 'Administrator Verification'}</div>
            <div className="text-[12px] text-slate-600 mt-0.5">{prompt.message || 'Enter your Administrator PIN to continue.'}</div>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-3">
          <label className="block">
            <div className="text-[11px] uppercase tracking-widest text-slate-600 font-bold mb-1 flex items-center gap-1"><Lock className="w-3 h-3" /> Administrator PIN</div>
            <input data-testid="admin-pin-input" type="password" inputMode="numeric" autoFocus maxLength={8} value={pin} onChange={e=>setPin(e.target.value.replace(/\D/g,''))} placeholder="••••" className="w-full h-11 px-3 border-2 border-slate-300 rounded font-mono text-lg tracking-widest text-center focus:ring-2 focus:ring-blue-600 focus:border-blue-600 focus:outline-none" />
          </label>
          {dual && (
            <label className="block">
              <div className="text-[11px] uppercase tracking-widest text-slate-600 font-bold mb-1">Administrator Password</div>
              <input data-testid="admin-pwd-input" type="password" value={pwd} onChange={e=>setPwd(e.target.value)} className="w-full h-11 px-3 border-2 border-slate-300 rounded" />
              <div className="mt-1 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">Dual authorisation required for this action.</div>
            </label>
          )}
          <div className="flex items-center gap-2 pt-2">
            <button type="button" onClick={onClose} className="h-9 px-4 border border-slate-300 rounded text-sm hover:bg-slate-50">Cancel</button>
            <button type="submit" data-testid="admin-pin-verify" disabled={busy} className="flex-1 h-9 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white rounded text-sm font-semibold flex items-center justify-center gap-2">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
              {dual ? 'Verify & Continue' : 'Verify PIN'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
