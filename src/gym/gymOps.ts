import type {
  GymCheckin, GymClass, GymClassSession, GymEquipment, GymMember, GymPayment, GymPlan, GymRole,
  RevenueCategory,
} from '../types';
import { localDateISO, membershipStatus } from '../gymStats';

/**
 * GymOps analytics — pure metric functions behind GymOpsView. Nothing
 * here touches React or Firestore, so every number is unit-testable
 * against plain arrays (tests/gymOps.test.ts), the same way gymStats.ts
 * backs the owner dashboard.
 *
 * Where a metric is a proxy rather than the real thing (we have no PT
 * bookings, no per-period equipment history), the doc comment says so —
 * the UI repeats it, because a number an owner cannot trace is worse
 * than no number.
 */

const DAY_MS = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Mean days in a month — tenure in months is a ratio, not a calendar walk. */
const DAYS_PER_MONTH = 30.4375;

/** Only real members are counted as acquisition/churn/retention — staff
 *  join the members collection too, and a new trainer is not a signup. */
function isMember(m: GymMember): boolean {
  return m.role === 'member';
}

/** A plan that covers today: 'expiring' still pays this month, so it counts. */
function onLivePlan(m: GymMember, now: Date): boolean {
  const status = membershipStatus(m, now);
  return status === 'active' || status === 'expiring';
}

function shiftISO(now: Date, days: number): string {
  return localDateISO(new Date(now.getTime() + days * DAY_MS));
}

/** 'Sep 26' — fixed names rather than toLocaleDateString, which renders
 *  September as "Sept" under en-IN and would widen one column label. */
function monthLabel(year: number, monthIndex: number): string {
  return `${MONTHS[monthIndex]} ${String(year % 100).padStart(2, '0')}`;
}

/** ₹ with Indian digit grouping and no paise — ₹3,65,700. */
export function formatInr(n: number): string {
  const rounded = Math.round(Math.abs(n));
  const sign = n < 0 && rounded !== 0 ? '-' : '';
  return `${sign}₹${rounded.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

export interface MrrTrend {
  /** Monthly recurring revenue today. */
  mrr: number;
  /** The same figure as it stood 30 days ago. */
  prevMrr: number;
  /** Percentage change over those 30 days; null when there is no base to compare against. */
  changePct: number | null;
}

/**
 * Monthly recurring revenue: every member on a live plan contributes
 * plan.price ÷ plan.months, so a ₹6,000 three-month plan is ₹2,000/month.
 * Members with no plan (or a plan the gym has since deleted) contribute 0.
 * `prevMrr` re-runs the same sum against the roster as it stood 30 days
 * ago — a member counted then if planStart ≤ that date < planEnd.
 */
export function computeMrr(members: GymMember[], plans: GymPlan[], now: Date = new Date()): MrrTrend {
  const priceById = new Map(plans.map((p) => [p.id, p]));
  const monthly = (m: GymMember): number => {
    const plan = m.planId ? priceById.get(m.planId) : undefined;
    return plan && plan.months > 0 ? plan.price / plan.months : 0;
  };

  let mrr = 0;
  for (const m of members) if (onLivePlan(m, now)) mrr += monthly(m);

  const then = shiftISO(now, -30);
  let prevMrr = 0;
  for (const m of members) {
    if (m.frozen || !m.planEnd) continue;
    const start = (m.planStart ?? m.joinedAt).slice(0, 10);
    if (start <= then && then < m.planEnd.slice(0, 10)) prevMrr += monthly(m);
  }

  return { mrr, prevMrr, changePct: prevMrr > 0 ? ((mrr - prevMrr) / prevMrr) * 100 : null };
}

export interface AcquisitionMonth {
  /** 'Sep 26'. */
  month: string;
  new: number;
  churned: number;
  net: number;
}

/**
 * Twelve rolling months of member flow, oldest first and ending with the
 * current month. New = signups by `joinedAt`. Churned = members whose plan
 * ended in that month and who have not come back — their plan end is more
 * than a week in the past (so somebody who lapsed on Friday is not written
 * off yet) and they are not frozen. Net is new − churned.
 */
export function acquisitionChurnSeries(members: GymMember[], now: Date = new Date()): AcquisitionMonth[] {
  const grace = shiftISO(now, -7);
  const buckets = new Map<string, AcquisitionMonth>();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    buckets.set(key, { month: monthLabel(d.getFullYear(), d.getMonth()), new: 0, churned: 0, net: 0 });
  }

  for (const m of members) {
    if (!isMember(m)) continue;
    // joinedAt is a UTC timestamp; the buckets are local months, so go
    // through a Date rather than slicing the string.
    const joined = buckets.get(localDateISO(new Date(m.joinedAt)).slice(0, 7));
    if (joined) joined.new += 1;
    if (m.frozen || !m.planEnd) continue;
    const end = m.planEnd.slice(0, 10);
    const lapsed = buckets.get(end.slice(0, 7));
    if (lapsed && end < grace) lapsed.churned += 1;
  }

  const series = [...buckets.values()];
  for (const b of series) b.net = b.new - b.churned;
  return series;
}

export interface SlippingAway {
  /** Members whose attendance more than halved month over month. */
  members: GymMember[];
  /** How many members that was measured against. */
  activeCount: number;
}

/**
 * Members who are drifting: fewer than half the check-ins in the last 30
 * days that they managed in the 30 days before. Somebody needs at least
 * two visits in the earlier window to qualify, so a single missed week
 * never reads as a member on the way out. Exactly half is not slipping.
 */
export function slippingAway(checkins: GymCheckin[], members: GymMember[], now: Date = new Date()): SlippingAway {
  const recentFrom = new Date(now.getTime() - 30 * DAY_MS).toISOString();
  const earlierFrom = new Date(now.getTime() - 60 * DAY_MS).toISOString();

  const recent = new Map<string, number>();
  const earlier = new Map<string, number>();
  for (const c of checkins) {
    if (c.at >= recentFrom) recent.set(c.uid, (recent.get(c.uid) ?? 0) + 1);
    else if (c.at >= earlierFrom) earlier.set(c.uid, (earlier.get(c.uid) ?? 0) + 1);
  }

  const active = members.filter((m) => isMember(m) && onLivePlan(m, now));
  const slipping = active.filter((m) => {
    const before = earlier.get(m.uid) ?? 0;
    if (before < 2) return false;
    return (recent.get(m.uid) ?? 0) < before / 2;
  });
  return { members: slipping, activeCount: active.length };
}

export interface ClvCac {
  /** Lifetime value: monthly spend per member × how long they stay. */
  clv: number;
  /** Cost of winning one member; null until the owner records a marketing spend. */
  cac: number | null;
  /** CLV ÷ CAC — 3–5× is the healthy band. */
  ratio: number | null;
  /** Average revenue per active member per month. */
  arpu: number;
  /** Mean membership length in months. */
  tenureMonths: number;
  newMembers30d: number;
}

/**
 * CLV:CAC — what a member is worth against what they cost to win.
 * CLV is ARPU (90 days of revenue ÷ 3 ÷ active members) × average tenure,
 * where tenure runs from joinedAt to planEnd (or today for a member still
 * on the books). CAC is the owner's monthly marketing spend ÷ the members
 * who joined in the last 30 days, so both sides are a month wide.
 */
export function clvCac(input: {
  members: GymMember[];
  payments90d: GymPayment[];
  marketingSpendMonthly?: number;
  now?: Date;
}): ClvCac {
  const now = input.now ?? new Date();
  const roster = input.members.filter(isMember);
  const since = new Date(now.getTime() - 90 * DAY_MS).toISOString();
  const revenue90d = input.payments90d
    .filter((p) => p.paidAt >= since && p.paidAt <= now.toISOString())
    .reduce((sum, p) => sum + p.amount, 0);

  const activeCount = roster.filter((m) => onLivePlan(m, now)).length;
  const arpu = activeCount > 0 ? revenue90d / 3 / activeCount : 0;

  const today = localDateISO(now);
  const tenures = roster.map((m) => {
    const end = (m.planEnd ?? today).slice(0, 10);
    const days = (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${m.joinedAt.slice(0, 10)}T00:00:00Z`)) / DAY_MS;
    return Math.max(0, days) / DAYS_PER_MONTH;
  });
  const tenureMonths = tenures.length ? tenures.reduce((a, b) => a + b, 0) / tenures.length : 0;

  const joinedFrom = shiftISO(now, -30);
  const newMembers30d = roster.filter((m) => m.joinedAt.slice(0, 10) >= joinedFrom).length;

  const spend = input.marketingSpendMonthly;
  const cac = spend && spend > 0 && newMembers30d > 0 ? spend / newMembers30d : null;
  const clv = arpu * tenureMonths;
  return { clv, cac, ratio: cac ? clv / cac : null, arpu, tenureMonths, newMembers30d };
}

export interface RevenueSlice {
  key: RevenueCategory;
  label: string;
  amount: number;
  /** Exact fraction of the total (0–1) — what the arc is drawn from. */
  share: number;
  /** Whole percent, largest-remainder rounded so the legend sums to 100. */
  pct: number;
}

export interface RevenueSplitResult {
  total: number;
  slices: RevenueSlice[];
  /** The window the split covers, in days. */
  days: number;
}

const REVENUE_LABELS: Record<RevenueCategory, string> = {
  membership: 'Base memberships',
  pt: 'Personal training',
  other: 'Other',
};

/**
 * Where the money came from over the last 90 days. Payments recorded
 * before categories existed carry none, and count as membership revenue —
 * which is what they were. Percentages are largest-remainder rounded, so
 * the legend always adds up to 100.
 */
export function revenueSplit(payments: GymPayment[], now: Date = new Date(), days = 90): RevenueSplitResult {
  const since = new Date(now.getTime() - days * DAY_MS).toISOString();
  const until = now.toISOString();
  const totals: Record<RevenueCategory, number> = { membership: 0, pt: 0, other: 0 };
  for (const p of payments) {
    // A payment recorded against a future date (an advance renewal) is
    // not money taken in this window.
    if (p.paidAt < since || p.paidAt > until) continue;
    totals[p.category ?? 'membership'] += p.amount;
  }

  const total = totals.membership + totals.pt + totals.other;
  const keys: RevenueCategory[] = ['membership', 'pt', 'other'];
  const raw = keys.map((key) => ({ key, amount: totals[key], share: total > 0 ? totals[key] / total : 0 }));

  // Largest remainder: floor everything, then hand the leftover points to
  // the biggest fractions, so three thirds read 34/33/33 rather than 33×3.
  const floors = raw.map((r) => Math.floor(r.share * 100));
  let leftover = total > 0 ? 100 - floors.reduce((a, b) => a + b, 0) : 0;
  const order = raw
    .map((r, i) => ({ i, frac: r.share * 100 - floors[i] }))
    .sort((a, b) => b.frac - a.frac);
  for (const { i } of order) {
    if (leftover <= 0) break;
    floors[i] += 1;
    leftover -= 1;
  }

  return {
    total,
    days,
    slices: raw.map((r, i) => ({ ...r, label: REVENUE_LABELS[r.key], pct: floors[i] })),
  };
}

export interface TrainerRow {
  uid: string;
  name: string;
  /** Sessions that actually ran (somebody was marked attended). */
  ran: number;
  /** Sessions the timetable scheduled in the window. */
  scheduled: number;
  /** ran ÷ scheduled, 0–1. */
  utilisation: number;
  /** Timetabled hours per week from the class durations. */
  hoursPerWeek: number;
}

export interface TrainerUtilisation {
  trainers: TrainerRow[];
  /** Gym-wide ran ÷ scheduled. */
  utilisation: number;
  hoursPerWeek: number;
  scheduled: number;
}

/**
 * Trainer CLASS utilisation — the share of a trainer's timetabled classes
 * that actually ran, over the last four weeks. It is not PT-chair
 * occupancy: Zenith has no personal-training bookings to measure.
 * A class with nobody marked attended is counted as not run.
 */
export function trainerUtilisation(input: {
  classes: GymClass[];
  sessions: GymClassSession[];
  members: GymMember[];
  staff: Record<string, Exclude<GymRole, 'member'>>;
  now?: Date;
  weeks?: number;
}): TrainerUtilisation {
  const now = input.now ?? new Date();
  const weeks = input.weeks ?? 4;
  const nameByUid = new Map(input.members.map((m) => [m.uid, m.name]));

  const dates = new Set<string>();
  const weekdayCount = new Array<number>(7).fill(0);
  for (let i = 0; i < weeks * 7; i++) {
    const d = new Date(now.getTime() - i * DAY_MS);
    dates.add(localDateISO(d));
    weekdayCount[d.getDay()] += 1;
  }

  const rows = new Map<string, TrainerRow>();
  const row = (uid: string): TrainerRow => {
    let r = rows.get(uid);
    if (!r) {
      r = { uid, name: nameByUid.get(uid) ?? 'Trainer', ran: 0, scheduled: 0, utilisation: 0, hoursPerWeek: 0 };
      rows.set(uid, r);
    }
    return r;
  };
  for (const [uid, staffRole] of Object.entries(input.staff)) if (staffRole === 'trainer') row(uid);

  for (const cls of input.classes) {
    if (!cls.active || !cls.trainerUid) continue;
    const r = row(cls.trainerUid);
    r.scheduled += weekdayCount[cls.weekday];
    r.hoursPerWeek += cls.durationMin / 60;
    r.ran += input.sessions.filter((s) => s.classId === cls.id && dates.has(s.date) && s.attended.length > 0).length;
  }

  const trainers = [...rows.values()]
    .map((r) => ({ ...r, utilisation: r.scheduled > 0 ? Math.min(1, r.ran / r.scheduled) : 0 }))
    .sort((a, b) => b.utilisation - a.utilisation || b.scheduled - a.scheduled || a.name.localeCompare(b.name));

  const scheduled = trainers.reduce((sum, r) => sum + r.scheduled, 0);
  const ran = trainers.reduce((sum, r) => sum + r.ran, 0);
  return {
    trainers,
    scheduled,
    utilisation: scheduled > 0 ? Math.min(1, ran / scheduled) : 0,
    hoursPerWeek: trainers.reduce((sum, r) => sum + r.hoursPerWeek, 0),
  };
}

export interface EquipmentHealthResult {
  /** Share of opening hours the fleet was usable, 0–1. */
  health: number;
  machines: number;
  down: number;
  /** Minutes of downtime counted against the window. */
  downtimeMin: number;
  windowDays: number;
  openHoursPerDay: number;
}

/**
 * Equipment uptime against opening hours: 1 − downtime ÷ (30 days × 16 h)
 * across the fleet. `downtimeMin` is cumulative since a machine was added,
 * so a gym that has tracked for longer than a month sees its older outages
 * still counted here; each machine is capped at one window's worth so the
 * figure stays inside 0–100%.
 */
export function equipmentHealth(equipment: GymEquipment[], now: Date = new Date()): EquipmentHealthResult {
  const windowDays = 30;
  const openHoursPerDay = 16;
  const capacityMin = windowDays * openHoursPerDay * 60;

  let downtimeMin = 0;
  let down = 0;
  for (const e of equipment) {
    let mins = e.downtimeMin || 0;
    if (e.status === 'down') {
      down += 1;
      if (e.downSince) mins += Math.max(0, (now.getTime() - Date.parse(e.downSince)) / 60_000);
    }
    downtimeMin += Math.min(mins, capacityMin);
  }

  const capacity = equipment.length * capacityMin;
  return {
    health: capacity > 0 ? Math.max(0, 1 - downtimeMin / capacity) : 1,
    machines: equipment.length,
    down,
    downtimeMin: Math.round(downtimeMin),
    windowDays,
    openHoursPerDay,
  };
}

/**
 * The fields an Up/Down flip writes. Going down stamps `downSince`;
 * coming back banks the minutes it was out and clears the stamp (null
 * tells the service to delete the field).
 */
export function applyEquipmentStatus(
  eq: Pick<GymEquipment, 'status' | 'downSince' | 'downtimeMin'>,
  status: 'ok' | 'down',
  now: Date = new Date(),
): { status: 'ok' | 'down'; downtimeMin: number; downSince: string | null; updatedAt: string } {
  const at = now.toISOString();
  if (status === 'down') {
    // Already down: keep the original stamp rather than restarting the clock.
    return { status, downtimeMin: eq.downtimeMin, downSince: eq.downSince ?? at, updatedAt: at };
  }
  const elapsed = eq.status === 'down' && eq.downSince
    ? Math.max(0, Math.round((now.getTime() - Date.parse(eq.downSince)) / 60_000))
    : 0;
  return { status, downtimeMin: eq.downtimeMin + elapsed, downSince: null, updatedAt: at };
}
