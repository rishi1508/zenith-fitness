import { useEffect } from 'react';
import { CircleCheck, CircleAlert } from 'lucide-react';

interface StaffToastProps {
  /** null/empty renders nothing. Owning screen holds this in state. */
  message: string | null;
  isDark: boolean;
  onDismiss: () => void;
  tone?: 'success' | 'error';
}

/**
 * Small self-dismissing toast for staff screens — replaces alert() for
 * normal flows per docs/GYM_TIER_A_SPEC.md §6.3. Controlled: the parent
 * holds the message in state and clears it via onDismiss.
 */
export function StaffToast({ message, isDark, onDismiss, tone = 'success' }: StaffToastProps) {
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(onDismiss, 2500);
    return () => clearTimeout(t);
  }, [message, onDismiss]);

  if (!message) return null;

  return (
    <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[60] animate-fadeIn px-2 w-full max-w-sm">
      <div
        className={`flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-medium shadow-lg ${
          isDark ? 'bg-[#1f1f1f] border-[#2e2e2e] text-white' : 'bg-white border-gray-200 text-gray-900'
        }`}
      >
        {tone === 'success'
          ? <CircleCheck className="w-4 h-4 text-emerald-500 shrink-0" />
          : <CircleAlert className="w-4 h-4 text-red-500 shrink-0" />}
        <span className="truncate">{message}</span>
      </div>
    </div>
  );
}
