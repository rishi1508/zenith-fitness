import { useState } from 'react';
import { WifiOff, Loader2 } from 'lucide-react';
import type { ConnectionState } from '../hooks/useOnlineStatus';

function RetryButton({ onRetry }: { onRetry: () => Promise<ConnectionState> }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      onClick={async () => {
        setBusy(true);
        try { await onRetry(); }
        finally { setBusy(false); }
      }}
      disabled={busy}
      className="w-full py-2.5 rounded-lg text-sm font-medium bg-gradient-to-r from-orange-500 to-red-600 text-white hover:opacity-90 disabled:opacity-60 flex items-center justify-center gap-2 transition-opacity"
    >
      {busy && <Loader2 className="w-4 h-4 animate-spin" />}
      Try again
    </button>
  );
}

interface OfflineGateProps {
  state: ConnectionState;
  onProceedOffline: () => void;
  onRetry: () => Promise<ConnectionState>;
}

/**
 * First-launch overlay: if we detect no connection on app start the user
 * sees this, with a Retry + Proceed offline choice. Once dismissed we
 * don't block again — the slim OfflineBanner stays visible so they can
 * reconnect later.
 */
export function OfflineGate({ state, onProceedOffline, onRetry }: OfflineGateProps) {
  const isOffline = state === 'offline-browser' || state === 'offline-firestore';
  if (!isOffline) return null;

  const label = state === 'offline-browser'
    ? "We couldn't detect an internet connection."
    : "We can't reach the Zenith server right now.";

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-sm p-6">
      <div className="w-full max-w-sm bg-[#1a1a1a] border border-[#2e2e2e] rounded-2xl p-6 text-center">
        <div className="w-12 h-12 rounded-full bg-amber-500/15 text-amber-400 flex items-center justify-center mx-auto mb-3">
          <WifiOff className="w-6 h-6" />
        </div>
        <h2 className="text-lg font-bold mb-1">You look offline</h2>
        <p className="text-sm text-zinc-400 mb-5">
          {label} Buddy features, chat, and live sessions need a
          connection — other features will still work.
        </p>
        <div className="space-y-2">
          <RetryButton onRetry={onRetry} />
          {/* Loader2 is imported for the in-button spinner. */}
          {false && <Loader2 className="hidden" />}
          <button
            onClick={onProceedOffline}
            className="w-full py-2.5 rounded-lg text-sm font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors"
          >
            Proceed offline
          </button>
        </div>
      </div>
    </div>
  );
}
