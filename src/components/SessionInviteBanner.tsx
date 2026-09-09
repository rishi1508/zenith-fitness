import { useEffect, useState } from 'react';
import { Users, X } from 'lucide-react';
import type { BuddyNotification, WorkoutSession } from '../types';
import * as buddyService from '../buddyService';
import * as sessionService from '../workoutSessionService';
import { useAuth } from '../auth/AuthContext';

/**
 * A pending "train together" invite, kept in front of the user until they do
 * something about it.
 *
 * The only way in used to be catching a five-second toast (or a push
 * notification). Miss it and the invite was unreachable — the host waited in
 * a lobby for someone who never knew. This reads the same notification the
 * toast reads, checks the session is still waiting, and stays put.
 */
export function SessionInviteBanner({ onOpen }: { onOpen: (sessionId: string) => void }) {
  const { user } = useAuth();
  const [invite, setInvite] = useState<{ sessionId: string; from: string; session: WorkoutSession } | null>(null);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    return buddyService.listenToNotifications((all: BuddyNotification[]) => {
      void (async () => {
        const latest = all.find((n) => n.type === 'session_invite' && !n.read && n.data?.sessionId);
        if (!latest?.data?.sessionId) { setInvite(null); return; }
        const sessionId = latest.data.sessionId;
        // Only worth showing while it can still be joined and we really are
        // the one invited — a stale notification should not nag.
        const session = await sessionService.getSession(sessionId).catch(() => null);
        const mine = session?.participants?.[user.uid];
        if (!session || session.status === 'completed' || session.status === 'cancelled' || !mine || mine.status === 'declined') {
          setInvite(null);
          return;
        }
        setInvite({ sessionId, from: latest.fromName || 'A buddy', session });
      })();
    }, user.uid);
  }, [user]);

  if (!invite || dismissed.includes(invite.sessionId)) return null;

  const decline = async () => {
    setBusy(true);
    try {
      await sessionService.declineSession(invite.sessionId);
    } finally {
      setDismissed((d) => [...d, invite.sessionId]);
      setBusy(false);
    }
  };

  return (
    <div className="px-5 pt-2">
      <div className="rounded-card border border-accent/40 bg-accent-soft px-3 py-2.5 flex items-center gap-2.5">
        <Users className="w-[18px] h-[18px] text-accent shrink-0" strokeWidth={1.75} />
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-semibold text-text truncate">{invite.from} wants to train together</span>
          <span className="block text-xs text-muted truncate">{invite.session.workoutName}</span>
        </span>
        <button
          onClick={() => { void decline(); }}
          disabled={busy}
          aria-label="Decline invite"
          className="w-8 h-8 rounded-full flex items-center justify-center text-subtle shrink-0"
        >
          <X className="w-4 h-4" strokeWidth={2} />
        </button>
        <button
          onClick={() => onOpen(invite.sessionId)}
          className="h-9 px-3 rounded-full bg-accent text-white text-[13px] font-bold shrink-0"
        >
          Join
        </button>
      </div>
    </div>
  );
}
