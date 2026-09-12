import type { GymMember, GymClass, GymDailyStat, GymPayment, GymClassSession, MembershipStatus, DashboardStats } from './types';

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
  // Clamp to the last day of the target month: 31 Jan + 1 month is 28 Feb,
  // not 3 Mar (which is what setMonth alone produces).
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
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

// ---------- renewal outreach ----------

/**
 * Members the owner should chase: the plan has lapsed or ends within a
 * week. Frozen members and members without a plan are left alone —
 * chasing them is noise. Renewal is where independent gyms lose most of
 * their revenue, so this feeds the one-tap WhatsApp/UPI actions below.
 */
export function needsRenewal(m: Pick<GymMember, 'planEnd' | 'frozen'>, now: Date = new Date()): boolean {
  const status = membershipStatus(m, now);
  return status === 'expiring' || status === 'expired';
}

/**
 * An Indian mobile number in the `919876543210` form wa.me wants, or
 * null when the field holds something we cannot dial ("front desk", a
 * landline, a half-typed number). Accepts +91, 0091 and bare 10-digit
 * input, with any spacing or punctuation.
 */
export function normalizePhoneIN(phone: string | undefined | null): string | null {
  const digits = (phone ?? '').replace(/\D/g, '').replace(/^0+/, '');
  if (/^[6-9]\d{9}$/.test(digits)) return `91${digits}`;
  if (/^91[6-9]\d{9}$/.test(digits)) return digits;
  return null;
}

/** wa.me deep link with the message pre-filled — no WhatsApp API, no cost. */
export function whatsAppUrl(phone: string | undefined | null, message: string): string | null {
  const to = normalizePhoneIN(phone);
  return to ? `https://wa.me/${to}?text=${encodeURIComponent(message)}` : null;
}

/**
 * `upi://pay` intent the owner can share so the member pays from any UPI
 * app. Amount is omitted when there is nothing to charge, letting the
 * member enter it.
 */
export function upiPayUri(opts: { vpa: string; payeeName: string; amount?: number; note?: string }): string {
  const params = new URLSearchParams();
  params.set('pa', opts.vpa);
  params.set('pn', opts.payeeName);
  if (opts.amount && opts.amount > 0) params.set('am', opts.amount.toFixed(2));
  params.set('cu', 'INR');
  if (opts.note) params.set('tn', opts.note);
  return `upi://pay?${params.toString()}`;
}

function shortDate(dateISO: string): string {
  return new Date(dateISO.slice(0, 10) + 'T00:00:00')
    .toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * The renewal message itself. Warm, specific and never shaming — the
 * member gets their own name, their plan, the date and the price, so the
 * reply is a yes/no rather than a question.
 */
export function buildRenewalMessage(opts: {
  memberName: string;
  gymName: string;
  planName?: string;
  planEnd?: string;
  amount?: number;
  now?: Date;
}): string {
  const now = opts.now ?? new Date();
  const firstName = opts.memberName.trim().split(/\s+/)[0];
  const lapsed = !!opts.planEnd && dateOnly(opts.planEnd) < localDateISO(now);
  const lines = [`Hi ${firstName || 'there'},`, ''];

  if (opts.planEnd) {
    const plan = opts.planName ? `Your ${opts.planName} plan` : 'Your membership';
    lines.push(`${plan} at ${opts.gymName} ${lapsed ? 'ended' : 'ends'} on ${shortDate(opts.planEnd)}.`);
  } else {
    lines.push('Your membership is due for renewal.');
  }

  if (opts.amount && opts.amount > 0) {
    lines.push(`Renewal is ₹${opts.amount.toLocaleString('en-IN')}.`);
  }
  lines.push(
    lapsed
      ? `Shall I renew it so you are back on the floor at ${opts.gymName} tomorrow?`
      : `Shall I keep your spot at ${opts.gymName} running so you do not miss a session?`,
  );
  return lines.join('\n');
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
  dailyStats: GymDailyStat[];
  payments90d: GymPayment[];
  classes: GymClass[];
  sessions7d: GymClassSession[];
  now?: Date;
}): DashboardStats {
  const now = input.now ?? new Date();
  const today = localDateISO(now);
  const { members, dailyStats, payments90d, classes, sessions7d } = input;
  const statsByDate = new Map(dailyStats.map((s) => [s.date, s]));

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

  const checkinsToday = statsByDate.get(today)?.count ?? 0;

  const checkinsPerDay: Array<{ date: string; count: number }> = [];
  for (let i = 29; i >= 0; i--) {
    const date = addDaysISO(today, -i);
    checkinsPerDay.push({ date, count: statsByDate.get(date)?.count ?? 0 });
  }

  const checkinsPerHour = new Array<number>(24).fill(0);
  for (const s of dailyStats) {
    for (const [hourStr, count] of Object.entries(s.hours)) {
      const hour = Number(hourStr);
      if (hour >= 0 && hour < 24) checkinsPerHour[hour] += count;
    }
  }

  // Recency now comes only from the per-member denormalised fields
  // (dailyStats has no per-uid breakdown) — checkinMember keeps
  // lastCheckinAt current on every check-in, so this loses nothing.
  const activeThisWeekUids = new Set<string>();
  for (const m of members) {
    const lastSeen = latestOf(m.lastCheckinAt, m.lastWorkoutAt);
    if (!lastSeen) continue;
    const d = daysBetween(dateOnly(lastSeen), today);
    if (d >= 0 && d <= 7) activeThisWeekUids.add(m.uid);
  }

  const atRisk = members.filter((m) => {
    if (m.role !== 'member') return false; // staff aren't retention targets
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
  const newActiveMembers = newMembers.filter((m) => (m.checkinCount30d ?? 0) >= 2);
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
