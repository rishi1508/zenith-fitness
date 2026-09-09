import { useEffect, useMemo, useState } from 'react';
import { Check, Clock, Users, X } from 'lucide-react';
import type { BuddyRelationship, DayPlan, WeeklyPlan, WorkoutSession } from '../../types';
import { useAuth } from '../../auth/AuthContext';
import * as buddyService from '../../buddyService';
import * as sessionService from '../../workoutSessionService';
import { rankByAffinity } from '../../buddyAffinity';
import * as storage from '../../storage';
import { Avatar } from '../../components';
import { Button, Chip, EmptyState, Sheet, Skeleton, useToast, CAPTION, SUB } from '../../ui';

/** A session holds three people: the host and two guests. */
const MAX_GUESTS = 2;

interface WorkoutTogetherSheetProps {
  /** The day the home card is offering — the session starts pointed at it. */
  plan: WeeklyPlan | null;
  initialDay: DayPlan | null;
  onClose: () => void;
  /** Fired when the host starts: the caller turns it into an active workout. */
  onStart: (session: WorkoutSession) => void;
}

/**
 * "Workout together" without leaving the home screen.
 *
 * Two people who always train together should not have to go Buddies → pick
 * → invite → lobby → back. Here: pick up to two buddies, they appear as they
 * accept, choose the day while you wait, start. The session itself is the
 * same one the lobby builds, so everything downstream is unchanged.
 */
export function WorkoutTogetherSheet({ plan, initialDay, onClose, onStart }: WorkoutTogetherSheetProps) {
  const { user } = useAuth();
  const { showToast } = useToast();

  const [buddies, setBuddies] = useState<Array<{ uid: string; name: string; photoURL?: string | null }> | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [session, setSession] = useState<WorkoutSession | null>(null);
  const [day, setDay] = useState<DayPlan | null>(initialDay);
  const [busy, setBusy] = useState(false);

  const days = useMemo(() => (plan?.days ?? []).filter((d) => !d.isRestDay), [plan]);

  useEffect(() => {
    if (!user) return;
    return buddyService.listenToBuddies((rels: BuddyRelationship[]) => {
      void (async () => {
        const uids = rels.map((r) => r.users.find((u) => u !== user.uid) ?? r.users[0]);
        const ordered = rankByAffinity(uids);
        const rows = await Promise.all(ordered.slice(0, 12).map(async (uid) => {
          const profile = await buddyService.getUserProfile(uid).catch(() => null);
          const rel = rels.find((r) => r.users.includes(uid));
          return { uid, name: profile?.displayName ?? rel?.userNames[uid] ?? 'Buddy', photoURL: profile?.photoURL };
        }));
        setBuddies(rows);
      })();
    });
  }, [user]);

  // Live view of the session once it exists, so guests appear as they accept.
  useEffect(() => {
    if (!sessionId) return;
    return sessionService.listenToSession(sessionId, setSession);
  }, [sessionId]);

  const toggle = (uid: string) => {
    setPicked((prev) => (
      prev.includes(uid) ? prev.filter((u) => u !== uid)
        : prev.length >= MAX_GUESTS ? prev
          : [...prev, uid]
    ));
  };

  const invite = async () => {
    if (!plan || !day || picked.length === 0 || busy) return;
    setBusy(true);
    try {
      const name = `${plan.name} - ${day.name}`;
      const id = await sessionService.createSession(name, 'custom', day.exercises);
      setSessionId(id);
      for (const uid of picked) {
        const b = buddies?.find((x) => x.uid === uid);
        await sessionService.inviteToSession(id, uid, b?.name ?? 'Buddy', b?.photoURL ?? null);
      }
      showToast(`Invited ${picked.length === 1 ? b0(buddies, picked[0]) : `${picked.length} buddies`}`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not send that invite.', 'error');
    } finally {
      setBusy(false);
    }
  };

  /** Changing the day after inviting keeps everyone pointed at the same one. */
  const chooseDay = (d: DayPlan) => {
    setDay(d);
    storage.setLastUsedDay(d.dayNumber);
    if (sessionId && plan) {
      void sessionService.syncHostTemplate(sessionId, d.exercises, `${plan.name} - ${d.name}`);
    }
  };

  const start = async () => {
    if (!sessionId || busy) return;
    setBusy(true);
    try {
      await sessionService.startSession(sessionId);
      const fresh = await sessionService.getSession(sessionId);
      if (fresh) onStart(fresh);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not start the session.', 'error');
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (sessionId) await sessionService.cancelSession(sessionId).catch(() => {});
    onClose();
  };

  const participants = Object.values(session?.participants ?? {});
  const guests = participants.filter((p) => p.uid !== user?.uid);
  const joined = guests.filter((p) => p.status === 'joined' || p.status === 'active').length;

  return (
    <Sheet open onClose={sessionId ? cancel : onClose} title="Workout together">
      {/* Which day — always visible, changeable right up to the start. */}
      {days.length > 0 && (
        <div>
          <span className={CAPTION}>Session</span>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {days.map((d) => (
              <Chip key={d.dayNumber} on={day?.dayNumber === d.dayNumber} onClick={() => chooseDay(d)}>
                {d.name}
              </Chip>
            ))}
          </div>
        </div>
      )}

      {!sessionId ? (
        <>
          <div>
            <span className={CAPTION}>Invite (up to {MAX_GUESTS})</span>
            {buddies === null && <div className="mt-2 space-y-2"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>}
            {buddies?.length === 0 && (
              <EmptyState icon={Users} title="No buddies yet" body="Add a training partner from the Buddies screen and they'll show up here." />
            )}
            <div className="mt-1.5 space-y-1.5">
              {buddies?.map((b) => {
                const on = picked.includes(b.uid);
                const full = !on && picked.length >= MAX_GUESTS;
                return (
                  <button
                    key={b.uid}
                    onClick={() => toggle(b.uid)}
                    disabled={full}
                    className={`w-full min-h-12 px-3 rounded-control border flex items-center gap-2.5 text-left transition-colors ${
                      on ? 'border-accent bg-accent-soft' : 'border-border'
                    } ${full ? 'opacity-40' : ''}`}
                  >
                    <Avatar name={b.name} photoURL={b.photoURL} size="sm" />
                    <span className="flex-1 min-w-0 text-sm font-semibold text-text truncate">{b.name}</span>
                    {on && <Check className="w-4 h-4 text-accent shrink-0" strokeWidth={2.5} />}
                  </button>
                );
              })}
            </div>
          </div>
          <Button
            variant="primary" size="lg" full disabled={busy || picked.length === 0 || !day}
            onClick={() => { void invite(); }}
          >
            {busy ? 'Inviting…' : `Invite ${picked.length || ''}`.trim()}
          </Button>
        </>
      ) : (
        <>
          <div>
            <span className={CAPTION}>Lobby</span>
            <div className="mt-1.5 space-y-1.5">
              {participants.map((p) => (
                <div key={p.uid} className="min-h-12 px-3 rounded-control border border-border flex items-center gap-2.5">
                  <Avatar name={p.name} photoURL={p.photoURL} size="sm" />
                  <span className="flex-1 min-w-0 text-sm font-semibold text-text truncate">
                    {p.name}{p.uid === user?.uid ? ' (you)' : ''}
                  </span>
                  {p.status === 'invited' && <span className={`${SUB} flex items-center gap-1 shrink-0`}><Clock className="w-3.5 h-3.5" /> invited</span>}
                  {(p.status === 'joined' || p.status === 'active') && <span className="text-xs font-semibold text-ok shrink-0">ready</span>}
                  {p.status === 'declined' && <span className="text-xs font-semibold text-subtle shrink-0">declined</span>}
                </div>
              ))}
            </div>
            <p className={`${SUB} mt-2`}>
              {joined === 0 ? 'Waiting for them to accept — you can start anyway.' : `${joined} ready. Start when you are.`}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" size="lg" icon={X} onClick={() => { void cancel(); }} className="flex-1">Cancel</Button>
            <Button variant="primary" size="lg" disabled={busy} onClick={() => { void start(); }} className="flex-[2]">
              {busy ? 'Starting…' : 'Start together'}
            </Button>
          </div>
        </>
      )}
    </Sheet>
  );
}

function b0(buddies: Array<{ uid: string; name: string }> | null, uid: string): string {
  return buddies?.find((b) => b.uid === uid)?.name ?? 'your buddy';
}
