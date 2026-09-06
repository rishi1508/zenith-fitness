import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { CircleAlert, CircleCheck, Info } from 'lucide-react';
import { TAB_BAR_HEIGHT } from './TabBar';

export type ToastTone = 'success' | 'error' | 'info';

interface ToastItem { id: number; message: string; tone: ToastTone }

interface ToastContextValue {
  /** Show a short self-dismissing message (2.6s). */
  showToast: (message: string, tone?: ToastTone) => void;
}

const ToastCtx = createContext<ToastContextValue | null>(null);

const DURATION_MS = 2600;
const MAX_VISIBLE = 3;

const ICON: Record<ToastTone, ReactNode> = {
  success: <CircleCheck className="w-4 h-4 text-ok shrink-0" />,
  error: <CircleAlert className="w-4 h-4 text-danger shrink-0" />,
  info: <Info className="w-4 h-4 text-info shrink-0" />,
};

// eslint-disable-next-line react-refresh/only-export-components
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

/**
 * App-wide toast host. Replaces the gym MemberToast/StaffToast pair:
 * any screen calls `useToast().showToast(message, tone)` and the stack
 * renders just above the tab bar.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback((message: string, tone: ToastTone = 'success') => {
    const id = ++nextId.current;
    setItems((prev) => [...prev, { id, message, tone }].slice(-MAX_VISIBLE));
    setTimeout(() => dismiss(id), DURATION_MS);
  }, [dismiss]);

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastCtx.Provider value={value}>
      {children}
      {items.length > 0 && (
        <div
          className="fixed left-4 right-4 z-[110] flex flex-col items-center gap-2 pointer-events-none"
          style={{ bottom: `calc(${TAB_BAR_HEIGHT + 12}px + env(safe-area-inset-bottom, 0px))` }}
          role="status"
          aria-live="polite"
        >
          {items.map((t) => (
            <button
              key={t.id}
              onClick={() => dismiss(t.id)}
              className="pointer-events-auto w-full max-w-sm flex items-center gap-2 rounded-control border border-border bg-surface px-4 py-3 text-left text-sm font-medium text-text shadow-lg shadow-black/30 animate-fadeIn"
            >
              {ICON[t.tone]}
              <span className="truncate">{t.message}</span>
            </button>
          ))}
        </div>
      )}
    </ToastCtx.Provider>
  );
}
