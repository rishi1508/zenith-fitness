import {
  doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc, onSnapshot,
  query, where, orderBy, limit as fsLimit, documentId, writeBatch, arrayUnion, arrayRemove,
  increment, deleteField,
} from 'firebase/firestore';
import type { QueryConstraint, DocumentSnapshot } from 'firebase/firestore';
import { auth, db } from './firebase';
import { deliverPush } from './pushService';
import { membershipStatus, localDateISO, addMonthsISO } from './gymStats';
import type {
  Gym, GymPlan, GymMember, GymPayment, GymCheckin, GymClass, GymClassSession, GymAnnouncement,
  GymContext, GymRole, CheckinMethod, PaymentMethod, MembershipStatus, UserProfile,
} from './types';

/**
 * Gym OS lite (Tier A) — Firestore service module, in the style of
 * workoutSessionService.ts: plain async functions + onSnapshot listeners
 * that return an unsubscribe fn. See docs/GYM_TIER_A_SPEC.md §5.
 *
 * Pure logic (membership status, class scheduling, QR payloads,
 * dashboard aggregation) lives in gymStats.ts and is re-exported below
 * so callers only need to import from here.
 */

// Re-export the pure helpers so gymService is the one-stop import for consumers.
export { membershipStatus, upcomingSessions, gymQrPayload, memberQrPayload, parseQrPayload, computeDashboard } from './gymStats';

function stripUndefined<T extends object>(o: T): T {
  const copy = { ...o };
  for (const k of Object.keys(copy) as (keyof T)[]) if (copy[k] === undefined) delete copy[k];
  return copy;
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digestBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digestBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function generateJoinCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let out = '';
  for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

const DEFAULT_PLANS: GymPlan[] = [
  { id: 'plan_1m', name: '1 Month', months: 1, price: 2500, active: true },
  { id: 'plan_3m', name: '3 Months', months: 3, price: 6000, active: true },
  { id: 'plan_6m', name: '6 Months', months: 6, price: 10000, active: true },
  { id: 'plan_12m', name: '12 Months', months: 12, price: 15000, active: true },
];

// ============ MEMBERSHIP CONTEXT ============

/** Reads the caller's cached gym pointer from userProfiles/{me}.gym. */
export function getMyGymContext(): Promise<GymContext | null> {
  const user = auth.currentUser;
  if (!user) return Promise.resolve(null);
  const extract = (snap: DocumentSnapshot): GymContext | null =>
    snap.exists() ? ((snap.data() as { gym?: GymContext | null }).gym ?? null) : null;
  return new Promise((resolve, reject) => {
    // Right after sign-in the app merges heartbeat/profile fields into
    // this doc before it's in the local cache; until that write is
    // acknowledged the SDK's latency-compensated view of the doc is just
    // those pending fields (no `gym`), so a plain getDoc reports "no gym".
    // Wait for a settled snapshot instead — bounded, so an offline start
    // with a queued write still resolves with whatever the cache holds.
    let latest: DocumentSnapshot | null = null;
    let unsub = () => {};
    const timer = setTimeout(() => {
      unsub();
      if (latest) resolve(extract(latest));
      else reject(new Error('Profile unavailable'));
    }, 8000);
    unsub = onSnapshot(
      doc(db, 'userProfiles', user.uid),
      (snap) => {
        latest = snap;
        if (snap.metadata.hasPendingWrites) return;
        clearTimeout(timer);
        unsub();
        resolve(extract(snap));
      },
      (err) => { clearTimeout(timer); unsub(); reject(err); },
    );
  });
}

/** Live-subscribes to a gym doc. */
export function listenToGym(gymId: string, cb: (g: Gym | null) => void): () => void {
  return onSnapshot(
    doc(db, 'gyms', gymId),
    (snap) => cb(snap.exists() ? ({ id: snap.id, ...snap.data() } as Gym) : null),
    (err) => console.warn('[Gym] gym listener error:', err),
  );
}

/** Live-subscribes to the caller's own membership doc for a gym. */
export function listenToMyMembership(gymId: string, cb: (m: GymMember | null) => void): () => void {
  const user = auth.currentUser;
  if (!user) { cb(null); return () => {}; }
  return onSnapshot(
    doc(db, 'gyms', gymId, 'members', user.uid),
    (snap) => cb(snap.exists() ? (snap.data() as GymMember) : null),
    (err) => console.warn('[Gym] membership listener error:', err),
  );
}

/** Joins a gym by its 6-char code: looks up gymJoinCodes, creates the
 *  caller's own members/{uid} doc (role 'member'), bumps memberCount,
 *  and caches the pointer on the caller's profile. */
export async function joinGymByCode(code: string): Promise<{ gym: Gym; member: GymMember }> {
  const user = auth.currentUser;
  if (!user) throw new Error('Not authenticated');

  const normalized = code.trim().toUpperCase();
  const codeSnap = await getDoc(doc(db, 'gymJoinCodes', normalized));
  if (!codeSnap.exists()) throw new Error('Invalid join code');
  const { gymId } = codeSnap.data() as { gymId: string };

  const gymSnap = await getDoc(doc(db, 'gyms', gymId));
  if (!gymSnap.exists()) throw new Error('Gym not found');
  const gym = { id: gymSnap.id, ...gymSnap.data() } as Gym;

  const memberRef = doc(db, 'gyms', gymId, 'members', user.uid);
  const existingSnap = await getDoc(memberRef);
  const now = new Date().toISOString();
  const member: GymMember = existingSnap.exists()
    ? (existingSnap.data() as GymMember)
    : stripUndefined({
        uid: user.uid,
        name: user.displayName || 'Member',
        email: user.email || undefined,
        photoURL: user.photoURL || null,
        role: 'member',
        joinedAt: now,
      });

  const batch = writeBatch(db);
  if (!existingSnap.exists()) {
    batch.set(memberRef, member);
    batch.update(doc(db, 'gyms', gymId), { memberCount: increment(1) });
  }
  const context: GymContext = { gymId, gymRole: member.role, joinedAt: member.joinedAt };
  batch.set(doc(db, 'userProfiles', user.uid), { gym: context }, { merge: true });
  await batch.commit();

  return { gym, member };
}

/**
 * Member-initiated "leave" — clears the cached gym pointer on the
 * caller's own profile (self-writable per firestore.rules' base
 * userProfiles rule). The members/{uid} doc and the gym's memberCount
 * are staff-owned per rules (deleting a member doc requires
 * manager/admin), so an ordinary member leaving does not remove their
 * membership record — a manager/owner uses removeMember for that.
 */
export async function leaveGym(gymId: string): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('Not authenticated');
  const context = await getMyGymContext();
  if (context?.gymId !== gymId) return; // already left, or mismatched gym — nothing to do
  await setDoc(doc(db, 'userProfiles', user.uid), { gym: null }, { merge: true });
}

// ============ GYM ADMIN ============

/** Creates a gym owned by the caller: writes the gym doc, its join
 *  code, the owner's own member doc, and the profile pointer in one
 *  batch. Plans default to the four demo plans when omitted. */
export async function createGym(input: { name: string; address?: string; phone?: string; plans?: GymPlan[] }): Promise<Gym> {
  const user = auth.currentUser;
  if (!user) throw new Error('Not authenticated');

  const gymId = doc(collection(db, 'gyms')).id;
  const joinCode = generateJoinCode();
  const now = new Date().toISOString();

  const gym: Gym = stripUndefined({
    id: gymId,
    name: input.name,
    address: input.address,
    phone: input.phone,
    ownerUid: user.uid,
    staff: { [user.uid]: 'owner' },
    joinCode,
    plans: input.plans && input.plans.length ? input.plans : DEFAULT_PLANS,
    memberCount: 1,
    createdAt: now,
    subscriptionStatus: 'pilot',
  });
  const member: GymMember = stripUndefined({
    uid: user.uid,
    name: user.displayName || 'Owner',
    email: user.email || undefined,
    photoURL: user.photoURL || null,
    role: 'owner',
    joinedAt: now,
  });
  const context: GymContext = { gymId, gymRole: 'owner', joinedAt: now };

  const batch = writeBatch(db);
  batch.set(doc(db, 'gyms', gymId), gym);
  batch.set(doc(db, 'gymJoinCodes', joinCode), { gymId });
  batch.set(doc(db, 'gyms', gymId, 'members', user.uid), member);
  batch.set(doc(db, 'userProfiles', user.uid), { gym: context }, { merge: true });
  await batch.commit();

  return gym;
}

/** Owner/manager: update gym profile fields (not staff, plans handled
 *  the same way here, join code, or daily code — those go through
 *  dedicated functions to match the narrower rule grants they have).
 *  `subscriptionStatus`/`pilotEndsAt`/`notes` are admin-only in practice
 *  (firestore.rules' `isAdmin()` OR-clause on the gym doc) — used by
 *  AdminGymsView's edit sheet. */
export async function updateGym(
  gymId: string,
  patch: Partial<Pick<Gym, 'name' | 'logoUrl' | 'accentColor' | 'address' | 'phone' | 'plans' | 'subscriptionStatus' | 'pilotEndsAt' | 'notes'>>,
): Promise<void> {
  await updateDoc(doc(db, 'gyms', gymId), stripUndefined({ ...patch }));
}

/** Zenith-admin only (firestore.rules' `isAdmin()` OR-clause on
 *  `gyms` create): creates a gym owned by `ownerUid`, who need not be
 *  the caller. Same batch shape as `createGym`, but the owner's member
 *  doc is populated from their existing `userProfiles` doc instead of
 *  `auth.currentUser`. Used by AdminGymsView's "New gym" sheet, which
 *  looks the owner up by email first. */
export async function createGymForOwner(
  input: { name: string; address?: string; phone?: string; plans?: GymPlan[] },
  ownerUid: string,
): Promise<Gym> {
  const ownerSnap = await getDoc(doc(db, 'userProfiles', ownerUid));
  const owner = ownerSnap.exists() ? (ownerSnap.data() as UserProfile) : null;

  const gymId = doc(collection(db, 'gyms')).id;
  const joinCode = generateJoinCode();
  const now = new Date().toISOString();

  const gym: Gym = stripUndefined({
    id: gymId,
    name: input.name,
    address: input.address,
    phone: input.phone,
    ownerUid,
    staff: { [ownerUid]: 'owner' },
    joinCode,
    plans: input.plans && input.plans.length ? input.plans : DEFAULT_PLANS,
    memberCount: 1,
    createdAt: now,
    subscriptionStatus: 'pilot',
  });
  const member: GymMember = stripUndefined({
    uid: ownerUid,
    name: owner?.displayName || 'Owner',
    email: owner?.email || undefined,
    photoURL: owner?.photoURL || null,
    role: 'owner',
    joinedAt: now,
  });
  const context: GymContext = { gymId, gymRole: 'owner', joinedAt: now };

  const batch = writeBatch(db);
  batch.set(doc(db, 'gyms', gymId), gym);
  batch.set(doc(db, 'gymJoinCodes', joinCode), { gymId });
  batch.set(doc(db, 'gyms', gymId, 'members', ownerUid), member);
  batch.set(doc(db, 'userProfiles', ownerUid), { gym: context }, { merge: true });
  await batch.commit();

  return gym;
}

/** Zenith-admin only: every gym, for AdminGymsView's list. */
export async function listAllGyms(): Promise<Gym[]> {
  const snap = await getDocs(collection(db, 'gyms'));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Gym);
}

/** Owner-only: grants/revokes a staff role. Keeps members/{uid}.role in
 *  sync so the members directory reflects the same role immediately. */
export async function setStaffRole(gymId: string, uid: string, role: Exclude<GymRole, 'member'> | null): Promise<void> {
  const batch = writeBatch(db);
  const gymRef = doc(db, 'gyms', gymId);
  const memberRef = doc(db, 'gyms', gymId, 'members', uid);
  if (role) {
    batch.update(gymRef, { [`staff.${uid}`]: role });
    batch.update(memberRef, { role });
  } else {
    batch.update(gymRef, { [`staff.${uid}`]: deleteField() });
    batch.update(memberRef, { role: 'member' });
  }
  await batch.commit();
}

// ============ MEMBERS ============

/** One-shot member list (≤600 docs per the cost-discipline note in the
 *  spec), filtered client-side. */
export async function listMembers(
  gymId: string,
  opts?: { status?: MembershipStatus; trainerUid?: string; search?: string; limit?: number },
): Promise<GymMember[]> {
  const snap = await getDocs(query(collection(db, 'gyms', gymId, 'members'), fsLimit(opts?.limit ?? 600)));
  let members = snap.docs.map((d) => d.data() as GymMember);
  if (opts?.trainerUid) members = members.filter((m) => m.trainerUid === opts.trainerUid);
  if (opts?.status) members = members.filter((m) => membershipStatus(m) === opts.status);
  if (opts?.search) {
    const term = opts.search.trim().toLowerCase();
    members = members.filter((m) => m.name.toLowerCase().includes(term) || (m.phone ?? '').includes(term));
  }
  return members;
}

/** Live-subscribes to the full members directory (staff screens only). */
export function listenToMembers(gymId: string, cb: (members: GymMember[]) => void): () => void {
  return onSnapshot(
    collection(db, 'gyms', gymId, 'members'),
    (snap) => cb(snap.docs.map((d) => d.data() as GymMember)),
    (err) => console.warn('[Gym] members listener error:', err),
  );
}

/** Manager: adds a member. Links an existing auth user's uid when their
 *  email matches a userProfiles doc; otherwise generates a `manual_<id>`
 *  uid for a walk-in with no app account yet. */
export async function addMember(
  gymId: string,
  input: { name: string; phone?: string; email?: string; planId?: string; planStart?: string; trainerUid?: string; notes?: string },
): Promise<GymMember> {
  let uid = `manual_${crypto.randomUUID()}`;
  let linkedUid: string | null = null;
  if (input.email) {
    const normalizedEmail = input.email.trim().toLowerCase();
    const snap = await getDocs(query(collection(db, 'userProfiles'), where('email', '==', normalizedEmail), fsLimit(1)));
    if (!snap.empty) {
      linkedUid = snap.docs[0].id;
      uid = linkedUid;
    }
  }

  const now = new Date().toISOString();
  const gymSnap = await getDoc(doc(db, 'gyms', gymId));
  const gym = gymSnap.exists() ? (gymSnap.data() as Gym) : null;
  const plan = gym?.plans.find((p) => p.id === input.planId);
  const planStart = input.planId ? (input.planStart ?? now) : undefined;
  const planEnd = plan && planStart ? addMonthsISO(planStart, plan.months) : undefined;

  const member: GymMember = stripUndefined({
    uid,
    name: input.name,
    phone: input.phone,
    email: input.email,
    photoURL: null,
    role: 'member',
    joinedAt: now,
    planId: input.planId,
    planStart,
    planEnd,
    trainerUid: input.trainerUid,
    notes: input.notes,
  });

  const batch = writeBatch(db);
  batch.set(doc(db, 'gyms', gymId, 'members', uid), member);
  batch.update(doc(db, 'gyms', gymId), { memberCount: increment(1) });
  if (linkedUid) {
    const context: GymContext = { gymId, gymRole: 'member', joinedAt: now };
    batch.set(doc(db, 'userProfiles', linkedUid), { gym: context }, { merge: true });
  }
  await batch.commit();
  return member;
}

/** Generic member-doc patch. Caller is responsible for only sending
 *  fields their role is allowed to write (see firestore.rules). */
export async function updateMember(gymId: string, uid: string, patch: Partial<GymMember>): Promise<void> {
  await updateDoc(doc(db, 'gyms', gymId, 'members', uid), stripUndefined({ ...patch }));
}

/** Manager/owner: removes a member and decrements memberCount. */
export async function removeMember(gymId: string, uid: string): Promise<void> {
  const batch = writeBatch(db);
  batch.delete(doc(db, 'gyms', gymId, 'members', uid));
  batch.update(doc(db, 'gyms', gymId), { memberCount: increment(-1) });
  await batch.commit();
}

/** Extends a member's plan by the chosen plan's duration.
 *  `startFrom: 'today'` (default) starts a fresh period from today —
 *  use for a lapsed/expired member. `'planEnd'` extends from their
 *  current planEnd instead, so a member renewing early doesn't lose
 *  the remaining days on their current plan. */
export async function renewMembership(
  gymId: string,
  uid: string,
  planId: string,
  startFrom: 'today' | 'planEnd' = 'today',
): Promise<void> {
  const memberRef = doc(db, 'gyms', gymId, 'members', uid);
  const [gymSnap, memberSnap] = await Promise.all([getDoc(doc(db, 'gyms', gymId)), getDoc(memberRef)]);
  if (!gymSnap.exists()) throw new Error('Gym not found');
  if (!memberSnap.exists()) throw new Error('Member not found');
  const gym = gymSnap.data() as Gym;
  const member = memberSnap.data() as GymMember;
  const plan = gym.plans.find((p) => p.id === planId);
  if (!plan) throw new Error('Plan not found');

  const today = localDateISO(new Date());
  // Only extend from planEnd while it's still in the future — a lapsed
  // member renewing after their plan ended starts a fresh period from
  // today rather than back-dating it to the old end.
  const extendFromExisting = startFrom === 'planEnd' && !!member.planEnd && member.planEnd.slice(0, 10) >= today;
  const base = extendFromExisting ? (member.planEnd as string) : today;
  const planStart = extendFromExisting ? (member.planStart ?? today) : today;
  const planEnd = addMonthsISO(base, plan.months);

  await updateDoc(memberRef, stripUndefined({ planId, planStart, planEnd, frozen: false }));
}

// ============ PAYMENTS ============

/** Manager: records a payment and renews the member's plan (extending
 *  from their current planEnd when they still have time left, so an
 *  early renewal doesn't waste remaining days). */
export async function recordPayment(
  gymId: string,
  input: { uid: string; amount: number; method: PaymentMethod; months: number; planId?: string; note?: string; paidAt?: string },
): Promise<GymPayment> {
  const user = auth.currentUser;
  if (!user) throw new Error('Not authenticated');

  const paymentId = doc(collection(db, 'gyms', gymId, 'payments')).id;
  const payment: GymPayment = stripUndefined({
    id: paymentId,
    uid: input.uid,
    amount: input.amount,
    method: input.method,
    paidAt: input.paidAt ?? new Date().toISOString(),
    months: input.months,
    planId: input.planId,
    note: input.note,
    recordedBy: user.uid,
  });
  await setDoc(doc(db, 'gyms', gymId, 'payments', paymentId), payment);
  if (input.planId) {
    await renewMembership(gymId, input.uid, input.planId, 'planEnd');
  }
  return payment;
}

export async function listPayments(gymId: string, opts?: { uid?: string; sinceISO?: string; limit?: number }): Promise<GymPayment[]> {
  const col = collection(db, 'gyms', gymId, 'payments');
  const limit = opts?.limit ?? 200;
  if (opts?.uid) {
    // Per-member history: `uid ==` combined with an order/range on `paidAt`
    // needs a composite index, so fetch by uid alone (a member has at most
    // a few dozen payments) and filter/sort client-side.
    const snap = await getDocs(query(col, where('uid', '==', opts.uid), fsLimit(limit)));
    return snap.docs
      .map((d) => d.data() as GymPayment)
      .filter((p) => !opts.sinceISO || p.paidAt >= opts.sinceISO)
      .sort((a, b) => b.paidAt.localeCompare(a.paidAt));
  }
  const constraints: QueryConstraint[] = [];
  if (opts?.sinceISO) constraints.push(where('paidAt', '>=', opts.sinceISO));
  constraints.push(orderBy('paidAt', 'desc'));
  constraints.push(fsLimit(limit));
  const snap = await getDocs(query(col, ...constraints));
  return snap.docs.map((d) => d.data() as GymPayment);
}

// ============ CHECK-IN ============

/** Idempotent per member per local day (doc id `${uid}_${YYYY-MM-DD}`).
 *  A repeat call for the same member/day returns the existing check-in
 *  untouched instead of creating a duplicate or re-bumping the
 *  denormalised counters. */
export async function checkinMember(gymId: string, uid: string, method: CheckinMethod): Promise<{ created: boolean; checkin: GymCheckin }> {
  const user = auth.currentUser;
  if (!user) throw new Error('Not authenticated');

  const date = localDateISO(new Date());
  const checkinId = `${uid}_${date}`;
  const ref = doc(db, 'gyms', gymId, 'checkins', checkinId);
  // Idempotency probe. A member reading their OWN check-in is allowed by
  // rules via `resource.data.uid`, which errors (→ permission-denied) when
  // the doc doesn't exist yet — i.e. exactly the first check-in of the
  // day. Treat that denial as "not there yet" and go on to create it;
  // staff can read any check-in so they never hit this branch.
  try {
    const existing = await getDoc(ref);
    if (existing.exists()) {
      return { created: false, checkin: existing.data() as GymCheckin };
    }
  } catch (err) {
    if ((err as { code?: string }).code !== 'permission-denied') throw err;
  }

  const checkin: GymCheckin = { id: checkinId, uid, at: new Date().toISOString(), date, method, byUid: user.uid };
  await setDoc(ref, checkin, { merge: true });

  try {
    await updateDoc(doc(db, 'gyms', gymId, 'members', uid), {
      lastCheckinAt: checkin.at,
      checkinCount30d: increment(1),
    });
  } catch (err) {
    console.warn('[Gym] checkinMember: member denorm update failed:', err);
  }

  return { created: true, checkin };
}

/** Staff (trainer+): rotates the daily check-in code — a fresh random
 *  6-digit code, stored as a hash + date on the gym doc. Returns the
 *  plain code for display on the desk. */
export async function rotateDailyCode(gymId: string): Promise<string> {
  const code = String(Math.floor(100_000 + Math.random() * 900_000));
  const date = localDateISO(new Date());
  const hash = await sha256Hex(`${code}:${date}:${gymId}`);
  await updateDoc(doc(db, 'gyms', gymId), { dailyCodeHash: hash, dailyCodeDate: date });
  return code;
}

/** Pure-ish check (async because it hashes with crypto.subtle): does
 *  `code` match today's rotated code for this gym? */
export async function verifyDailyCode(gym: Gym, code: string): Promise<boolean> {
  if (!gym.dailyCodeHash || !gym.dailyCodeDate) return false;
  const date = localDateISO(new Date());
  if (gym.dailyCodeDate !== date) return false;
  const hash = await sha256Hex(`${code}:${date}:${gym.id}`);
  return hash === gym.dailyCodeHash;
}

export async function listCheckins(gymId: string, opts: { sinceISO: string; uid?: string; limit?: number }): Promise<GymCheckin[]> {
  const col = collection(db, 'gyms', gymId, 'checkins');
  const limit = opts.limit ?? 500;
  if (opts.uid) {
    // Per-member history. `uid ==` + range on `at` would need a composite
    // index; instead order by document id — ids are `${uid}_${date}`, so
    // within one uid that's date order — which the automatic single-field
    // index on `uid` already supports, and trim to `sinceISO` client-side.
    const snap = await getDocs(query(col, where('uid', '==', opts.uid), orderBy(documentId(), 'desc'), fsLimit(limit)));
    return snap.docs.map((d) => d.data() as GymCheckin).filter((c) => c.at >= opts.sinceISO);
  }
  const snap = await getDocs(query(col, where('at', '>=', opts.sinceISO), orderBy('at', 'desc'), fsLimit(limit)));
  return snap.docs.map((d) => d.data() as GymCheckin);
}

// ============ CLASSES ============

export async function listClasses(gymId: string): Promise<GymClass[]> {
  const snap = await getDocs(collection(db, 'gyms', gymId, 'classes'));
  return snap.docs.map((d) => d.data() as GymClass);
}

export function listenToClasses(gymId: string, cb: (classes: GymClass[]) => void): () => void {
  return onSnapshot(
    collection(db, 'gyms', gymId, 'classes'),
    (snap) => cb(snap.docs.map((d) => d.data() as GymClass)),
    (err) => console.warn('[Gym] classes listener error:', err),
  );
}

/** Manager: creates (no `id`) or updates (with `id`) a class. */
export async function saveClass(gymId: string, cls: Omit<GymClass, 'id'> & { id?: string }): Promise<GymClass> {
  const id = cls.id ?? doc(collection(db, 'gyms', gymId, 'classes')).id;
  const saved: GymClass = stripUndefined({ ...cls, id });
  await setDoc(doc(db, 'gyms', gymId, 'classes', id), saved);
  return saved;
}

export async function deleteClass(gymId: string, id: string): Promise<void> {
  await deleteDoc(doc(db, 'gyms', gymId, 'classes', id));
}

export function listenToSession(
  gymId: string, classId: string, date: string, cb: (session: GymClassSession | null) => void,
): () => void {
  return onSnapshot(
    doc(db, 'gyms', gymId, 'classes', classId, 'sessions', date),
    (snap) => cb(snap.exists() ? (snap.data() as GymClassSession) : null),
    (err) => console.warn('[Gym] session listener error:', err),
  );
}

/** Enrols `uid` into a class session (creating the session doc on first
 *  enrolment). Respects capacity when the class has one — a client-side
 *  check only, matching the spec's cost-discipline note that this isn't
 *  enforced server-side for Tier A. */
export async function enrol(gymId: string, classId: string, date: string, uid: string): Promise<void> {
  const ref = doc(db, 'gyms', gymId, 'classes', classId, 'sessions', date);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    const session: GymClassSession = { id: `${classId}_${date}`, classId, date, enrolled: [uid], attended: [] };
    await setDoc(ref, session);
    return;
  }
  const session = snap.data() as GymClassSession;
  if (!session.enrolled.includes(uid)) {
    const classSnap = await getDoc(doc(db, 'gyms', gymId, 'classes', classId));
    const capacity = classSnap.exists() ? (classSnap.data() as GymClass).capacity : undefined;
    if (capacity !== undefined && session.enrolled.length >= capacity) {
      throw new Error('Class is full');
    }
  }
  await updateDoc(ref, { enrolled: arrayUnion(uid) });
}

export async function unenrol(gymId: string, classId: string, date: string, uid: string): Promise<void> {
  await updateDoc(doc(db, 'gyms', gymId, 'classes', classId, 'sessions', date), { enrolled: arrayRemove(uid) });
}

/** Staff: marks (or un-marks) a member as attended for a session,
 *  creating the session doc on first use. */
export async function markAttendance(gymId: string, classId: string, date: string, uid: string, attended: boolean): Promise<void> {
  const ref = doc(db, 'gyms', gymId, 'classes', classId, 'sessions', date);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    const session: GymClassSession = { id: `${classId}_${date}`, classId, date, enrolled: attended ? [uid] : [], attended: attended ? [uid] : [] };
    await setDoc(ref, session);
    return;
  }
  await updateDoc(ref, { attended: attended ? arrayUnion(uid) : arrayRemove(uid) });
}

// ============ ANNOUNCEMENTS ============

/** Staff: posts an announcement and best-effort pushes it to members
 *  (cap 300, failures ignored — the announcement itself is never lost
 *  even if push fan-out fails). Tier A has no persistent per-class
 *  roster (only per-session enrolled lists), so a class-scoped audience
 *  still notifies every gym member — a documented limitation. */
export async function postAnnouncement(gymId: string, text: string, audience: 'all' | { classId: string }): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('Not authenticated');

  const id = doc(collection(db, 'gyms', gymId, 'announcements')).id;
  const announcement: GymAnnouncement = {
    id, text, audience, byUid: user.uid, byName: user.displayName || 'Staff', at: new Date().toISOString(),
  };
  await setDoc(doc(db, 'gyms', gymId, 'announcements', id), announcement);

  try {
    const members = await listMembers(gymId, { limit: 300 });
    await Promise.all(members.map((m) =>
      deliverPush({
        recipientUid: m.uid,
        title: 'Gym announcement',
        body: text,
        data: { gymId, type: 'gym_announcement' },
      }).catch(() => { /* best-effort — logged inside deliverPush */ })
    ));
  } catch (err) {
    console.warn('[Gym] announcement push fan-out failed:', err);
  }
}

export function listenToAnnouncements(gymId: string, cb: (items: GymAnnouncement[]) => void, limit = 30): () => void {
  const q = query(collection(db, 'gyms', gymId, 'announcements'), orderBy('at', 'desc'), fsLimit(limit));
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => d.data() as GymAnnouncement)),
    (err) => console.warn('[Gym] announcements listener error:', err),
  );
}
