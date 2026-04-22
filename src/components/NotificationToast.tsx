import { useState, useEffect, useCallback, useRef } from 'react';
import { Dumbbell, MessageCircle, UserPlus, UserCheck, X } from 'lucide-react';
import type { BuddyNotification } from '../types';
import * as buddyService from '../buddyService';
import { useAuth } from '../auth/AuthContext';

interface Toast {
  id: string;
  message: string;
  type: BuddyNotification['type'];
  fromUid: string;
  fromName: string;
  data?: Record<string, string>;
  timeout: ReturnType<typeof setTimeout>;
}

interface NotificationToastProps {
  onOpenSession?: (sessionId: string) => void;
  onOpenChat?: (buddyUid: string, chatId: string, buddyName: string) => void;
}

export function NotificationToast({ onOpenSession, onOpenChat }: NotificationToastProps) {
  const { user } = useAuth();
  const [toasts, setToasts] = useState<Toast[]>([]);
  // Keep latest handlers in refs so listener effect (keyed on `user`) stays stable.
  const onOpenSessionRef = useRef(onOpenSession);
  const onOpenChatRef = useRef(onOpenChat);
  useEffect(() => { onOpenSessionRef.current = onOpenSession; }, [onOpenSession]);
  useEffect(() => { onOpenChatRef.current = onOpenChat; }, [onOpenChat]);

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
        fromUid: notif.fromUid,
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

  // Listen for real-time notifications.
  // seenIds is persisted in localStorage (scoped to user) so reopening the app
  // doesn't re-toast old ones — but genuinely new notifications received while
  // offline DO toast on next launch.
  useEffect(() => {
    if (!user) return;

    const storageKey = `zenith_seen_notifications_${user.uid}`;
    const loadSeen = (): Set<string> => {
      try {
        const raw = localStorage.getItem(storageKey);
        return raw ? new Set<string>(JSON.parse(raw)) : new Set<string>();
      } catch {
        return new Set<string>();
      }
    };
    const saveSeen = (seen: Set<string>) => {
      try {
        // Cap at 500 most-recent IDs to avoid unbounded growth
        const arr = Array.from(seen);
        const capped = arr.slice(-500);
        localStorage.setItem(storageKey, JSON.stringify(capped));
      } catch { /* quota ignore */ }
    };

    const seenIds = loadSeen();

    console.info('[Notif][Toast] effect starting for uid', user.uid);
    const unsub = buddyService.listenToNotifications((notifications) => {
      let newCount = 0;
      let changed = false;
      for (const notif of notifications) {
        if (!seenIds.has(notif.id)) {
          seenIds.add(notif.id);
          changed = true;
          newCount++;
          addToast(notif);
        }
      }
      if (changed) saveSeen(seenIds);
      console.info('[Notif][Toast] callback — unread:', notifications.length, 'new-this-render:', newCount);
    }, user.uid);

    return unsub;
  }, [user, addToast]);

  const handleToastClick = (toast: Toast) => {
    if (toast.type === 'session_invite' && toast.data?.sessionId && onOpenSessionRef.current) {
      buddyService.markNotificationRead(toast.id);
      onOpenSessionRef.current(toast.data.sessionId);
      removeToast(toast.id);
    } else if (toast.type === 'chat_message' && toast.data?.chatId && onOpenChatRef.current) {
      buddyService.markNotificationRead(toast.id);
      onOpenChatRef.current(toast.fromUid, toast.data.chatId, toast.fromName);
      removeToast(toast.id);
    }
  };

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-16 left-4 right-4 z-50 space-y-2 pointer-events-none">
      {toasts.map((toast) => {
        const isClickable =
          (toast.type === 'session_invite' && !!toast.data?.sessionId) ||
          (toast.type === 'chat_message' && !!toast.data?.chatId);
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
                  : toast.type === 'chat_message'
                    ? 'bg-purple-500/20 text-purple-400'
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
                <p className="text-[11px] text-orange-400 mt-0.5">
                  {toast.type === 'chat_message' ? 'Tap to reply' : 'Tap to join session'}
                </p>
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
