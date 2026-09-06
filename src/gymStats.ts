import type { GymMember, GymClass, GymCheckin, GymPayment, GymClassSession, MembershipStatus, DashboardStats } from './types';

/**
 * Pure Gym OS lite logic — membership status, class scheduling, QR
 * payload encode/decode, and dashboard aggregation. Nothing here touches
 * Firestore, so it's unit-testable with a plain esbuild-bundled node
 * script (see /tmp .../scratchpad/gymstats.test.mjs), the same way
 * streakService's pure logic is tested.
 *
 * `src/gymService.ts` imports and re-exports the functions below rather
 * than re-implementing them.
 */

// ---------- date helpers (all LOCAL time, date-only) ----------

/** Local YYYY-MM-DD, same convention as streakService.localIso. */
export function localDateISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/** First 10 chars of an ISO date/date-time string — normalises a full
 *  timestamp down to its local calendar date for string comparison. */
function dateOnly(iso: string): string {
  return iso.slice(0, 10);
}

/** Whole days between two YYYY-MM-DD strings (b - a). Positive when b is later. */
function daysBetween(aISO: string, bISO: string): number {
  const a = new Date(dateOnly(aISO) + 'T00:00:00');
  const b = new Date(dateOnly(bISO) + 'T00:00:00');
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/** Adds `n` days to a YYYY-MM-DD and returns a YYYY-MM-DD. */
export function addDaysISO(yyyymmdd: string, n: number): string {
  const d = new Date(dateOnly(yyyymmdd) + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return localDateISO(d);
}

/** Adds `months` calendar months to a YYYY-MM-DD (date-only) and returns
 *  a YYYY-MM-DD. Used for plan renewals — extends planEnd by a plan's
 *  duration. */
export function addMonthsISO(yyyymmdd: string, months: number): string {
  const d = new Date(dateOnly(yyyymmdd) + 'T00:00:00');
  d.setMonth(d.getMonth() + months);
  return localDateISO(d);
}

// ---------- membership status ----------

/**
 * Pure membership status derivation.
 *   - no planEnd at all            → 'none'
 *   - frozen flag set              → 'frozen'
 *   - planEnd already passed       → 'expired'
 *   - planEnd within 7 days        → 'expiring'
 *   - otherwise                    → 'active'
 */
export function membershipStatus(m: Pick<GymMember, 'planEnd' | 'frozen'>, now: Date = new Date()): MembershipStatus {
  if (!m.planEnd) return 'none';
  if (m.frozen) return 'frozen';
  const today = localDateISO(now);
  const end = dateOnly(m.planEnd);
  if (end < today) return 'expired';
  const daysLeft = daysBetween(today, end);
  if (daysLeft <= 7) return 'expiring';
  return 'active';
}

// ---------- class scheduling ----------

/**
 * Expands a gym's weekly class list into concrete (class, date) sessions
 * for the next `days` days starting at `from` (inclusive). Only active
 * classes are scheduled. Each day's sessions are ordered by start time.
 */
export function upcomingSessions(classes: GymClass[], from: Date, days = 7): Array<{ cls: GymClass; date: string }> {
  const out: Array<{ cls: GymClass; date: string }> = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(from);
    d.setDate(d.getDate() + i);
    const weekday = d.getDay();
    const date = localDateISO(d);
    const dayClasses = classes
      .filter((c) => c.active && c.weekday === weekday)
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
    for (const cls of dayClasses) out.push({ cls, date });
  }
  return out;
}

// ---------- QR payloads ----------

const QR_SCHEME = 'zenith://gym';

/** QR payload a gym prints/displays for members to scan and check in. */
export function gymQrPayload(gymId: string): string {
  return `${QR_SCHEME}/${gymId}/checkin`;
}

/** QR payload a member shows staff to scan them in. */
export function memberQrPayload(gymId: string, uid: string): string {
  return `${QR_SCHEME}/${gymId}/member/${uid}`;
}

export type GymQrPayload =
  | { kind: 'gym-checkin'; gymId: string }
  | { kind: 'member'; gymId: string; uid: string };

/** Decodes a scanned QR payload produced by gymQrPayload/memberQrPayload.
 *  Returns null for anything else (a QR from a different app, garbage, …). */
export function parseQrPayload(text: string): GymQrPayload | null {
  const trimmed = text.trim();
  const checkin = new RegExp(`^${QR_SCHEME}/([^/]+)/checkin$`).exec(trimmed);
  if (checkin) return { kind: 'gym-checkin', gymId: checkin[1] };
  const member = new RegExp(`^${QR_SCHEME}/([^/]+)/member/([^/]+)$`).exec(trimmed);
  if (member) return { kind: 'member', gymId: member[1], uid: member[2] };
  return null;
}

// ---------- dashboard aggregation ----------

/** Threshold (days) after which a member with no recent activity is flagged at-risk. */
const AT_RISK_INACTIVE_DAYS = 14;
/** A member must have been around at least this long before "no recent activity" is meaningful. */
const AT_RISK_MIN_TENURE_DAYS = 30;

function latestOf(...isoDates: Array<string | undefined>): string | undefined {
  const present = isoDates.filter((d): d is string => !!d);
  if (!present.length) return undefined;
  return present.reduce((latest, d) => (d > latest ? d : latest));
}

export function computeDashboard(input: {
  members: GymMember[];
  checkins30d: GymCheckin[];
  payments90d: GymPayment[];
  classes: GymClass[];
  sessions7d: GymClassSession[];
  now?: Date;
}): DashboardStats {
  const now = input.now ?? new Date();
  const today = localDateISO(now);
  const { members, checkins30d, payments90d, classes, sessions7d } = input;

  let activeMembers = 0;
  let expiringIn7 = 0;
  let expiringIn30 = 0;
  let expired = 0;
  let frozen = 0;
  const duesOutstanding: Array<{ member: GymMember; daysOverdue: number }> = [];

  for (const m of members) {
    const status = membershipStatus(m, now);
    if (status === 'active') activeMembers++;
    else if (status === 'expiring') expiringIn7++;
    else if (status === 'expired') {
      expired++;
      duesOutstanding.push({ member: m, daysOverdue: daysBetween(dateOnly(m.planEnd as string), today) });
    } else if (status === 'frozen') frozen++;

    // expiringIn30 is a wider forward-looking window than the 7-day
    // 'expiring' status bucket — it includes those too.
    if (!m.frozen && m.planEnd) {
      const end = dateOnly(m.planEnd);
      if (end >= today && daysBetween(today, end) <= 30) expiringIn30++;
    }
  }

  const checkinsToday = checkins30d.filter((c) => c.date === today).length;

  const checkinsPerDay: Array<{ date: string; count: number }> = [];
  for (let i = 29; i >= 0; i--) {
    const date = addDaysISO(today, -i);
    checkinsPerDay.push({ date, count: checkins30d.filter((c) => c.date === date).length });
  }

  const checkinsPerHour = new Array<number>(24).fill(0);
  for (const c of checkins30d) {
    const hour = new Date(c.at).getHours();
    if (hour >= 0 && hour < 24) checkinsPerHour[hour]++;
  }

  const activeThisWeekUids = new Set<string>();
  for (const c of checkins30d) {
    const d = daysBetween(c.date, today);
    if (d >= 0 && d <= 7) activeThisWeekUids.add(c.uid);
  }
  for (const m of members) {
    if (m.lastWorkoutAt) {
      const d = daysBetween(dateOnly(m.lastWorkoutAt), today);
      if (d >= 0 && d <= 7) activeThisWeekUids.add(m.uid);
    }
  }

  const atRisk = members.filter((m) => {
    const status = membershipStatus(m, now);
    if (status === 'expired' || status === 'frozen') return false;
    const tenureDays = daysBetween(dateOnly(m.joinedAt), today);
    if (tenureDays <= AT_RISK_MIN_TENURE_DAYS) return false;
    const lastSeen = latestOf(m.lastCheckinAt, m.lastWorkoutAt);
    if (!lastSeen) return true;
    return daysBetween(dateOnly(lastSeen), today) >= AT_RISK_INACTIVE_DAYS;
  });

  const revenue90d = payments90d.reduce((sum, p) => sum + p.amount, 0);
  const revenue30d = payments90d
    .filter((p) => {
      const d = daysBetween(dateOnly(p.paidAt), today);
      return d >= 0 && d <= 30;
    })
    .reduce((sum, p) => sum + p.amount, 0);

  const newMembers = members.filter((m) => {
    const d = daysBetween(dateOnly(m.joinedAt), today);
    return d >= 0 && d <= 30;
  });
  const checkinCountByUid = new Map<string, number>();
  for (const c of checkins30d) checkinCountByUid.set(c.uid, (checkinCountByUid.get(c.uid) ?? 0) + 1);
  const newActiveMembers = newMembers.filter((m) => (checkinCountByUid.get(m.uid) ?? 0) >= 2);
  const signupToActive = newMembers.length ? newActiveMembers.length / newMembers.length : 0;

  const classFill = classes.map((cls) => {
    const sessions = sessions7d.filter((s) => s.classId === cls.id);
    const avgEnrolled = sessions.length ? sessions.reduce((s, x) => s + x.enrolled.length, 0) / sessions.length : 0;
    const avgAttended = sessions.length ? sessions.reduce((s, x) => s + x.attended.length, 0) / sessions.length : 0;
    return { cls, avgEnrolled, avgAttended, capacity: cls.capacity };
  });

  return {
    totalMembers: members.length,
    activeMembers,
    expiringIn7,
    expiringIn30,
    expired,
    frozen,
    checkinsToday,
    checkinsPerDay,
    checkinsPerHour,
    activeThisWeek: activeThisWeekUids.size,
    atRisk,
    duesOutstanding,
    revenue30d,
    revenue90d,
    newMembers30d: newMembers.length,
    signupToActive,
    classFill,
  };
}
