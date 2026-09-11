import { describe, it, expect } from 'vitest';
import {
  acquisitionChurnSeries, applyEquipmentStatus, clvCac, computeMrr, equipmentHealth, formatInr,
  revenueSplit, slippingAway, trainerUtilisation,
} from '../src/gym/gymOps';
import type { GymCheckin, GymClass, GymClassSession, GymEquipment, GymMember, GymPayment, GymPlan } from '../src/types';

const NOW = new Date('2026-09-12T10:00:00+05:30');
const DAY = 86_400_000;

const PLANS: GymPlan[] = [
  { id: 'plan_1m', name: '1 Month', months: 1, price: 2500, active: true },
  { id: 'plan_3m', name: '3 Months', months: 3, price: 3000, active: true },
];

function member(over: Partial<GymMember> & { uid: string }): GymMember {
  return { name: over.uid, role: 'member', joinedAt: '2026-01-10T00:00:00.000Z', ...over };
}

function checkin(uid: string, daysAgo: number): GymCheckin {
  const at = new Date(NOW.getTime() - daysAgo * DAY);
  return { id: `${uid}_${daysAgo}`, uid, at: at.toISOString(), date: at.toISOString().slice(0, 10), method: 'code', byUid: uid };
}

function payment(over: Partial<GymPayment> & { id: string; amount: number }): GymPayment {
  return { uid: 'u1', method: 'upi', paidAt: NOW.toISOString(), months: 1, recordedBy: 'staff', ...over };
}

describe('formatInr', () => {
  it('groups the Indian way and drops the paise', () => {
    expect(formatInr(365700)).toBe('₹3,65,700');
    expect(formatInr(2500)).toBe('₹2,500');
    expect(formatInr(999.6)).toBe('₹1,000');
    expect(formatInr(0)).toBe('₹0');
    expect(formatInr(-4200)).toBe('-₹4,200');
  });
});

describe('computeMrr', () => {
  it('normalises a multi-month plan to one month', () => {
    const members = [member({ uid: 'a', planId: 'plan_3m', planStart: '2026-08-01', planEnd: '2026-11-01' })];
    expect(computeMrr(members, PLANS, NOW).mrr).toBe(1000);
  });

  it('counts expiring members and skips expired, frozen and planless ones', () => {
    const members = [
      member({ uid: 'active', planId: 'plan_1m', planStart: '2026-09-01', planEnd: '2026-10-01' }),
      member({ uid: 'expiring', planId: 'plan_1m', planStart: '2026-08-15', planEnd: '2026-09-15' }),
      member({ uid: 'expired', planId: 'plan_1m', planStart: '2026-07-01', planEnd: '2026-08-01' }),
      member({ uid: 'frozen', planId: 'plan_1m', planStart: '2026-09-01', planEnd: '2026-10-01', frozen: true }),
      member({ uid: 'noplan' }),
    ];
    expect(computeMrr(members, PLANS, NOW).mrr).toBe(5000);
  });

  it('compares against the roster of 30 days ago', () => {
    const members = [
      // On the books then and now.
      member({ uid: 'stayed', planId: 'plan_1m', planStart: '2026-07-01', planEnd: '2026-10-01' }),
      // Joined since — lifts MRR by half.
      member({ uid: 'joined', planId: 'plan_1m', planStart: '2026-09-05', planEnd: '2026-10-05' }),
    ];
    const { mrr, prevMrr, changePct } = computeMrr(members, PLANS, NOW);
    expect(prevMrr).toBe(2500);
    expect(mrr).toBe(5000);
    expect(changePct).toBe(100);
  });

  it('has no percentage to report without a base', () => {
    expect(computeMrr([], PLANS, NOW).changePct).toBeNull();
  });
});

describe('acquisitionChurnSeries', () => {
  it('buckets twelve months across the year boundary, oldest first', () => {
    const series = acquisitionChurnSeries([], NOW);
    expect(series).toHaveLength(12);
    expect(series[0].month).toBe('Oct 25');
    expect(series[2].month).toBe('Dec 25');
    expect(series[3].month).toBe('Jan 26');
    expect(series[11].month).toBe('Sep 26');
  });

  it('counts joins and lapsed plans into their own months, and nets them', () => {
    const members = [
      member({ uid: 'j1', joinedAt: '2026-07-04T08:00:00.000Z' }),
      member({ uid: 'j2', joinedAt: '2026-07-29T08:00:00.000Z' }),
      member({ uid: 'j3', joinedAt: '2025-12-15T08:00:00.000Z' }),
      // Lapsed in July and never came back.
      member({ uid: 'c1', joinedAt: '2026-01-02T00:00:00.000Z', planEnd: '2026-07-20' }),
      // Renewed — their planEnd now sits in the future, so July is clean.
      member({ uid: 'r1', joinedAt: '2026-01-02T00:00:00.000Z', planEnd: '2026-12-20' }),
      // Frozen members are on hold, not gone.
      member({ uid: 'f1', joinedAt: '2026-01-02T00:00:00.000Z', planEnd: '2026-07-08', frozen: true }),
    ];
    const byMonth = new Map(acquisitionChurnSeries(members, NOW).map((m) => [m.month, m]));
    expect(byMonth.get('Jul 26')).toEqual({ month: 'Jul 26', new: 2, churned: 1, net: 1 });
    expect(byMonth.get('Dec 25')).toEqual({ month: 'Dec 25', new: 1, churned: 0, net: 1 });
  });

  it('gives a plan that ended in the last week time to renew', () => {
    const justLapsed = [member({ uid: 'x', planEnd: '2026-09-09' })];
    const goneAWhile = [member({ uid: 'y', planEnd: '2026-09-01' })];
    const bySeries = (ms: GymMember[]) => acquisitionChurnSeries(ms, NOW).find((m) => m.month === 'Sep 26')!.churned;
    expect(bySeries(justLapsed)).toBe(0);
    expect(bySeries(goneAWhile)).toBe(1);
  });

  it('ignores staff — a new trainer is not a signup', () => {
    const staff = [member({ uid: 't1', role: 'trainer', joinedAt: '2026-07-04T08:00:00.000Z' })];
    expect(acquisitionChurnSeries(staff, NOW).find((m) => m.month === 'Jul 26')!.new).toBe(0);
  });
});

describe('slippingAway', () => {
  const live = { planId: 'plan_1m', planStart: '2026-08-20', planEnd: '2026-10-20' };

  it('flags a member whose visits more than halved', () => {
    const members = [member({ uid: 'drifting', ...live })];
    const checkins = [
      ...[40, 45, 50, 55].map((d) => checkin('drifting', d)),
      checkin('drifting', 5),
    ];
    expect(slippingAway(checkins, members, NOW).members.map((m) => m.uid)).toEqual(['drifting']);
  });

  it('treats exactly half as holding steady, not slipping', () => {
    const members = [member({ uid: 'steady', ...live })];
    const checkins = [
      ...[40, 45, 50, 55].map((d) => checkin('steady', d)),
      ...[3, 9].map((d) => checkin('steady', d)),
    ];
    expect(slippingAway(checkins, members, NOW).members).toHaveLength(0);
  });

  it('needs two visits in the earlier window before a drop means anything', () => {
    const members = [member({ uid: 'oneoff', ...live })];
    expect(slippingAway([checkin('oneoff', 45)], members, NOW).members).toHaveLength(0);
  });

  it('measures against the members who are actually on a plan', () => {
    const members = [
      member({ uid: 'a', ...live }),
      member({ uid: 'b', ...live }),
      member({ uid: 'lapsed', planId: 'plan_1m', planStart: '2026-05-01', planEnd: '2026-06-01' }),
    ];
    expect(slippingAway([], members, NOW).activeCount).toBe(2);
  });
});

describe('clvCac', () => {
  const members = [
    member({ uid: 'a', joinedAt: '2026-03-12T00:00:00.000Z', planId: 'plan_1m', planStart: '2026-09-01', planEnd: '2026-10-01' }),
    member({ uid: 'b', joinedAt: '2026-09-01T00:00:00.000Z', planId: 'plan_1m', planStart: '2026-09-01', planEnd: '2026-10-01' }),
  ];
  const payments90d = [payment({ id: 'p1', amount: 9000 }), payment({ id: 'p2', amount: 9000 })];

  it('prices a member against what they cost to win', () => {
    const out = clvCac({ members, payments90d, marketingSpendMonthly: 6000, now: NOW });
    expect(out.arpu).toBe(3000);            // ₹18,000 over 90 days ÷ 3 ÷ 2 active
    expect(out.newMembers30d).toBe(1);      // only 'b' joined inside 30 days
    expect(out.cac).toBe(6000);
    expect(out.ratio).toBeCloseTo(out.clv / 6000, 10);
    expect(out.tenureMonths).toBeGreaterThan(3);
  });

  it('has no cost side until the owner records a spend', () => {
    const out = clvCac({ members, payments90d, now: NOW });
    expect(out.cac).toBeNull();
    expect(out.ratio).toBeNull();
    expect(out.clv).toBeGreaterThan(0);
  });

  it('holds up with nobody on the books', () => {
    const out = clvCac({ members: [], payments90d: [], marketingSpendMonthly: 5000, now: NOW });
    expect(out).toMatchObject({ clv: 0, arpu: 0, cac: null, ratio: null, newMembers30d: 0 });
  });
});

describe('revenueSplit', () => {
  it('splits by category, defaulting the untagged to membership', () => {
    const payments = [
      payment({ id: 'p1', amount: 200000 }),
      payment({ id: 'p2', amount: 100000, category: 'membership' }),
      payment({ id: 'p3', amount: 45700, category: 'pt' }),
      payment({ id: 'p4', amount: 20000, category: 'other' }),
      payment({ id: 'old', amount: 999999, paidAt: new Date(NOW.getTime() - 120 * DAY).toISOString() }),
      // An advance renewal dated next month is not money taken this quarter.
      payment({ id: 'future', amount: 777777, paidAt: new Date(NOW.getTime() + 30 * DAY).toISOString() }),
    ];
    const out = revenueSplit(payments, NOW);
    expect(out.total).toBe(365700);
    expect(formatInr(out.total)).toBe('₹3,65,700');
    expect(out.slices.map((s) => s.amount)).toEqual([300000, 45700, 20000]);
    expect(out.slices.map((s) => s.pct).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('rounds thirds so the legend still adds to 100', () => {
    const payments = [
      payment({ id: 'a', amount: 100, category: 'membership' }),
      payment({ id: 'b', amount: 100, category: 'pt' }),
      payment({ id: 'c', amount: 100, category: 'other' }),
    ];
    const out = revenueSplit(payments, NOW);
    expect(out.slices.map((s) => s.pct)).toEqual([34, 33, 33]);
  });

  it('reports zeroes rather than NaN when nothing was taken', () => {
    const out = revenueSplit([], NOW);
    expect(out.total).toBe(0);
    expect(out.slices.map((s) => s.pct)).toEqual([0, 0, 0]);
    expect(out.slices.every((s) => s.share === 0)).toBe(true);
  });
});

describe('trainerUtilisation', () => {
  const classes: GymClass[] = [
    { id: 'c1', name: 'Zumba', weekday: 1, startTime: '07:30', durationMin: 60, trainerUid: 't1', active: true },
    { id: 'c2', name: 'Yoga', weekday: 3, startTime: '08:00', durationMin: 45, trainerUid: 't1', active: true },
    { id: 'c3', name: 'Retired', weekday: 5, startTime: '18:00', durationMin: 60, trainerUid: 't1', active: false },
  ];

  it('scores the classes that ran against the ones on the timetable', () => {
    // Two Mondays of the last four had somebody marked attended.
    const sessions: GymClassSession[] = [
      { id: 's1', classId: 'c1', date: '2026-09-07', enrolled: ['a'], attended: ['a'] },
      { id: 's2', classId: 'c1', date: '2026-08-31', enrolled: ['a'], attended: ['a'] },
      { id: 's3', classId: 'c1', date: '2026-08-24', enrolled: ['a'], attended: [] },
    ];
    const out = trainerUtilisation({
      classes, sessions,
      members: [member({ uid: 't1', name: 'Asha', role: 'trainer' })],
      staff: { t1: 'trainer' }, now: NOW,
    });
    expect(out.trainers).toHaveLength(1);
    expect(out.trainers[0].name).toBe('Asha');
    expect(out.trainers[0].scheduled).toBe(8);   // 4 Mondays + 4 Wednesdays; the inactive class is not scheduled
    expect(out.trainers[0].ran).toBe(2);
    expect(out.trainers[0].utilisation).toBeCloseTo(0.25, 10);
    expect(out.trainers[0].hoursPerWeek).toBeCloseTo(1.75, 10);
    expect(out.utilisation).toBeCloseTo(0.25, 10);
  });

  it('lists a trainer with no classes rather than dividing by zero', () => {
    const out = trainerUtilisation({ classes: [], sessions: [], members: [], staff: { t9: 'trainer' }, now: NOW });
    expect(out.trainers[0]).toMatchObject({ uid: 't9', scheduled: 0, ran: 0, utilisation: 0 });
    expect(out.utilisation).toBe(0);
  });
});

describe('equipment', () => {
  const machine = (over: Partial<GymEquipment> = {}): GymEquipment => ({
    id: 'm1', name: 'Leg press', status: 'ok', downtimeMin: 0, updatedAt: NOW.toISOString(), ...over,
  });

  it('banks the minutes a machine was out over a down → up cycle', () => {
    const wentDown = applyEquipmentStatus(machine(), 'down', new Date(NOW.getTime() - 2 * 3600_000));
    expect(wentDown.downSince).toBe(new Date(NOW.getTime() - 2 * 3600_000).toISOString());
    expect(wentDown.downtimeMin).toBe(0);

    const cameBack = applyEquipmentStatus(
      machine({ status: 'down', downSince: wentDown.downSince ?? undefined, downtimeMin: wentDown.downtimeMin }),
      'ok',
      NOW,
    );
    expect(cameBack.downtimeMin).toBe(120);
    expect(cameBack.downSince).toBeNull();

    const health = equipmentHealth([machine({ downtimeMin: cameBack.downtimeMin })], NOW);
    expect(health.health).toBeCloseTo(1 - 120 / (30 * 16 * 60), 10);
    expect(health.down).toBe(0);
    expect(health.machines).toBe(1);
  });

  it('keeps counting while a machine is still down', () => {
    const out = equipmentHealth(
      [machine({ status: 'down', downSince: new Date(NOW.getTime() - 60 * 60_000).toISOString(), downtimeMin: 30 })],
      NOW,
    );
    expect(out.downtimeMin).toBe(90);
    expect(out.down).toBe(1);
  });

  it('never reports worse than nothing, and is a clean 100% with no machines', () => {
    expect(equipmentHealth([machine({ downtimeMin: 999_999 })], NOW).health).toBe(0);
    expect(equipmentHealth([], NOW).health).toBe(1);
  });
});
