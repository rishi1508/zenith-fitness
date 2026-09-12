/**
 * Activity log and diagnostics.
 *
 *   gyms/{gymId}/audit/{id}   who did what in a gym — written by the app after
 *                             a successful action (never awaited, never throws)
 *                             and by the server routes; read by managers/owners
 *                             in My Gym → Manage → Activity.
 *   clientErrors/{id}         uncaught errors from the app with the last few
 *                             screens the person visited; read by Zenith admins
 *                             in You → Admin → Errors.
 *   auditLogs/{id}            server-only events (account deletion, admin
 *                             console actions); admins read.
 *
 * Anonymous ratings are deliberately NOT logged here — an actor + session +
 * time entry would undo the anonymity api/rate.ts promises.
 */
import { Timestamp, addDoc, collection, getDocs, limit as fsLimit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { Capacitor } from '@capacitor/core';
import { auth, db } from './firebase';
import { readHint } from './gym/gymHint';
import { shouldReport, type AuditDetails, type AuditEntry, type AuditTarget, type ReportState } from './auditFormat';

export type { AuditEntry } from './auditFormat';

const RETENTION_DAYS = 180;
const platform = () => (Capacitor.isNativePlatform() ? Capacitor.getPlatform() : 'web');
const appVersion = () => (typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev');
const expiresAt = () => Timestamp.fromMillis(Date.now() + RETENTION_DAYS * 86_400_000);

function clean<T extends object>(o: T): T {
  const out = { ...(o as Record<string, unknown>) };
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out as unknown as T;
}

/**
 * Records one action in the gym's activity log. Fire-and-forget: the action
 * itself already succeeded, and a logging failure must never surface as an
 * error to the person who just did the work.
 */
export function recordAudit(gymId: string, input: { action: string; target?: AuditTarget; details?: AuditDetails }): void {
  const user = auth.currentUser;
  if (!user || !gymId) return;
  const now = new Date();
  const entry = clean({
    at: now.toISOString(),
    ts: now.getTime(),
    actorUid: user.uid,
    actorName: user.displayName || 'Member',
    action: input.action,
    target: input.target ? clean(input.target) : undefined,
    details: input.details ? clean(input.details) : undefined,
    source: 'app' as const,
    appVersion: appVersion(),
    platform: platform(),
    expiresAt: expiresAt(),
  });
  addDoc(collection(db, 'gyms', gymId, 'audit'), entry).catch((err) => console.warn('[audit] not recorded:', input.action, err));
}

/** Newest first; the view filters by category client-side. */
export function listenToAudit(gymId: string, cb: (entries: AuditEntry[]) => void, max = 200): () => void {
  return onSnapshot(
    query(collection(db, 'gyms', gymId, 'audit'), orderBy('ts', 'desc'), fsLimit(max)),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<AuditEntry, 'id'>) }))),
    (err) => console.warn('[audit] listener error:', err),
  );
}

// ----- diagnostics ------------------------------------------------------------

export interface ClientErrorDoc {
  id: string;
  at: string;
  ts: number;
  uid: string;
  gymId: string | null;
  message: string;
  stack?: string;
  source: 'error' | 'unhandledrejection' | 'boundary' | 'manual';
  view?: string;
  appVersion: string;
  platform: string;
  ua: string;
  breadcrumbs: Array<{ at: string; type: string; label: string }>;
}

const crumbs: Array<{ at: string; type: string; label: string }> = [];
let reportState: ReportState = { count: 0, recent: [] };
let installed = false;

/** Leaves a trail (last 20) that is attached to any error report. */
export function breadcrumb(type: string, label: string): void {
  crumbs.push({ at: new Date().toISOString(), type, label: label.slice(0, 80) });
  if (crumbs.length > 20) crumbs.shift();
}

/** Sends one error to clientErrors, throttled: at most 10 per session, no repeats within a minute. */
export function reportError(err: unknown, source: ClientErrorDoc['source'], extra?: string): void {
  const user = auth.currentUser;
  if (!user) return; // rules require a signed-in author; guests' errors stay in the console
  const message = (err instanceof Error ? err.message : typeof err === 'string' ? err : JSON.stringify(err ?? 'unknown')).slice(0, 500);
  const decision = shouldReport(reportState, message, Date.now());
  reportState = decision.state;
  if (!decision.send) return;
  const stack = err instanceof Error && err.stack ? err.stack.slice(0, 2000) : undefined;
  const now = new Date();
  const docBody = clean({
    at: now.toISOString(),
    ts: now.getTime(),
    uid: user.uid,
    gymId: readHint()?.gymId ?? null,
    message,
    stack: extra ? `${stack ?? ''}\n--\n${extra.slice(0, 1000)}`.trim() : stack,
    source,
    view: crumbs.filter((c) => c.type === 'view').at(-1)?.label,
    appVersion: appVersion(),
    platform: platform(),
    ua: navigator.userAgent.slice(0, 200),
    breadcrumbs: [...crumbs],
    expiresAt: expiresAt(),
  });
  addDoc(collection(db, 'clientErrors'), docBody).catch(() => { /* the console already has it */ });
}

/** Hooks the window's uncaught-error events once. Call from main.tsx. */
export function installDiagnostics(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('error', (e) => {
    // Resource load failures (an <img> 404) arrive here too, without an Error — skip them.
    if (!e.error && !e.message) return;
    reportError(e.error ?? e.message, 'error', e.filename ? `${e.filename}:${e.lineno}:${e.colno}` : undefined);
  });
  window.addEventListener('unhandledrejection', (e) => reportError(e.reason, 'unhandledrejection'));
}

/** Admin: the newest error reports. */
export async function listClientErrors(max = 100): Promise<ClientErrorDoc[]> {
  const snap = await getDocs(query(collection(db, 'clientErrors'), orderBy('ts', 'desc'), fsLimit(max)));
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ClientErrorDoc, 'id'>) }));
}
