import { useEffect, useState, useCallback } from 'react';
import { CheckCircle2, AlertCircle } from 'lucide-react';

export interface MemberToastState {
  message: string;
  kind: 'success' | 'error';
}

/**
 * Tiny toast for the member-facing gym screens — replaces `alert()` for
 * success/error feedback (join, check-in, enrol/leave, post
 * announcement, …). `showToast` sets the message; it auto-dismisses
 * after a few seconds.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useMemberToast() {
  const [toast, setToast] = useState<MemberToastState | null>(null);

  const showToast = useCallback((message: string, kind: MemberToastState['kind'] = 'success') => {
    setToast({ message, kind });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(timer);
  }, [toast]);

  return { toast, showToast };
}

export function MemberToast({ toast }: { toast: MemberToastState | null }) {
  if (!toast) return null;
  const isError = toast.kind === 'error';
  return (
    <div className="fixed top-4 left-4 right-4 z-50 flex justify-center pointer-events-none animate-fadeIn">
      <div
        className={`flex items-center gap-2 px-4 py-2.5 rounded-xl shadow-lg text-sm font-medium text-white max-w-sm ${
          isError ? 'bg-red-600' : 'bg-gradient-to-r from-orange-500 to-red-600'
        }`}
      >
        {isError ? <AlertCircle className="w-4 h-4 shrink-0" /> : <CheckCircle2 className="w-4 h-4 shrink-0" />}
        <span>{toast.message}</span>
      </div>
    </div>
  );
}
