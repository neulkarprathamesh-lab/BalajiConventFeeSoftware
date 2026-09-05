import React, { useState } from 'react';
import { PageHeader } from '@/components/Layout';
import { useAuth } from '@/context/AuthContext';
import { toast } from 'sonner';
import {
  Bomb, ShieldAlert, Lock, KeyRound, Trash2, CheckCircle2, AlertTriangle,
  Loader2, ChevronRight, Eye, EyeOff, Info, Settings2,
} from 'lucide-react';
import { API_BASE } from '@/lib/api';

// Runtime-detected (never a build-time env var) - see lib/api.js.
const API = API_BASE;

/**
 * Factory Reset — Administrator-only. 5-gate destructive operation:
 *   1) Role = administrator (route-guarded)
 *   2) X-Admin-Pin
 *   3) Password re-verify
 *   4) Factory Reset PIN (default 2580, changeable)
 *   5) Confirmation phrase "DELETE ALL SCHOOL DATA"
 * Server auto-creates a database backup + config snapshot BEFORE deletion.
 */
export default function FactoryReset() {
  const { user } = useAuth();
  const [status, setStatus] = useState(null);
  const [stage, setStage]   = useState('idle');   // idle | warning | form | doing | done
  const [busy, setBusy]     = useState(false);
  const [pinGate, setPinGate] = useState(true);   // Administrator PIN required before viewing this page
  const [pinInput, setPinInput] = useState('');
  const [pinLoading, setPinLoading] = useState(false);
  const [pinErr, setPinErr] = useState('');

  // form fields
  const [password, setPassword] = useState('');
  const [showPw, setShowPw]     = useState(false);
  const [factoryPin, setPin]    = useState('');
  const [phrase, setPhrase]     = useState('');
  const [acknowledged, setAck]  = useState(false);
  const [result, setResult]     = useState(null);

  // change-PIN modal
  const [showChangePin, setShowChangePin] = useState(false);
  const [changePw, setChangePw] = useState('');
  const [newPin, setNewPin]     = useState('');
  const [newPin2, setNewPin2]   = useState('');

  // Administrator PIN gate: previously used window.prompt(), which this
  // Chromium/Electron environment does not support (throws "prompt() is not
  // supported."). That threw inside an un-awaited async call, so `status`
  // never got set and the page was stuck on "Loading…" forever. Replaced
  // with an in-app modal below (`pinGate`) that collects the PIN the same
  // way the rest of the app's PIN dialogs do.
  const load = async (adminPin) => {
    setPinLoading(true); setPinErr('');
    try {
      const r = await fetch(`${API}/api/production/factory-reset/status`, {
        credentials: 'include',
        headers: {
          Authorization: `Bearer ${localStorage.getItem('bc_token') || ''}`,
          'X-Admin-Pin': adminPin,
        },
      });
      if (!r.ok) throw new Error(await r.text());
      const data = await r.json();
      setStatus({ ...data, adminPin });
      setPinGate(false);
      setPinInput('');
    } catch (e) {
      setPinErr(String(e.message || e));
    } finally {
      setPinLoading(false);
    }
  };

  const canExecute =
    password.length >= 4 &&
    factoryPin.length >= 4 &&
    phrase === 'DELETE ALL SCHOOL DATA' &&
    acknowledged;

  const doReset = async () => {
    if (!canExecute) return toast.error('Please complete every field correctly.');
    setBusy(true); setStage('doing');
    try {
      const r = await fetch(`${API}/api/production/factory-reset`, {
        method: 'POST', credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('bc_token') || ''}`,
          'X-Admin-Pin': status.adminPin,
        },
        body: JSON.stringify({
          current_password: password,
          factory_pin: factoryPin,
          confirm_phrase: phrase,
        }),
      });
      if (!r.ok) throw new Error(await r.text());
      const data = await r.json();
      setResult(data);
      setStage('done');
      toast.success('Factory Reset complete — the database is now in fresh-install state.');
    } catch (e) {
      toast.error(String(e.message || e));
      setStage('form');
    } finally { setBusy(false); }
  };

  const changePin = async () => {
    if (newPin !== newPin2)  return toast.error('New PINs do not match.');
    if (!/^\d{4,8}$/.test(newPin)) return toast.error('PIN must be 4–8 digits.');
    try {
      const r = await fetch(`${API}/api/production/factory-reset/change-pin`, {
        method: 'POST', credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('bc_token') || ''}`,
          'X-Admin-Pin': status.adminPin,
        },
        body: JSON.stringify({ current_password: changePw, new_pin: newPin }),
      });
      if (!r.ok) throw new Error(await r.text());
      toast.success('Factory Reset PIN updated.');
      setShowChangePin(false); setChangePw(''); setNewPin(''); setNewPin2('');
      load(status.adminPin);
    } catch (e) { toast.error(String(e.message || e)); }
  };

  if (user?.role !== 'administrator') {
    return (
      <div className="p-6" data-testid="factory-reset-blocked">
        <div className="p-4 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-sm flex items-center gap-2">
          <ShieldAlert className="w-4 h-4" /> Factory Reset is available to Administrators only.
        </div>
      </div>
    );
  }

  if (pinGate) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[70vh]">
        <div className="max-w-sm w-full bg-white border border-slate-200 rounded-xl p-5 shadow space-y-3" data-testid="fr-pin-gate">
          <div className="font-heading font-bold text-lg flex items-center gap-2"><KeyRound className="w-4 h-4" /> Administrator PIN required</div>
          <div className="text-[12px] text-slate-500">Enter your Administrator PIN (My Profile) to view Factory Reset controls.</div>
          <input
            type="password" inputMode="numeric" autoFocus
            value={pinInput}
            onChange={(e) => setPinInput(e.target.value.replace(/\D/g, '').slice(0, 8))}
            onKeyDown={(e) => { if (e.key === 'Enter' && pinInput && !pinLoading) load(pinInput); }}
            className="w-full h-10 px-3 border border-slate-300 rounded text-sm font-mono"
            placeholder="Enter PIN"
            data-testid="fr-pin-gate-input"
          />
          {pinErr && <div className="text-[12px] text-rose-600" data-testid="fr-pin-gate-error">{pinErr}</div>}
          <button
            onClick={() => load(pinInput)}
            disabled={!pinInput || pinLoading}
            className="w-full h-10 bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white rounded text-sm font-semibold inline-flex items-center justify-center gap-1.5"
            data-testid="fr-pin-gate-submit"
          >
            {pinLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />} {pinLoading ? 'Verifying…' : 'Continue'}
          </button>
        </div>
      </div>
    );
  }

  if (!status) return <div className="p-8 text-sm text-slate-500">Loading Factory Reset controls…</div>;

  return (
    <>
      <PageHeader
        title="Factory Reset · System Maintenance"
        subtitle="Reset the software for a new academic year or a fresh installation. This is a destructive, administrator-only operation."
      />
      <div className="p-6 space-y-6" data-testid="factory-reset-page">

        {/* Status card */}
        <div className="grid md:grid-cols-3 gap-4">
          <div className="md:col-span-2 bg-white border border-slate-200 rounded-xl p-4" data-testid="fr-status">
            <div className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">Preserved after reset</div>
            <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-2 text-[12px]">
              {Object.entries(status.will_preserve || {}).map(([k, v]) => (
                <div key={k} className="flex justify-between font-mono border border-slate-100 rounded px-2 py-1">
                  <span className="text-slate-600">{k}</span><span className="text-emerald-700 font-bold">{v}</span>
                </div>
              ))}
              <div className="flex justify-between font-mono border border-emerald-100 bg-emerald-50 rounded px-2 py-1">
                <span className="text-emerald-800">administrator(s)</span><span className="text-emerald-700 font-bold">{status.admin_users_preserved}</span>
              </div>
            </div>

            <div className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mt-4">Will be deleted</div>
            <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-2 text-[12px]">
              {Object.entries(status.will_delete || {}).map(([k, v]) => (
                <div key={k} className="flex justify-between font-mono border border-slate-100 rounded px-2 py-1">
                  <span className="text-slate-600">{k}</span><span className={Number(v) > 0 ? 'text-rose-700 font-bold' : 'text-slate-400'}>{v}</span>
                </div>
              ))}
              <div className="flex justify-between font-mono border border-rose-100 bg-rose-50 rounded px-2 py-1">
                <span className="text-rose-800">non-admin users</span><span className="text-rose-700 font-bold">{status.non_admin_users_will_be_deleted}</span>
              </div>
              <div className="flex justify-between font-mono border border-rose-100 bg-rose-50 rounded px-2 py-1">
                <span className="text-rose-800">counters (reset)</span><span className="text-rose-700 font-bold">all</span>
              </div>
            </div>
          </div>

          <div className="bg-slate-900 text-white rounded-xl p-4" data-testid="fr-pin-card">
            <div className="text-[10px] uppercase tracking-widest text-slate-400 font-bold flex items-center gap-1"><KeyRound className="w-3 h-3" /> Factory Reset PIN</div>
            {status.is_default_pin ? (
              <div className="mt-2 p-3 bg-amber-900/40 border border-amber-400/30 rounded">
                <div className="text-[13px] font-semibold text-amber-200">Default PIN in use</div>
                <div className="text-[11px] text-amber-300/80 mt-1">The Factory Reset PIN is still <span className="font-mono">2580</span>. Please change it to a private value before shipping the software.</div>
              </div>
            ) : (
              <div className="mt-2 p-3 bg-emerald-900/40 border border-emerald-400/30 rounded">
                <div className="text-[13px] font-semibold text-emerald-200">PIN customised</div>
                <div className="text-[11px] text-emerald-300/80 mt-1">Only the administrator who set the PIN knows it — the server never exposes it.</div>
              </div>
            )}
            <button
              onClick={() => setShowChangePin(true)}
              className="mt-3 w-full h-9 border border-slate-600 rounded text-[13px] hover:bg-slate-800 inline-flex items-center justify-center gap-1.5"
              data-testid="fr-change-pin"
            >
              <Settings2 className="w-3.5 h-3.5" /> Change Factory PIN
            </button>
          </div>
        </div>

        {/* Trigger */}
        {stage === 'idle' && (
          <div className="bg-white border border-rose-200 rounded-xl p-5 shadow-sm" data-testid="fr-trigger-card">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-full bg-rose-600 text-white flex items-center justify-center flex-shrink-0"><Bomb className="w-6 h-6" /></div>
              <div className="flex-1">
                <div className="font-heading font-bold text-lg text-slate-900">Perform a Factory Reset</div>
                <p className="text-[13px] text-slate-600 mt-1">
                  This resets the software to a fresh-install state for a new academic year. The administrator account, school info, receipt templates and every master data list are preserved.
                  A full database backup + config snapshot are created automatically <i>before</i> deletion. If the backup fails the reset is cancelled.
                </p>
                <button
                  onClick={() => setStage('warning')}
                  className="mt-3 h-10 px-4 bg-rose-600 hover:bg-rose-700 text-white rounded font-semibold text-sm inline-flex items-center gap-1.5"
                  data-testid="fr-begin"
                >
                  <ChevronRight className="w-4 h-4" /> Begin Factory Reset
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Full-screen warning */}
        {stage === 'warning' && (
          <div className="fixed inset-0 bg-rose-950/95 z-50 flex items-center justify-center p-6" data-testid="fr-warning-overlay">
            <div className="max-w-2xl w-full bg-white border-4 border-rose-500 rounded-2xl p-8 text-center shadow-2xl">
              <AlertTriangle className="w-16 h-16 text-rose-600 mx-auto animate-pulse" />
              <div className="font-heading font-black text-3xl text-rose-800 mt-3">WARNING</div>
              <div className="text-[15px] text-slate-800 mt-4 leading-relaxed">
                This action will <b>permanently delete all school data</b>.
                <br /><b>This action cannot be undone unless a backup is available.</b>
              </div>
              <div className="mt-4 p-3 rounded bg-emerald-50 border border-emerald-200 text-[12px] text-emerald-900 text-left">
                <b className="uppercase tracking-widest text-[10px]">Safety Net</b>
                <div className="mt-1">A complete database backup <i>and</i> a configuration snapshot are created automatically <b>before</b> deletion. If either fails, the reset is cancelled and nothing is deleted.</div>
              </div>
              <label className="mt-5 flex items-start gap-2 text-left cursor-pointer">
                <input type="checkbox" checked={acknowledged} onChange={(e) => setAck(e.target.checked)} className="mt-1" data-testid="fr-acknowledge" />
                <span className="text-[13px] text-slate-800">I understand this permanently deletes all operational data (students, receipts, vouchers, audit log, non-admin users). I am the administrator and I take full responsibility for this action.</span>
              </label>
              <div className="mt-6 flex gap-3 justify-center">
                <button onClick={() => { setStage('idle'); setAck(false); }} className="h-11 px-5 border border-slate-300 rounded font-semibold text-sm" data-testid="fr-cancel-warning">Cancel</button>
                <button onClick={() => setStage('form')} disabled={!acknowledged} className="h-11 px-5 bg-rose-600 hover:bg-rose-700 disabled:opacity-40 text-white rounded font-semibold text-sm" data-testid="fr-warning-continue">Continue</button>
              </div>
            </div>
          </div>
        )}

        {/* Confirmation form */}
        {stage === 'form' && (
          <div className="bg-white border-2 border-rose-300 rounded-xl p-5 shadow-md space-y-4" data-testid="fr-form">
            <div className="flex items-center gap-2 text-rose-700 font-bold text-sm uppercase tracking-widest"><Lock className="w-4 h-4" /> Final confirmation</div>

            <div>
              <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">Administrator Password</label>
              <div className="mt-1 relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  value={password} onChange={(e) => setPassword(e.target.value)}
                  className="w-full h-10 px-3 pr-10 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-rose-500"
                  data-testid="fr-password"
                />
                <button type="button" onClick={() => setShowPw(v => !v)} className="absolute inset-y-0 right-0 w-10 flex items-center justify-center text-slate-500 hover:text-slate-800">
                  {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div>
              <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">Factory Reset PIN</label>
              <input
                type="password" inputMode="numeric"
                value={factoryPin} onChange={(e) => setPin(e.target.value.replace(/\D/g,'').slice(0,8))}
                placeholder={status.is_default_pin ? 'Default is 2580' : 'Enter your Factory PIN'}
                className="mt-1 w-full h-10 px-3 border border-slate-300 rounded text-sm font-mono focus:ring-2 focus:ring-rose-500"
                data-testid="fr-pin-input"
              />
            </div>

            <div>
              <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">Type the phrase exactly</label>
              <div className="text-[11px] text-slate-600 mb-1">Copy this: <code className="font-mono bg-slate-100 px-1 py-0.5 rounded font-bold">DELETE ALL SCHOOL DATA</code></div>
              <input
                value={phrase} onChange={(e) => setPhrase(e.target.value)}
                className={`w-full h-10 px-3 border rounded text-sm font-mono focus:ring-2 ${phrase === 'DELETE ALL SCHOOL DATA' ? 'border-emerald-500 focus:ring-emerald-500' : 'border-slate-300 focus:ring-rose-500'}`}
                data-testid="fr-phrase"
              />
            </div>

            <div className="flex items-center gap-3 pt-2 border-t border-slate-100">
              <button onClick={() => setStage('idle')} className="h-10 px-4 border border-slate-300 rounded text-sm font-semibold" data-testid="fr-form-cancel">Cancel</button>
              <button
                onClick={doReset} disabled={!canExecute || busy}
                className="h-10 px-5 bg-rose-600 hover:bg-rose-700 disabled:opacity-40 text-white rounded font-semibold text-sm inline-flex items-center gap-1.5"
                data-testid="fr-confirm"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} {busy ? 'Resetting…' : 'Confirm Factory Reset'}
              </button>
            </div>
          </div>
        )}

        {/* Progress */}
        {stage === 'doing' && (
          <div className="bg-white border border-slate-200 rounded-xl p-6 text-center" data-testid="fr-progress">
            <Loader2 className="w-8 h-8 text-rose-600 animate-spin mx-auto" />
            <div className="mt-3 font-semibold text-slate-900">Creating database backup + config snapshot → deleting operational data…</div>
            <div className="text-[12px] text-slate-500 mt-1">Do not close this tab. This typically finishes in under a minute.</div>
          </div>
        )}

        {/* Success */}
        {stage === 'done' && result && (
          <div className="bg-white border-2 border-emerald-300 rounded-xl p-5 shadow" data-testid="fr-success">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-8 h-8 text-emerald-600 flex-shrink-0" />
              <div>
                <div className="font-heading font-bold text-lg text-emerald-900">Factory Reset complete</div>
                <div className="text-[13px] text-slate-700 mt-1">
                  The database is now in fresh-install state.
                  A full backup was written to <span className="font-mono">{result.backup_file}</span> (id: <span className="font-mono">{result.backup_id}</span>) — download it from <b>Delivery Center → Latest database backup</b> and store it safely.
                </div>
                <div className="mt-3 grid sm:grid-cols-2 gap-2 text-[12px]">
                  {Object.entries(result.deleted || {}).map(([k, v]) => (
                    <div key={k} className="font-mono flex justify-between border border-slate-100 rounded px-2 py-1">
                      <span className="text-slate-600">{k}</span><span className="text-rose-700 font-bold">{v}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex gap-2">
                  <a href="/" className="h-9 px-3 bg-slate-900 text-white rounded text-sm font-semibold inline-flex items-center gap-1.5" data-testid="fr-go-home">Go to Dashboard</a>
                  <a href="/setup-wizard" className="h-9 px-3 border border-slate-300 rounded text-sm font-semibold" data-testid="fr-go-wizard">Open Setup Wizard</a>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Change PIN modal */}
        {showChangePin && (
          <div className="fixed inset-0 bg-slate-900/70 z-50 flex items-center justify-center p-6" data-testid="fr-change-pin-modal">
            <div className="max-w-md w-full bg-white rounded-xl p-5 shadow-2xl space-y-3">
              <div className="font-heading font-bold text-lg flex items-center gap-2"><KeyRound className="w-4 h-4" /> Change Factory Reset PIN</div>
              <div className="text-[11px] text-slate-500">Enter your administrator password and choose a new 4–8 digit Factory PIN.</div>
              <input type="password" placeholder="Administrator password" value={changePw} onChange={(e) => setChangePw(e.target.value)} className="w-full h-10 px-3 border border-slate-300 rounded text-sm" data-testid="fr-change-pw" />
              <input type="password" inputMode="numeric" placeholder="New PIN" value={newPin} onChange={(e) => setNewPin(e.target.value.replace(/\D/g,'').slice(0,8))} className="w-full h-10 px-3 border border-slate-300 rounded text-sm font-mono" data-testid="fr-change-new-pin" />
              <input type="password" inputMode="numeric" placeholder="Repeat new PIN" value={newPin2} onChange={(e) => setNewPin2(e.target.value.replace(/\D/g,'').slice(0,8))} className="w-full h-10 px-3 border border-slate-300 rounded text-sm font-mono" data-testid="fr-change-new-pin2" />
              <div className="flex gap-2 justify-end pt-2 border-t border-slate-100">
                <button onClick={() => setShowChangePin(false)} className="h-9 px-3 border border-slate-300 rounded text-sm">Cancel</button>
                <button onClick={changePin} className="h-9 px-3 bg-slate-900 text-white rounded text-sm font-semibold" data-testid="fr-change-save">Update PIN</button>
              </div>
            </div>
          </div>
        )}

        <div className="text-[11px] text-slate-500 flex items-center gap-1"><Info className="w-3 h-3" /> Every Factory Reset is written to the audit log (which itself is reset — the first entry of the fresh database is the reset event).</div>
      </div>
    </>
  );
}
