import React from 'react';
import { useLocation } from 'react-router-dom';
import { WifiOff, ServerOff } from 'lucide-react';
import useSyncStatus from '@/lib/useSyncStatus';
import { isDesktop } from '@/lib/runtime';
import { isServerOnlyRoute, syncedAgoLabel } from '@/lib/syncPolicy';

/** Amber strip shown while the desktop client runs without the Main Server. */
export function OfflineBanner({ state }) {
  return (
    <div data-testid="offline-banner" className="bg-amber-50 border-b border-amber-200 px-6 py-2 text-[12px] text-amber-900 flex items-center gap-2 no-print">
      <WifiOff className="w-4 h-4 shrink-0" />
      <span>
        <strong>Local mode.</strong> The Main Server is unavailable. Showing data as of last sync
        ({syncedAgoLabel(state.lastSyncAt)}). New receipts, expenses and bills are saved on this PC and sent when the server returns.
      </span>
    </div>
  );
}

/** Placeholder for a screen that needs the Main Server (approved server-only list). */
export function ServerOnlyNotice() {
  return (
    <div data-testid="server-only-notice" className="min-h-[60vh] flex items-center justify-center p-8">
      <div className="max-w-md text-center space-y-3">
        <ServerOff className="w-10 h-10 mx-auto text-slate-400" />
        <div className="font-heading text-lg font-semibold text-slate-800">This screen needs the Main Server</div>
        <p className="text-sm text-slate-600">
          It changes records that are kept only on the Main Server, so it is not available while the server is unreachable.
          It opens again automatically when the connection returns.
        </p>
      </div>
    </div>
  );
}

/**
 * Wraps the page area of the Layout. Shows the offline banner and, when
 * offline, replaces server-only screens with the notice. Web deployments are
 * never affected (isDesktop() is false there).
 */
export default function OfflineGate({ children }) {
  const state = useSyncStatus();
  const location = useLocation();
  if (!isDesktop()) return children;
  const offline = state.status === 'offline';
  const routeKey = (location.pathname || '').replace(/^\/+/, '').split('/')[0];
  return (
    <>
      {offline && <OfflineBanner state={state} />}
      {offline && isServerOnlyRoute(routeKey) ? <ServerOnlyNotice /> : children}
    </>
  );
}
