import type { GymMember, MembershipStatus } from './types';
import { localDateISO, addDaysISO } from './gymStats';
import { parseQrPayload } from './gymService';

/**
 * Small pure helpers for the member-facing gym screens (JoinGymView,
 * GymHomeView, CheckinView, ClassesView, ClassDetailView,
 * AnnouncementsView, MembershipView) that don't belong in
 * gymService.ts/gymStats.ts — those are owned by the data-layer agent.
 * See docs/GYM_TIER_A_SPEC.md §6.2.
 */

// ---------- QR ----------

/**
 * JoinGymView's "scan gym QR" flow: accepts the dedicated
 * `zenith://gym/<id>/join` payload documented in the spec (not emitted
 * by gymQrPayload today) as well as any other recognised gym payload —
 * scanning never carries the join code itself, so every match just
 * resolves to a gymId and the caller still needs the 6-character code.
 */
export function parseGymJoinQr(text: string): { gymId: string } | null {
  const known = parseQrPayload(text);
  if (known) return { gymId: known.gymId };
  const match = /^zenith:\/\/gym\/([^/]+)\/join$/.exec(text.trim());
  return match ? { gymId: match[1] } : null;
}

// ---------- names ----------

/** Looks up a member's display name from an already-fetched member list.
 *  Members can't list the whole directory (see firestore.rules), so
 *  callers on member screens should fetch best-effort and fall back
 *  gracefully when the list comes back empty. `fallback` covers the "no
 *  uid at all" case (e.g. no trainer assigned); a uid that doesn't match
 *  anyone in the list — someone who left the gym, or a list that hasn't
 *  loaded yet — reads as "Unknown member" rather than the raw uid. */
export function memberName(uid: string | undefined, members: GymMember[], fallback = 'Member'): string {
  if (!uid) return fallback;
  return members.find((m) => m.uid === uid)?.name || 'Unknown member';
}

export function trainerName(trainerUid: string | undefined, members: GymMember[]): string {
  return memberName(trainerUid, members, 'Trainer');
}

// ---------- status ----------

export const MEMBERSHIP_STATUS_LABEL: Record<MembershipStatus, string> = {
  active: 'Active',
  expiring: 'Expiring soon',
  expired: 'Expired',
  frozen: 'Frozen',
  none: 'No plan',
};

export function membershipStatusClasses(status: MembershipStatus): string {
  switch (status) {
    case 'active': return 'bg-emerald-500/15 text-emerald-500';
    case 'expiring': return 'bg-amber-500/15 text-amber-500';
    case 'expired': return 'bg-red-500/15 text-red-500';
    case 'frozen': return 'bg-blue-500/15 text-blue-500';
    default: return 'bg-zinc-500/15 text-zinc-400';
  }
}

// ---------- dates & times ----------

/** Whole days from today to a YYYY-MM-DD (or ISO date-time) string. Negative when already past. */
export function daysUntil(dateISO: string, now: Date = new Date()): number {
  const today = new Date(localDateISO(now) + 'T00:00:00');
  const end = new Date(dateISO.slice(0, 10) + 'T00:00:00');
  return Math.round((end.getTime() - today.getTime()) / 86_400_000);
}

export function formatDateShort(dateISO: string): string {
  const d = new Date(dateISO.slice(0, 10) + 'T00:00:00');
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

export function formatTime12h(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}

/** Session end time (12h) from a class's `startTime` + `durationMin`. */
export function endTime12h(startTime: string, durationMin: number): string {
  const [h, m] = startTime.split(':').map(Number);
  const total = h * 60 + m + durationMin;
  const eh = Math.floor(total / 60) % 24;
  const em = total % 60;
  return formatTime12h(`${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`);
}

/** "Today" / "Tomorrow" / "Mon, 8 Sep" for a YYYY-MM-DD, relative to now. */
export function dayLabel(dateISO: string, now: Date = new Date()): string {
  const today = localDateISO(now);
  const tomorrow = addDaysISO(today, 1);
  if (dateISO === today) return 'Today';
  if (dateISO === tomorrow) return 'Tomorrow';
  const d = new Date(dateISO + 'T00:00:00');
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}

/** Sunday (YYYY-MM-DD, local) of the week containing `now`. */
export function startOfWeekISO(now: Date = new Date()): string {
  const d = new Date(now);
  d.setDate(d.getDate() - d.getDay());
  d.setHours(0, 0, 0, 0);
  return localDateISO(d);
}

export function formatMoney(amount: number): string {
  return `₹${amount.toLocaleString('en-IN')}`;
}
