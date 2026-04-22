import { useState } from 'react';
import { WifiOff, RefreshCw, Loader2 } from 'lucide-react';
import type { ConnectionState } from '../hooks/useOnlineStatus';

interface OfflineBannerProps {
  state: ConnectionState;
  onRetry: () => Promise<ConnectionState>;
}

/**
 * Thin banner shown at the top of the app when we're offline or can't
 * reach Firestore. Clicking Retry re-probes; while probing we swap the
 * icon to a spinner so the user gets feedback.
 */
export function OfflineBanner({ state, onRetry }: OfflineBannerProps) {
  const [retrying, setRetrying] = useState(false);

  if (state !== 'offline-browser' && state !== 'offline-firestore') return null;

  const handleRetry = async () => {
    setRetrying(true);
    try { await onRetry(); }
    finally { setRetrying(false); }
  };

  const label = state === 'offline-browser'
    ? 'You\'re offline'
    : 'Can\'t reach the server';

  return (
    <div className="flex-none bg-amber-500/15 border-b border-amber-500/30 text-amber-400 text-xs flex items-center justify-between px-4 py-2">
      <div className="flex items-center gap-2 min-w-0">
        <WifiOff className="w-3.5 h-3.5 flex-shrink-0" />
        <span className="truncate font-medium">{label}</span>
        <span className="truncate text-amber-500/70 hidden sm:inline">
          · Some features need a connection
        </span>
      </div>
      <button
        onClick={handleRetry}
        disabled={retrying}
        className="flex items-center gap-1 px-2 py-0.5 rounded-md hover:bg-amber-500/20 transition-colors disabled:opacity-50 flex-shrink-0"
      >
        {retrying ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
        Retry
      </button>
    </div>
  );
}
