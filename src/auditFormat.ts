/**
 * Pure helpers for the activity log: what an entry is called on screen and
 * which filter chip it belongs under. No I/O, so tests/audit.test.ts can
 * cover every action string.
 */

export type AuditCategory = 'members' | 'payments' | 'checkins' | 'content' | 'settings' | 'account';

export interface AuditTarget { type: string; id?: string; name?: string }
export type AuditDetails = Record<string, string | number | boolean | null>;

export interface AuditEntry {
  id: string;
  at: string;
  ts: number;
  actorUid: string;
  actorName: string;
  action: string;
  target?: AuditTarget;
  details?: AuditDetails;
  source: 'app' | 'server';
  appVersion?: string;
  platform?: string;
}

const CATEGORY: Record<string, AuditCategory> = {
  'member.create': 'members', 'member.add': 'members', 'member.update': 'members', 'member.remove': 'members',
  'member.leave': 'members', 'membership.renew': 'members', 'staff.role': 'members', 'member.account-deleted': 'account',
  'payment.record': 'payments',
  'checkin.create': 'checkins', 'code.rotate': 'checkins', 'attendance.mark': 'checkins',
  'class.save': 'content', 'class.delete': 'content', 'announcement.post': 'content', 'announcement.delete': 'content',
  'exercise.save': 'content', 'exercise.delete': 'content', 'plan.publish': 'content', 'plan.delete': 'content', 'plan.adopt': 'content',
  'gym.update': 'settings', 'equipment.save': 'settings', 'equipment.status': 'settings', 'equipment.delete': 'settings',
};

export function auditCategory(action: string): AuditCategory {
  return CATEGORY[action] ?? 'settings';
}

const inr = (n: unknown) => (typeof n === 'number' ? `₹${n.toLocaleString('en-IN')}` : '');

/** One line, in the owner's words: who did what, to whom. */
export function describeAudit(e: Pick<AuditEntry, 'action' | 'actorName' | 'target' | 'details'>): string {
  const who = e.actorName || 'Someone';
  const t = e.target?.name ? e.target.name : e.target?.type ?? '';
  const d = e.details ?? {};
  switch (e.action) {
    case 'member.create':
    case 'member.add': return `${who} added ${t || 'a member'}${d.existed ? ' (existing Zenith account)' : ''}`;
    case 'member.update': return `${who} updated ${t || 'a member'}${d.fields ? ` (${d.fields})` : ''}`;
    case 'member.remove': return `${who} removed ${t || 'a member'}`;
    case 'member.leave': return `${who} left the gym`;
    case 'member.account-deleted': return `${t || 'A member'} deleted their Zenith account`;
    case 'membership.renew': return `${who} renewed ${t || 'a member'}${d.planName ? ` on ${d.planName}` : ''}${d.planEnd ? ` until ${d.planEnd}` : ''}`;
    case 'staff.role': return d.role ? `${who} made ${t || 'a member'} ${d.role}` : `${who} removed ${t || 'a member'} from staff`;
    case 'payment.record': return `${who} recorded ${inr(d.amount)} from ${t || 'a member'}${d.method ? ` by ${d.method}` : ''}${d.category && d.category !== 'membership' ? ` (${d.category})` : ''}`;
    case 'checkin.create': return d.self ? `${who} checked in${d.method ? ` by ${d.method}` : ''}` : `${who} checked in ${t || 'a member'}${d.method ? ` (${d.method})` : ''}`;
    case 'code.rotate': return `${who} rotated today's check-in code`;
    case 'attendance.mark': return `${who} marked ${t || 'a member'} ${d.attended ? 'attended' : 'not attended'}${d.className ? ` at ${d.className}` : ''}`;
    case 'class.save': return `${who} ${d.created ? 'created' : 'edited'} the class ${t}`;
    case 'class.delete': return `${who} deleted the class ${t}`;
    case 'announcement.post': return `${who} posted an announcement${t ? `: “${t}”` : ''}`;
    case 'announcement.delete': return `${who} deleted an announcement${t ? `: “${t}”` : ''}`;
    case 'exercise.save': return `${who} ${d.created ? 'added' : 'edited'} the exercise ${t}`;
    case 'exercise.delete': return `${who} removed the exercise ${t}`;
    case 'plan.publish': return `${who} shared the plan ${t} with the gym`;
    case 'plan.delete': return `${who} removed the plan ${t}`;
    case 'plan.adopt': return `${who} started the plan ${t}`;
    case 'gym.update': return `${who} changed gym settings${d.fields ? ` (${d.fields})` : ''}`;
    case 'equipment.save': return `${who} ${d.created ? 'added' : 'renamed'} the machine ${t}`;
    case 'equipment.status': return `${who} marked ${t} ${d.status === 'down' ? 'out of service' : 'back in service'}`;
    case 'equipment.delete': return `${who} removed the machine ${t}`;
    default: return `${who} · ${e.action}${t ? ` · ${t}` : ''}`;
  }
}

/** "just now", "5 min ago", "Yesterday 18:40", "12 Sept 09:15". */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const t = new Date(iso);
  const diff = now.getTime() - t.getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  const sameDay = t.toDateString() === now.toDateString();
  const hm = t.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
  if (sameDay) return `Today ${hm}`;
  const y = new Date(now); y.setDate(y.getDate() - 1);
  if (t.toDateString() === y.toDateString()) return `Yesterday ${hm}`;
  return `${t.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} ${hm}`;
}

// ----- diagnostics throttle (pure) -------------------------------------------

export interface ReportState { count: number; recent: Array<{ key: string; ts: number }> }
export const MAX_REPORTS_PER_SESSION = 10;
export const DEDUPE_WINDOW_MS = 60_000;

/** Whether an error should be sent, and the state after deciding. */
export function shouldReport(state: ReportState, message: string, now: number): { send: boolean; state: ReportState } {
  const key = message.slice(0, 120);
  const recent = state.recent.filter((r) => now - r.ts < DEDUPE_WINDOW_MS);
  if (state.count >= MAX_REPORTS_PER_SESSION || recent.some((r) => r.key === key)) return { send: false, state: { ...state, recent } };
  return { send: true, state: { count: state.count + 1, recent: [...recent, { key, ts: now }] } };
}
