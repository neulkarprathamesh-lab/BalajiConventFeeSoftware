import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import api from '@/lib/api';
import { Lock, LogOut } from 'lucide-react';
import { toast } from 'sonner';

export default function LockScreen() {
  const { user, unlock, logout } = useAuth();
  const [pin, setPin] = useState(['','','','']);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const refs = [useRef(), useRef(), useRef(), useRef()];

  useEffect(() => { refs[0].current?.focus(); }, []);

  const setDigit = (i, v) => {
    const d = v.replace(/\D/g, '').slice(-1);
    const p = [...pin]; p[i] = d; setPin(p);
    if (d && i < 3) refs[i+1].current?.focus();
    if (i === 3 && d) submit(p.join(''));
  };

  const onKey = (i, e) => {
    if (e.key === 'Backspace' && !pin[i] && i > 0) refs[i-1].current?.focus();
  };

  const submit = async (val) => {
    const code = val ?? pin.join('');
    if (code.length !== 4) return;
    setBusy(true); setErr('');
    try {
      await api.post('/auth/me/pin/verify', { pin: code });
      unlock();
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Incorrect PIN');
      setPin(['','','','']); refs[0].current?.focus();
    }
    setBusy(false);
  };

  return (
    <div className="fixed inset-0 z-[100] bg-slate-950/95 backdrop-blur-sm flex items-center justify-center p-6">
      <div className="w-full max-w-sm text-center">
        <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center">
          <Lock className="w-7 h-7 text-slate-300" strokeWidth={1.75} />
        </div>
        <div className="text-slate-100 font-heading text-2xl font-semibold tracking-tight mb-1">Screen Locked</div>
        <div className="text-slate-400 text-sm mb-8">Logged in as <span className="text-slate-200">{user?.name}</span> · Enter your 4-digit PIN to resume</div>
        <div className="flex gap-3 justify-center mb-4">
          {pin.map((d, i) => (
            <input
              key={i} ref={refs[i]} data-testid={`lock-pin-${i}`}
              type="password" inputMode="numeric" pattern="[0-9]*" maxLength={1}
              value={d} onChange={(e)=>setDigit(i, e.target.value)} onKeyDown={(e)=>onKey(i,e)}
              disabled={busy}
              className="w-14 h-16 text-2xl text-center bg-slate-900 border border-slate-700 rounded-md text-slate-100 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/40 outline-none tabular"
            />
          ))}
        </div>
        {err && <div data-testid="lock-error" className="text-red-400 text-sm mb-3">{err}</div>}
        <div className="flex items-center justify-center gap-3 mt-8 text-[12px]">
          <button data-testid="lock-logout" onClick={async () => { await logout(); window.location.href = '/login'; }} className="text-slate-400 hover:text-slate-100 flex items-center gap-1"><LogOut className="w-3.5 h-3.5" /> Sign out</button>
        </div>
      </div>
    </div>
  );
}
