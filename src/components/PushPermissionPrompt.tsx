import { useEffect, useState } from 'react';
import { Bell, X } from 'lucide-react';
import { enablePushNotifications, pushSupported, pushPermissionState } from '../pushService';

interface Props {
  userUid: string | null;
  isDark: boolean;
}

/**
 * Soft, one-time prompt asking the user to enable push notifications.
 * Shows a few seconds after first login if the device supports push AND
 * the user hasn't granted / denied before AND they haven't dismissed the
 * prompt previously (stored per-uid in localStorage).
 *
 * The prompt is informational — the browser / OS permission dialog still
 * appears when the user taps "Enable", which is required on every
 * platform.
 */
export function PushPermissionPrompt({ userUid, isDark }: Props) {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!userUid) return;
    let cancelled = false;
    (async () => {
      if (!(await pushSupported())) return;
      const state = await pushPermissionState();
      if (state !== 'prompt') return; // granted or denied — don't nag
      const dismissed = localStorage.getItem(`zenith_push_prompt_dismissed_${userUid}`);
      if (dismissed) return;
      // Delay so we don't crowd the login screen / splash.
      await new Promise((r) => setTimeout(r, 1500));
      if (!cancelled) setShow(true);
    })();
    return () => { cancelled = true; };
  }, [userUid]);

  if (!show || !userUid) return null;

  const dismiss = () => {
    try { localStorage.setItem(`zenith_push_prompt_dismissed_${userUid}`, '1'); } catch { /* ignore */ }
    setShow(false);
  };

  const enable = async () => {
    setBusy(true);
    try {
      await enablePushNotifications();
    } finally {
      dismiss();
      setBusy(false);
    }
  };

  return (
    <div
      className={`fixed bottom-24 left-4 right-4 z-50 rounded-2xl border shadow-lg animate-fadeIn ${
        isDark ? 'bg-[#1a1a1a] border-[#2e2e2e]' : 'bg-white border-gray-200'
      }`}
    >
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center flex-shrink-0">
            <Bell className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm">Stay in sync with your buddies</div>
            <p className={`text-xs mt-1 ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>
              Get a notification when a buddy messages you, sends a workout
              invite, or starts a session together. You can always change
              this later in Settings.
            </p>
          </div>
          <button
            onClick={dismiss}
            className={`p-1 rounded-md flex-shrink-0 ${isDark ? 'text-zinc-500 hover:bg-[#252525]' : 'text-gray-400 hover:bg-gray-100'}`}
            aria-label="Not now"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex gap-2 mt-3">
          <button
            onClick={dismiss}
            className={`flex-1 py-2 rounded-lg text-xs font-medium transition-colors ${
              isDark ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
            }`}
          >
            Not now
          </button>
          <button
            onClick={enable}
            disabled={busy}
            className="flex-1 py-2 rounded-lg text-xs font-medium bg-gradient-to-r from-orange-500 to-red-600 text-white hover:opacity-90 disabled:opacity-60 transition-opacity"
          >
            {busy ? 'Enabling…' : 'Enable notifications'}
          </button>
        </div>
      </div>
    </div>
  );
}
