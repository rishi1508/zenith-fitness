import { useState, useEffect, useCallback } from 'react';
import { Dumbbell, MessageCircle, UserPlus, UserCheck, X } from 'lucide-react';
import type { BuddyNotification } from '../types';
import * as buddyService from '../buddyService';
import { useAuth } from '../auth/AuthContext';

interface Toast {
  id: string;
  message: string;
  type: BuddyNotification['type'];
  fromName: string;
  timeout: ReturnType<typeof setTimeout>;
}

export function NotificationToast() {
  const { user } = useAuth();
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => {
      const t = prev.find((x) => x.id === id);
      if (t) clearTimeout(t.timeout);
      return prev.filter((x) => x.id !== id);
    });
  }, []);

  const addToast = useCallback((notif: BuddyNotification) => {
    // Don't show duplicates
    setToasts((prev) => {
      if (prev.some((t) => t.id === notif.id)) return prev;

      const timeout = setTimeout(() => removeToast(notif.id), 5000);
      const newToast: Toast = {
        id: notif.id,
        message: notif.message,
        type: notif.type,
        fromName: notif.fromName,
        timeout,
      };
      // Max 3 toasts visible
      const updated = [...prev, newToast];
      if (updated.length > 3) {
        const removed = updated.shift()!;
        clearTimeout(removed.timeout);
      }
      return updated;
    });

    // Auto-mark as read after showing
    buddyService.markNotificationRead(notif.id);
  }, [removeToast]);

  // Listen for real-time notifications
  useEffect(() => {
    if (!user) return;

    const seenIds = new Set<string>();
    const unsub = buddyService.listenToNotifications((notifications) => {
      for (const notif of notifications) {
        if (!seenIds.has(notif.id)) {
          seenIds.add(notif.id);
          addToast(notif);
        }
      }
    });

    return unsub;
  }, [user, addToast]);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-16 left-4 right-4 z-50 space-y-2 pointer-events-none">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="pointer-events-auto animate-fadeIn bg-[#1a1a1a] border border-[#2e2e2e] rounded-xl p-3 shadow-lg shadow-black/30 flex items-center gap-3"
        >
          <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${
            toast.type === 'workout_started' || toast.type === 'workout_invite'
              ? 'bg-emerald-500/20 text-emerald-400'
              : toast.type === 'buddy_accepted'
                ? 'bg-blue-500/20 text-blue-400'
                : 'bg-orange-500/20 text-orange-400'
          }`}>
            {toast.type === 'workout_started' || toast.type === 'workout_invite' ? (
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
          </div>
          <button
            onClick={() => removeToast(toast.id)}
            className="p-1 text-zinc-500 hover:text-zinc-300 flex-shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
