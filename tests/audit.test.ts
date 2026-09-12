import { describe, it, expect } from 'vitest';
import { auditCategory, describeAudit, relativeTime, shouldReport, MAX_REPORTS_PER_SESSION } from '../src/auditFormat';

describe('describeAudit', () => {
  it('reads as a sentence for the desk actions', () => {
    expect(describeAudit({ action: 'payment.record', actorName: 'Priya', target: { type: 'member', name: 'Arjun' }, details: { amount: 2500, method: 'upi', category: 'membership' } }))
      .toBe('Priya recorded ₹2,500 from Arjun by upi');
    expect(describeAudit({ action: 'payment.record', actorName: 'Priya', target: { type: 'member', name: 'Arjun' }, details: { amount: 1200, method: 'cash', category: 'pt' } }))
      .toBe('Priya recorded ₹1,200 from Arjun by cash (pt)');
    expect(describeAudit({ action: 'member.remove', actorName: 'Priya', target: { type: 'member', name: 'Arjun' } })).toBe('Priya removed Arjun');
    expect(describeAudit({ action: 'checkin.create', actorName: 'Arjun', details: { self: true, method: 'code' } })).toBe('Arjun checked in by code');
    expect(describeAudit({ action: 'checkin.create', actorName: 'Priya', target: { type: 'member', name: 'Arjun' }, details: { self: false, method: 'manual' } })).toBe('Priya checked in Arjun (manual)');
    expect(describeAudit({ action: 'staff.role', actorName: 'Owner', target: { type: 'member', name: 'Priya' }, details: { role: 'trainer' } })).toBe('Owner made Priya trainer');
    expect(describeAudit({ action: 'staff.role', actorName: 'Owner', target: { type: 'member', name: 'Priya' }, details: { role: null } })).toBe('Owner removed Priya from staff');
    expect(describeAudit({ action: 'equipment.status', actorName: 'Owner', target: { type: 'equipment', name: 'Treadmill 2' }, details: { status: 'down' } })).toBe('Owner marked Treadmill 2 out of service');
  });

  it('never throws on an unknown action', () => {
    expect(describeAudit({ action: 'future.thing', actorName: 'X', target: { type: 't', name: 'Y' } })).toBe('X · future.thing · Y');
    expect(describeAudit({ action: 'future.thing', actorName: '' })).toBe('Someone · future.thing');
  });
});

describe('auditCategory', () => {
  it('buckets actions for the filter chips', () => {
    expect(auditCategory('payment.record')).toBe('payments');
    expect(auditCategory('code.rotate')).toBe('checkins');
    expect(auditCategory('plan.adopt')).toBe('content');
    expect(auditCategory('gym.update')).toBe('settings');
    expect(auditCategory('member.account-deleted')).toBe('account');
    expect(auditCategory('whatever')).toBe('settings');
  });
});

describe('relativeTime', () => {
  const now = new Date('2026-09-13T10:00:00');
  it('speaks in minutes, then today/yesterday, then a date', () => {
    expect(relativeTime('2026-09-13T09:59:40', now)).toBe('just now');
    expect(relativeTime('2026-09-13T09:45:00', now)).toBe('15 min ago');
    expect(relativeTime('2026-09-13T07:05:00', now)).toBe('Today 07:05');
    expect(relativeTime('2026-09-12T18:40:00', now)).toBe('Yesterday 18:40');
    expect(relativeTime('2026-09-01T09:15:00', now)).toMatch(/^1 Sept? 09:15$/);
  });
});

describe('shouldReport', () => {
  it('sends new messages, dedupes repeats within a minute, caps per session', () => {
    let st = { count: 0, recent: [] as Array<{ key: string; ts: number }> };
    let d = shouldReport(st, 'boom', 1_000); expect(d.send).toBe(true); st = d.state;
    d = shouldReport(st, 'boom', 20_000); expect(d.send).toBe(false); st = d.state;
    d = shouldReport(st, 'boom', 70_000); expect(d.send).toBe(true); st = d.state;
    for (let i = 0; i < MAX_REPORTS_PER_SESSION; i++) { d = shouldReport(st, `e${i}`, 100_000 + i); st = d.state; }
    expect(st.count).toBe(MAX_REPORTS_PER_SESSION);
    expect(shouldReport(st, 'one more', 200_000).send).toBe(false);
  });
});
