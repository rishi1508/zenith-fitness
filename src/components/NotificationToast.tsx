import { useState, useEffect, useCallback, useRef } from 'react';
import { Dumbbell, MessageCircle, UserPlus, UserCheck, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { BuddyNotification } from '../types';
import * as buddyService from '../buddyService';
import { useAuth } from '../auth/AuthContext';
import { Avatar } from './Avatar';
import { feedback } from '../feedback';

/**
 * Heads-up notifications.
 *
 * A buddy request or a message used to arrive as a flat grey card that faded
 * in below the app bar and left again five seconds later — easy to miss and
 * impossible to act on. This is the Android heads-up shape instead: it drops
 * in over the app bar with a small overshoot, wears the sender's face, plays
 * the `notify` cue, shows how long it will stay, and — for the two things
 * that actually need an answer — carries its own buttons.
 *
 * Swipe up or tap the cross to dismiss; tap the body to open the thing.
 */

type Kind = BuddyNotification['type'];

/** How long a card stays. Anything you can answer stays twice as long. */
const DWELL: Record<Kind, number> = {
  buddy_request: 12000,
  session_invite: 12000,
  workout_invite: 9000,
  chat_message: 6500,
  buddy_accepted: 6000,
  workout_started: 6000,
};

/** Accent per kind — the halo, the glyph chip and the drain bar share it. */
// The chip sits on top of an avatar that may be any colour, so it is solid
// rather than tinted — a translucent orange chip vanished on an orange face.
const TONE: Record<Kind, { ring: string; chip: string; bar: string }> = {
  buddy_request:   { ring: 'shadow-accent/25',      chip: 'bg-accent text-white',       bar: 'bg-accent' },
  buddy_accepted:  { ring: 'shadow-blue-500/25',    chip: 'bg-blue-500 text-white',     bar: 'bg-blue-500' },
  chat_message:    { ring: 'shadow-purple-500/25',  chip: 'bg-purple-500 text-white',   bar: 'bg-purple-500' },
  session_invite:  { ring: 'shadow-emerald-500/25', chip: 'bg-emerald-500 text-white',  bar: 'bg-emerald-500' },
  workout_invite:  { ring: 'shadow-emerald-500/25', chip: 'bg-emerald-500 text-white',  bar: 'bg-emerald-500' },
  workout_started: { ring: 'shadow-emerald-500/25', chip: 'bg-emerald-500 text-white',  bar: 'bg-emerald-500' },
};

const GLYPH: Record<Kind, LucideIcon> = {
  buddy_request: UserPlus,
  buddy_accepted: UserCheck,
  chat_message: MessageCircle,
  session_invite: Dumbbell,
  workout_invite: Dumbbell,
  workout_started: Dumbbell,
};

/** Second line under the sender's name. The stored message repeats the name
 *  for most kinds, so say the thing instead. */
function subtitle(n: BuddyNotification): string {
  switch (n.type) {
    case 'buddy_request': return 'wants to be your buddy';
    case 'buddy_accepted': return 'accepted your buddy request';
    case 'workout_started': return 'just started a workout';
    case 'session_invite': return 'invited you to a live session';
    case 'workout_invite': return n.message;
    case 'chat_message': return n.message;
  }
}

interface Toast {
  notif: BuddyNotification;
  /** Set once the card is on its way out, so the exit animation can run. */
  leaving?: boolean;
}

interface NotificationToastProps {
  onOpenSession?: (sessionId: string) => void;
  onOpenChat?: (buddyUid: string, chatId: string, buddyName: string) => void;
  onOpenBuddies?: () => void;
}

export function NotificationToast({ onOpenSession, onOpenChat, onOpenBuddies }: NotificationToastProps) {
  const { user } = useAuth();
  const [toasts, setToasts] = useState<Toast[]>([]);
  // Keep latest handlers in refs so listener effect (keyed on `user`) stays stable.
  const onOpenSessionRef = useRef(onOpenSession);
  const onOpenChatRef = useRef(onOpenChat);
  const onOpenBuddiesRef = useRef(onOpenBuddies);
  useEffect(() => { onOpenSessionRef.current = onOpenSession; }, [onOpenSession]);
  useEffect(() => { onOpenChatRef.current = onOpenChat; }, [onOpenChat]);
  useEffect(() => { onOpenBuddiesRef.current = onOpenBuddies; }, [onOpenBuddies]);

  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const map = timers.current;
    return () => { for (const t of map.values()) clearTimeout(t); map.clear(); };
  }, []);

  /** Play the exit animation, then drop the card. */
  const dismiss = useCallback((id: string) => {
    const t = timers.current.get(id);
    if (t) { clearTimeout(t); timers.current.delete(id); }
    setToasts((prev) => prev.map((x) => (x.notif.id === id ? { ...x, leaving: true } : x)));
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.notif.id !== id)), 220);
  }, []);

  const addToast = useCallback((notif: BuddyNotification) => {
    setToasts((prev) => {
      if (prev.some((t) => t.notif.id === notif.id)) return prev;
      const updated = [...prev, { notif }];
      // Three is the most that fits above the fold without burying the app.
      while (updated.length > 3) {
        const removed = updated.shift()!;
        const t = timers.current.get(removed.notif.id);
        if (t) { clearTimeout(t); timers.current.delete(removed.notif.id); }
      }
      return updated;
    });
    timers.current.set(notif.id, setTimeout(() => dismiss(notif.id), DWELL[notif.type] ?? 6000));
    feedback('notify');

    // The two kinds that need an answer stay unread until it is given, so the
    // badge keeps counting and they survive in the Alerts list.
    if (notif.type !== 'session_invite' && notif.type !== 'buddy_request') {
      buddyService.markNotificationRead(notif.id);
    }
  }, [dismiss]);

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
        localStorage.setItem(storageKey, JSON.stringify(Array.from(seen).slice(-500)));
      } catch { /* quota ignore */ }
    };

    const seenIds = loadSeen();

    const unsub = buddyService.listenToNotifications((notifications) => {
      let changed = false;
      // Oldest first, so a burst stacks in the order it happened.
      const fresh = [...notifications].reverse().filter((n) => !seenIds.has(n.id));
      for (const notif of fresh) { seenIds.add(notif.id); changed = true; }
      if (changed) saveSeen(seenIds);
      if (fresh.length === 0) return;
      // A request stays unread until it is answered IN the card — so one that
      // was answered on another device, or from the Buddies screen, would
      // resurface here on every new sign-in. Check it is still pending first.
      const requests = fresh.filter((n) => n.type === 'buddy_request');
      const others = fresh.filter((n) => n.type !== 'buddy_request');
      for (const notif of others) addToast(notif);
      if (requests.length === 0) return;
      void buddyService.getIncomingRequests().then((pending) => {
        const open = new Set(pending.map((r) => r.fromUid));
        for (const notif of requests) {
          if (open.has(notif.fromUid)) addToast(notif);
          else void buddyService.markNotificationRead(notif.id);
        }
      }).catch(() => { for (const notif of requests) addToast(notif); });
    }, user.uid);

    return unsub;
  }, [user, addToast]);

  const openTarget = (notif: BuddyNotification) => {
    if (notif.type === 'session_invite' && notif.data?.sessionId && onOpenSessionRef.current) {
      buddyService.markNotificationRead(notif.id);
      onOpenSessionRef.current(notif.data.sessionId);
    } else if (notif.type === 'chat_message' && notif.data?.chatId && onOpenChatRef.current) {
      buddyService.markNotificationRead(notif.id);
      onOpenChatRef.current(notif.fromUid, notif.data.chatId, notif.fromName);
    } else if ((notif.type === 'buddy_request' || notif.type === 'buddy_accepted') && onOpenBuddiesRef.current) {
      onOpenBuddiesRef.current();
    } else {
      return;
    }
    dismiss(notif.id);
  };

  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed left-3 right-3 z-[70] flex flex-col gap-2 pointer-events-none"
      style={{ top: 'calc(env(safe-area-inset-top, 0px) + 10px)' }}
    >
      {/* Newest on top — it is the one being announced. */}
      {[...toasts].reverse().map(({ notif, leaving }) => (
        <NotificationCard
          key={notif.id}
          notif={notif}
          leaving={!!leaving}
          onDismiss={() => dismiss(notif.id)}
          onOpen={() => openTarget(notif)}
        />
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ card

function NotificationCard({ notif, leaving, onDismiss, onOpen }: {
  notif: BuddyNotification;
  leaving: boolean;
  onDismiss: () => void;
  onOpen: () => void;
}) {
  const tone = TONE[notif.type] ?? TONE.buddy_accepted;
  const Glyph = GLYPH[notif.type] ?? MessageCircle;
  const dwell = DWELL[notif.type] ?? 6000;
  const actionable = notif.type === 'buddy_request';
  const tappable = notif.type === 'chat_message'
    || notif.type === 'session_invite'
    || notif.type === 'buddy_request'
    || notif.type === 'buddy_accepted';

  const [answer, setAnswer] = useState<null | 'accepting' | 'accepted' | 'declined'>(null);
  const [dragY, setDragY] = useState(0);
  const startY = useRef<number | null>(null);

  // Swipe up to send it away — the gesture people already use on a phone.
  const onPointerDown = (e: React.PointerEvent) => { startY.current = e.clientY; };
  const onPointerMove = (e: React.PointerEvent) => {
    if (startY.current === null) return;
    setDragY(Math.min(0, e.clientY - startY.current));
  };
  const endDrag = () => {
    if (dragY < -40) onDismiss();
    startY.current = null;
    setDragY(0);
  };

  const answerRequest = async (accept: boolean) => {
    setAnswer(accept ? 'accepting' : 'declined');
    try {
      const requestId = notif.data?.requestId
        ?? (await buddyService.getIncomingRequests()).find((r) => r.fromUid === notif.fromUid)?.id;
      if (requestId) {
        if (accept) await buddyService.acceptBuddyRequest(requestId);
        else await buddyService.declineBuddyRequest(requestId);
      }
      await buddyService.markNotificationRead(notif.id);
      if (accept) feedback('prCelebration');
      setAnswer(accept ? 'accepted' : 'declined');
      setTimeout(onDismiss, accept ? 1100 : 350);
    } catch {
      // Leave the card up: the Buddies screen is still a way through.
      setAnswer(null);
    }
  };

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      className={`pointer-events-auto relative overflow-hidden rounded-card border border-border bg-surface shadow-2xl ${tone.ring}`}
      style={{
        animation: leaving
          ? 'notif-out 220ms cubic-bezier(0.4, 0, 1, 1) forwards'
          : 'notif-in 460ms cubic-bezier(0.22, 1.15, 0.36, 1)',
        transform: dragY ? `translate3d(0, ${dragY}px, 0)` : undefined,
        touchAction: 'pan-x',
      }}
    >
      {/* Halo along the top edge, breathing while an answer is outstanding. */}
      <span
        aria-hidden
        className={`absolute inset-x-0 top-0 h-[3px] ${tone.bar}`}
        style={actionable && !answer ? { animation: 'notif-halo 1.9s ease-in-out infinite' } : { opacity: 0.7 }}
      />

      <button
        type="button"
        onClick={tappable && !answer ? onOpen : undefined}
        disabled={!tappable || !!answer}
        className={`w-full flex items-start gap-3 px-3.5 pt-3.5 pb-3 text-left ${tappable && !answer ? 'active:brightness-110' : ''}`}
      >
        <span className="relative shrink-0">
          <Avatar name={notif.fromName || '?'} photoURL={notif.data?.fromPhoto ?? null} size="md" />
          <span className={`absolute -bottom-1 -right-1 w-[18px] h-[18px] rounded-full flex items-center justify-center ring-2 ring-surface ${tone.chip}`}>
            <Glyph className="w-[11px] h-[11px]" strokeWidth={2.4} />
          </span>
        </span>

        <span className="flex-1 min-w-0">
          <span className="block text-[15px] font-semibold text-text truncate">{notif.fromName || 'Zenith'}</span>
          <span className="block text-[13px] text-muted truncate mt-0.5">
            {answer === 'accepted' ? 'You are buddies now' : answer === 'declined' ? 'Dismissed' : subtitle(notif)}
          </span>
        </span>

        <span
          role="button"
          tabIndex={0}
          aria-label="Dismiss"
          onClick={(e) => { e.stopPropagation(); onDismiss(); }}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); onDismiss(); } }}
          className="shrink-0 -mr-1 -mt-1 p-1.5 text-subtle hover:text-muted"
        >
          <X className="w-4 h-4" />
        </span>
      </button>

      {/* Answer it here. Walking to the Buddies screen to tap Accept was the
          reason requests sat unanswered. */}
      {actionable && answer !== 'accepted' && answer !== 'declined' && (
        <div className="flex gap-2 px-3.5 pb-3">
          <button
            type="button"
            onClick={() => answerRequest(true)}
            disabled={answer === 'accepting'}
            className="flex-1 h-9 rounded-control bg-accent text-white text-[13px] font-bold disabled:opacity-60"
          >
            {answer === 'accepting' ? 'Adding…' : 'Accept'}
          </button>
          <button
            type="button"
            onClick={() => answerRequest(false)}
            disabled={answer === 'accepting'}
            className="px-4 h-9 rounded-control border border-border text-muted text-[13px] font-bold disabled:opacity-60"
          >
            Not now
          </button>
        </div>
      )}

      {/* How long it will stay, drawn. */}
      {!leaving && !answer && (
        <span
          aria-hidden
          className={`absolute inset-x-0 bottom-0 h-[2px] origin-left ${tone.bar} opacity-50`}
          style={{ animation: `notif-drain ${dwell}ms linear forwards` }}
        />
      )}
    </div>
  );
}
