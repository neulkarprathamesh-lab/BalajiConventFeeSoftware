import React, { useEffect, useState } from 'react';
import { subscribe, syncNow, startAutoSync, getState } from '@/lib/syncEngine';
import { RefreshCw, Wifi, WifiOff, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';

const CONFIG = {
  online:     { label: 'Up to date',   icon: CheckCircle2, cls: 'text-emerald-400' },
  offline:    { label: 'Offline',      icon: WifiOff,       cls: 'text-red-400' },
  connecting: { label: 'Connecting…',  icon: Loader2,       cls: 'text-amber-400 animate-spin' },
  syncing:    { label: 'Syncing…',     icon: RefreshCw,     cls: 'text-blue-400 animate-spin' },
  error:      { label: 'Sync problem', icon: AlertTriangle, cls: 'text-amber-400' },
};

function timeAgo(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Always-visible connection/sync widget - same component for every role, so
 * "Client has a Sync button" and "Admin has a Sync button" are the same
 * requirement satisfied once. Automatic sync runs in the background on a
 * fixed interval (see syncEngine.startAutoSync); this only adds the manual
 * trigger + visible status the cashier/admin actually watches.
 */
export default function SyncStatus() {
  const [state, setState] = useState(getState());

  useEffect(() => {
    const unsub = subscribe(setState);
    const stop = startAutoSync(20000);
    return () => { unsub(); stop && stop(); };
  }, []);

  const cfg = CONFIG[state.status] || CONFIG.offline;
  const Icon = cfg.icon;
  const busy = state.status === 'syncing' || state.status === 'connecting';

  return (
    <button
      data-testid="sync-status-btn"
      onClick={() => !busy && syncNow()}
      title={state.lastError || (state.lastSyncAt ? `Last sync: ${timeAgo(state.lastSyncAt)}` : 'Never synced yet')}
      className="w-full flex items-center gap-2 px-2 py-1.5 text-[13px] text-slate-300 hover:text-white hover:bg-slate-800 rounded mb-0.5 disabled:opacity-60"
      disabled={busy}
    >
      <Icon className={`w-4 h-4 ${cfg.cls}`} />
      <span className="flex-1 text-left">
        <span className="block leading-tight">SYNC</span>
        <span className="block text-[10px] text-slate-500 leading-tight">
          {state.pendingCount > 0 ? `${state.pendingCount} change${state.pendingCount === 1 ? '' : 's'} waiting` : cfg.label}
        </span>
      </span>
      {state.lastSyncAt && state.pendingCount === 0 && state.status === 'online' && (
        <span className="text-[10px] text-slate-500">{timeAgo(state.lastSyncAt)}</span>
      )}
    </button>
  );
}
