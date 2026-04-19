import { useState, useEffect, useCallback, useRef } from 'react';
import { Dumbbell, MessageCircle, UserPlus, UserCheck, X } from 'lucide-react';
import type { BuddyNotification } from '../types';
import * as buddyService from '../buddyService';
import { useAuth } from '../auth/AuthContext';

interface Toast {
  id: string;
  message: string;
  type: BuddyNotification['type'];
  fromName: string;
  data?: Record<string, string>;
  timeout: ReturnType<typeof setTimeout>;
}

interface NotificationToastProps {
  onOpenSession?: (sessionId: string) => void;
}

export function NotificationToast({ onOpenSession }: NotificationToastProps) {
  const { user } = useAuth();
  const [toasts, setToasts] = useState<Toast[]>([]);
  // Keep latest handler in a ref so listener effect (keyed on `user`) stays stable.
  const onOpenSessionRef = useRef(onOpenSession);
  useEffect(() => { onOpenSessionRef.current = onOpenSession; }, [onOpenSession]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => {
      const t = prev.find((x) => x.id === id);
      if (t) clearTimeout(t.timeout);
      return prev.filter((x) => x.id !== id);
    });
  }, []);

  const addToast = useCallback((notif: BuddyNotification) => {
    setToasts((prev) => {
      if (prev.some((t) => t.id === notif.id)) return prev;

      const timeout = setTimeout(() => removeToast(notif.id), 5000);
      const newToast: Toast = {
        id: notif.id,
        message: notif.message,
        type: notif.type,
        fromName: notif.fromName,
        data: notif.data,
        timeout,
      };
      const updated = [...prev, newToast];
      if (updated.length > 3) {
        const removed = updated.shift()!;
        clearTimeout(removed.timeout);
      }
      return updated;
    });

    // For session invites, keep it unread so the user can still find it in the Alerts tab.
    // For other types, auto-mark read after showing.
    if (notif.type !== 'session_invite') {
      buddyService.markNotificationRead(notif.id);
    }
  }, [removeToast]);

  // Listen for real-time notifications
  useEffect(() => {
    if (!user) return;

    const seenIds = new Set<string>();
    let isFirstSnapshot = true;

    const unsub = buddyService.listenToNotifications((notifications) => {
      if (isFirstSnapshot) {
        // Seed seenIds from whatever was already unread at mount time.
        // Users shouldn't get flooded with toasts for notifications they've already been offline for.
        for (const notif of notifications) seenIds.add(notif.id);
        isFirstSnapshot = false;
        return;
      }
      for (const notif of notifications) {
        if (!seenIds.has(notif.id)) {
          seenIds.add(notif.id);
          addToast(notif);
        }
      }
    });

    return unsub;
  }, [user, addToast]);

  const handleToastClick = (toast: Toast) => {
    if (toast.type === 'session_invite' && toast.data?.sessionId && onOpenSessionRef.current) {
      buddyService.markNotificationRead(toast.id);
      onOpenSessionRef.current(toast.data.sessionId);
      removeToast(toast.id);
    }
  };

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-16 left-4 right-4 z-50 space-y-2 pointer-events-none">
      {toasts.map((toast) => {
        const isClickable = toast.type === 'session_invite' && !!toast.data?.sessionId;
        return (
          <div
            key={toast.id}
            onClick={isClickable ? () => handleToastClick(toast) : undefined}
            className={`pointer-events-auto animate-fadeIn bg-[#1a1a1a] border border-[#2e2e2e] rounded-xl p-3 shadow-lg shadow-black/30 flex items-center gap-3 ${
              isClickable ? 'cursor-pointer hover:border-orange-500/50 transition-colors' : ''
            }`}
          >
            <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${
              toast.type === 'workout_started' || toast.type === 'workout_invite' || toast.type === 'session_invite'
                ? 'bg-emerald-500/20 text-emerald-400'
                : toast.type === 'buddy_accepted'
                  ? 'bg-blue-500/20 text-blue-400'
                  : 'bg-orange-500/20 text-orange-400'
            }`}>
              {toast.type === 'workout_started' || toast.type === 'workout_invite' || toast.type === 'session_invite' ? (
                <Dumbbell className="w-4 h-4" />
              ) : toast.type === 'buddy_accepted' ? (
                <UserCheck className="w-4 h-4" />
              ) : toast.type === 'buddy_request' ? (
                <UserPlus className="w-4 h-4" />
              ) : (
                <MessageCircle className="w-4 h-4" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-white truncate">{toast.message}</p>
              {isClickable && (
                <p className="text-[11px] text-orange-400 mt-0.5">Tap to join session</p>
              )}
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); removeToast(toast.id); }}
              className="p-1 text-zinc-500 hover:text-zinc-300 flex-shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
