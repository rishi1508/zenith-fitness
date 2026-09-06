#!/usr/bin/env node
// Seeds (or re-seeds) a single demo gym — "Iron Temple Fitness"
// (gyms/demo-iron-temple) — with fictional plans, staff, members,
// payments, check-ins, and classes so the Gym OS lite Tier A screens
// have something realistic to show during QA. See
// docs/GYM_TIER_A_SPEC.md §7.
//
// Uses firebase-admin, authenticated via GOOGLE_APPLICATION_CREDENTIALS
// (a service-account JSON with Firestore + Auth admin access for the
// zenith-fitness project).
//
// Usage:
//   node scripts/seed-demo-gym.mjs --dry-run   # prints the plan, touches nothing
//   node scripts/seed-demo-gym.mjs --write     # wipes + recreates the demo gym
//
// Idempotent: --write always recursively deletes gyms/demo-iron-temple
// (and the fixed gymJoinCodes/IRON01 lookup doc) before recreating it,
// so re-running never duplicates data and never touches any other gym.
// All names/phone numbers below are fictional.

const MODE = process.argv.includes('--write') ? 'write' : process.argv.includes('--dry-run') ? 'dry-run' : null;
if (!MODE) {
  console.error('Usage: node scripts/seed-demo-gym.mjs --dry-run | --write');
  process.exit(1);
}

const GYM_ID = 'demo-iron-temple';
const GYM_NAME = 'Iron Temple Fitness';
const JOIN_CODE = 'IRON01'; // fixed so wipe/recreate is idempotent
const OWNER_UID = 'BXedteurc3bPydsehvPIdVWPTbM2'; // Rishi — mirrors src/admin.ts
const OWNER_TEST_EMAIL = 'demo.owner@zenith-fitness.test';
const MEMBER_TEST_EMAIL = 'demo.member@zenith-fitness.test';

const MEMBER_COUNT = 250;
const CHECKIN_HISTORY_DAYS = 90;
const CLASS_SESSION_PAST_DAYS = 14;
const CLASS_SESSION_FUTURE_DAYS = 7;

// ---------- deterministic PRNG (so --dry-run prints a stable plan) ----------
function mulberry32(seed) {
  return function rand() {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(1337);
function pick(arr) { return arr[Math.floor(rand() * arr.length)]; }
function randInt(min, max) { return min + Math.floor(rand() * (max - min + 1)); }
function chance(p) { return rand() < p; }

// ---------- date helpers (local time, date-only where noted) ----------
function localDateISO(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
function addDays(base, n) { const d = new Date(base); d.setDate(d.getDate() + n); return d; }
function addMonths(base, n) { const d = new Date(base); d.setMonth(d.getMonth() + n); return d; }
function atHour(base, hour, minute = 0) { const d = new Date(base); d.setHours(hour, minute, randInt(0, 59), 0); return d; }

const NOW = new Date();

// ---------- fictional name / phone generators ----------
const FIRST_NAMES = [
  'Aarav', 'Vivaan', 'Aditya', 'Vihaan', 'Arjun', 'Sai', 'Reyansh', 'Ayaan', 'Krishna', 'Ishaan',
  'Rohan', 'Karan', 'Nikhil', 'Rahul', 'Amit', 'Sanjay', 'Vikram', 'Manish', 'Suresh', 'Ramesh',
  'Ananya', 'Diya', 'Aadhya', 'Saanvi', 'Myra', 'Anika', 'Riya', 'Kiara', 'Aarohi', 'Ira',
  'Priya', 'Neha', 'Pooja', 'Anjali', 'Kavya', 'Meera', 'Sneha', 'Divya', 'Shreya', 'Nisha',
];
const LAST_NAMES = [
  'Sharma', 'Verma', 'Gupta', 'Kumar', 'Singh', 'Patel', 'Reddy', 'Nair', 'Iyer', 'Rao',
  'Mehta', 'Joshi', 'Chopra', 'Kapoor', 'Malhotra', 'Bhatt', 'Desai', 'Shah', 'Agarwal', 'Bose',
];
function fictionalName(used) {
  let name;
  do { name = `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`; } while (used.has(name));
  used.add(name);
  return name;
}
function fictionalPhone() { return `+91 9${String(randInt(0, 99999999)).padStart(8, '0')}`; }

// ---------- plans ----------
const PLANS = [
  { id: 'plan_1m', name: '1 Month', months: 1, price: 2500, active: true },
  { id: 'plan_3m', name: '3 Months', months: 3, price: 6000, active: true },
  { id: 'plan_6m', name: '6 Months', months: 6, price: 10000, active: true },
  { id: 'plan_12m', name: '12 Months', months: 12, price: 15000, active: true },
];
// 1m 40% / 3m 30% / 6m 20% / 12m 10%
function pickPlan() {
  const r = rand();
  if (r < 0.40) return PLANS[0];
  if (r < 0.70) return PLANS[1];
  if (r < 0.90) return PLANS[2];
  return PLANS[3];
}

// ---------- classes (Mon-Sat) ----------
// weekday: 0=Sun..6=Sat. Spin runs on alternating days (Mon/Wed).
const CLASS_DEFS = [
  { name: 'Aerobics', weekday: 1, startTime: '06:30', durationMin: 45, capacity: 25 },
  { name: 'Zumba', weekday: 2, startTime: '07:30', durationMin: 45, capacity: 30 },
  { name: 'Yoga', weekday: 3, startTime: '08:00', durationMin: 60, capacity: 20 },
  { name: 'Circuit Training', weekday: 4, startTime: '18:30', durationMin: 45, capacity: 20 },
  { name: 'HIIT', weekday: 5, startTime: '19:30', durationMin: 45, capacity: 20 },
  { name: 'Spin', weekday: 1, startTime: '19:00', durationMin: 45, capacity: 15 },
  { name: 'Spin', weekday: 3, startTime: '19:00', durationMin: 45, capacity: 15 },
  { name: 'Core & Strength', weekday: 6, startTime: '09:00', durationMin: 45, capacity: 25 },
];

// ---------- membership status buckets ----------
// ~15% expired, ~8% expiring in 7 days, ~5% frozen, remainder active.
function computeMembershipDates(plan) {
  const r = rand();
  if (r < 0.15) {
    const planEnd = addDays(NOW, -randInt(1, 60));
    return { planStart: localDateISO(addMonths(planEnd, -plan.months)), planEnd: localDateISO(planEnd), frozen: false };
  }
  if (r < 0.23) {
    const planEnd = addDays(NOW, randInt(1, 7));
    return { planStart: localDateISO(addMonths(planEnd, -plan.months)), planEnd: localDateISO(planEnd), frozen: false };
  }
  if (r < 0.28) {
    const planEnd = addDays(NOW, randInt(10, 200));
    return { planStart: localDateISO(addMonths(planEnd, -plan.months)), planEnd: localDateISO(planEnd), frozen: true };
  }
  // active — plan period comfortably straddles today
  const maxLead = Math.min(Math.max(10, plan.months * 30 - 10), 300);
  const planStart = addDays(NOW, -randInt(0, maxLead));
  return { planStart: localDateISO(planStart), planEnd: localDateISO(addMonths(planStart, plan.months)), frozen: false };
}

// ---------- build the in-memory plan (pure — same in both modes) ----------
function buildPlan() {
  const usedNames = new Set();

  const trainers = Array.from({ length: 6 }, (_, i) => ({
    uid: `demo_trainer_${i + 1}`,
    name: fictionalName(usedNames),
    role: 'trainer',
    joinedAt: localDateISO(addMonths(NOW, -randInt(6, 20))),
  }));

  const members = Array.from({ length: MEMBER_COUNT }, (_, i) => {
    const plan = pickPlan();
    const { planStart, planEnd, frozen } = computeMembershipDates(plan);
    const joinedAt = localDateISO(addDays(NOW, -randInt(1, 420))); // over the last 14 months
    return {
      uid: `demo_member_${i + 1}`, // index 0 (demo_member_1) is re-linked to MEMBER_TEST_EMAIL's real auth uid at write time
      name: fictionalName(usedNames),
      phone: fictionalPhone(),
      role: 'member',
      joinedAt,
      planId: plan.id,
      planStart,
      planEnd,
      frozen,
      trainerUid: trainers[i % trainers.length].uid,
      payment: {
        amount: plan.price,
        method: pick(['upi', 'cash', 'card']),
        paidAt: new Date(planStart + 'T10:00:00').toISOString(),
        months: plan.months,
        planId: plan.id,
      },
    };
  });

  // Check-ins: 2-5 visits/week per non-frozen member, weighted to
  // 6-9am / 6-9pm, Sunday quiet. Guarantees every non-frozen member has
  // at least one check-in in the last 10 days, so the demo dashboard's
  // at-risk list starts empty (per spec: "at-risk members: none in 14+ days").
  const PEAK_HOURS = [6, 6, 6, 7, 7, 7, 8, 8, 8, 18, 18, 18, 19, 19, 19, 20, 20, 20];
  const OFFPEAK_HOURS = [10, 12, 14, 16, 21];
  const checkins = [];
  for (const m of members) {
    if (m.frozen) continue;
    const visitsPerWeek = randInt(2, 5);
    const baseProb = visitsPerWeek / 7;
    let sawRecent = false;
    for (let daysAgo = CHECKIN_HISTORY_DAYS - 1; daysAgo >= 0; daysAgo--) {
      const date = addDays(NOW, -daysAgo);
      const sundayFactor = date.getDay() === 0 ? 0.3 : 1;
      if (!chance(baseProb * sundayFactor)) continue;
      const hour = chance(0.85) ? pick(PEAK_HOURS) : pick(OFFPEAK_HOURS);
      const at = atHour(date, hour);
      checkins.push({ uid: m.uid, at: at.toISOString(), date: localDateISO(date), method: 'code', byUid: m.uid });
      if (daysAgo <= 9) sawRecent = true;
    }
    if (!sawRecent) {
      const date = addDays(NOW, -randInt(1, 8));
      const at = atHour(date, pick(PEAK_HOURS));
      checkins.push({ uid: m.uid, at: at.toISOString(), date: localDateISO(date), method: 'code', byUid: m.uid });
    }
  }
  // Denormalise lastCheckinAt / checkinCount30d onto each member from the generated check-ins.
  for (const m of members) {
    const mine = checkins.filter((c) => c.uid === m.uid);
    if (mine.length) {
      m.lastCheckinAt = mine.reduce((latest, c) => (c.at > latest ? c.at : latest), mine[0].at);
      const cutoff = localDateISO(addDays(NOW, -30));
      m.checkinCount30d = mine.filter((c) => c.date >= cutoff).length;
    }
  }

  // Classes + sessions (last 14 days .. next 7 days).
  const classes = CLASS_DEFS.map((c, i) => ({
    id: `demo_class_${i + 1}`,
    name: c.name,
    weekday: c.weekday,
    startTime: c.startTime,
    durationMin: c.durationMin,
    capacity: c.capacity,
    trainerUid: trainers[i % trainers.length].uid,
    active: true,
  }));
  const sessions = [];
  for (const cls of classes) {
    for (let offset = -CLASS_SESSION_PAST_DAYS; offset <= CLASS_SESSION_FUTURE_DAYS; offset++) {
      const date = addDays(NOW, offset);
      if (date.getDay() !== cls.weekday) continue;
      const isPast = offset < 0;
      const roster = members.filter((m) => !m.frozen && rand() < 0.18).slice(0, cls.capacity ?? Infinity);
      const enrolled = roster.map((m) => m.uid);
      const attended = isPast ? enrolled.filter(() => chance(0.75)) : [];
      sessions.push({ classId: cls.id, date: localDateISO(date), enrolled, attended });
    }
  }

  return { trainers, members, checkins, classes, sessions };
}

function printSummary(plan) {
  const { trainers, members, checkins, classes, sessions } = plan;
  const expired = members.filter((m) => m.planEnd < localDateISO(NOW) && !m.frozen).length;
  const frozen = members.filter((m) => m.frozen).length;
  const expiringSoon = members.filter((m) => !m.frozen && m.planEnd >= localDateISO(NOW) && m.planEnd <= localDateISO(addDays(NOW, 7))).length;

  console.log(`\nGym OS lite demo seed — ${MODE === 'write' ? 'APPLYING' : 'DRY RUN (nothing written)'}`);
  console.log(`  gym:        ${GYM_NAME} (${GYM_ID}), join code ${JOIN_CODE}`);
  console.log(`  owner:      ${OWNER_UID} (Rishi) + test account ${OWNER_TEST_EMAIL}`);
  console.log(`  member QA:  ${MEMBER_TEST_EMAIL} → linked to ${members[0].name} (${members[0].uid})`);
  console.log(`  plans:      ${PLANS.map((p) => `${p.name} ₹${p.price}`).join(', ')}`);
  console.log(`  trainers:   ${trainers.length} (${trainers.map((t) => t.name).join(', ')})`);
  console.log(`  members:    ${members.length} total — ${expired} expired, ${expiringSoon} expiring ≤7d, ${frozen} frozen`);
  console.log(`  check-ins:  ${checkins.length} over the last ${CHECKIN_HISTORY_DAYS} days`);
  console.log(`  classes:    ${classes.length} (${classes.map((c) => `${c.name} d${c.weekday} ${c.startTime}`).join(', ')})`);
  console.log(`  sessions:   ${sessions.length} (last ${CLASS_SESSION_PAST_DAYS}d + next ${CLASS_SESSION_FUTURE_DAYS}d)`);
  console.log(`  sample member: ${JSON.stringify(members[1], null, 2)}`);
}

// ---------- Firestore application (write mode only) ----------
async function applyPlan(plan) {
  const admin = await import('firebase-admin');
  if (!admin.default.apps.length) admin.default.initializeApp();
  const db = admin.default.firestore();
  const auth = admin.default.auth();

  async function commitInChunks(ops) {
    const CHUNK = 400; // stay comfortably under Firestore's 500-op batch limit
    for (let i = 0; i < ops.length; i += CHUNK) {
      const batch = db.batch();
      for (const op of ops.slice(i, i + CHUNK)) {
        if (op.type === 'set') batch.set(op.ref, op.data, op.options ?? {});
        else if (op.type === 'delete') batch.delete(op.ref);
      }
      await batch.commit();
    }
  }

  async function getOrCreateAuthUser(email, displayName) {
    try {
      return await auth.getUserByEmail(email);
    } catch {
      return auth.createUser({ email, displayName, emailVerified: true });
    }
  }

  console.log('\nWiping any existing demo gym…');
  await db.recursiveDelete(db.collection('gyms').doc(GYM_ID));
  await db.collection('gymJoinCodes').doc(JOIN_CODE).delete().catch(() => {});

  console.log('Provisioning test auth accounts…');
  const ownerTestUser = await getOrCreateAuthUser(OWNER_TEST_EMAIL, 'Demo Owner (QA)');
  const memberTestUser = await getOrCreateAuthUser(MEMBER_TEST_EMAIL, plan.members[0].name);
  // Re-point the first seeded member at the real QA auth uid so signing
  // in as demo.member@… lands on a populated membership.
  plan.members[0] = { ...plan.members[0], uid: memberTestUser.uid };
  for (const c of plan.checkins) {
    if (c.uid === `demo_member_1`) c.uid = memberTestUser.uid;
  }
  for (const s of plan.sessions) {
    s.enrolled = s.enrolled.map((uid) => (uid === 'demo_member_1' ? memberTestUser.uid : uid));
    s.attended = s.attended.map((uid) => (uid === 'demo_member_1' ? memberTestUser.uid : uid));
  }

  const now = new Date().toISOString();
  const staff = { [OWNER_UID]: 'owner', [ownerTestUser.uid]: 'owner' };
  for (const t of plan.trainers) staff[t.uid] = 'trainer';

  const gym = {
    id: GYM_ID,
    name: GYM_NAME,
    address: 'MG Road, Bengaluru',
    phone: '+91 9800000000',
    ownerUid: OWNER_UID,
    staff,
    joinCode: JOIN_CODE,
    plans: PLANS,
    memberCount: plan.members.length + plan.trainers.length + 2, // + Rishi + the QA owner test account
    createdAt: now,
    subscriptionStatus: 'pilot',
  };

  console.log('Writing gym + staff + members…');
  const ops = [];
  ops.push({ type: 'set', ref: db.collection('gyms').doc(GYM_ID), data: gym });
  ops.push({ type: 'set', ref: db.collection('gymJoinCodes').doc(JOIN_CODE), data: { gymId: GYM_ID } });
  ops.push({
    type: 'set',
    ref: db.collection('gyms').doc(GYM_ID).collection('members').doc(OWNER_UID),
    data: { uid: OWNER_UID, name: 'Rishi', role: 'owner', joinedAt: now },
  });
  ops.push({
    type: 'set',
    ref: db.collection('gyms').doc(GYM_ID).collection('members').doc(ownerTestUser.uid),
    data: { uid: ownerTestUser.uid, name: 'Demo Owner (QA)', email: OWNER_TEST_EMAIL, role: 'owner', joinedAt: now },
  });
  for (const t of plan.trainers) {
    ops.push({ type: 'set', ref: db.collection('gyms').doc(GYM_ID).collection('members').doc(t.uid), data: t });
  }
  for (const m of plan.members) {
    const memberDoc = { ...m };
    delete memberDoc.payment; // payment history goes to the payments subcollection below, not the member doc
    ops.push({ type: 'set', ref: db.collection('gyms').doc(GYM_ID).collection('members').doc(m.uid), data: memberDoc });
  }
  await commitInChunks(ops);

  console.log('Writing payments…');
  const paymentOps = plan.members.map((m) => {
    const id = db.collection('gyms').doc(GYM_ID).collection('payments').doc().id;
    return {
      type: 'set',
      ref: db.collection('gyms').doc(GYM_ID).collection('payments').doc(id),
      data: { id, uid: m.uid, amount: m.payment.amount, method: m.payment.method, paidAt: m.payment.paidAt, months: m.payment.months, planId: m.payment.planId, recordedBy: OWNER_UID },
    };
  });
  await commitInChunks(paymentOps);

  console.log('Writing check-ins…');
  const checkinOps = plan.checkins.map((c) => ({
    type: 'set',
    ref: db.collection('gyms').doc(GYM_ID).collection('checkins').doc(`${c.uid}_${c.date}`),
    data: { id: `${c.uid}_${c.date}`, ...c },
    options: { merge: true },
  }));
  await commitInChunks(checkinOps);

  console.log('Writing classes + sessions…');
  const classOps = plan.classes.map((c) => ({ type: 'set', ref: db.collection('gyms').doc(GYM_ID).collection('classes').doc(c.id), data: c }));
  await commitInChunks(classOps);
  const sessionOps = plan.sessions.map((s) => ({
    type: 'set',
    ref: db.collection('gyms').doc(GYM_ID).collection('classes').doc(s.classId).collection('sessions').doc(s.date),
    data: { id: `${s.classId}_${s.date}`, classId: s.classId, date: s.date, enrolled: s.enrolled, attended: s.attended },
  }));
  await commitInChunks(sessionOps);

  console.log('Pointing profiles at the demo gym…');
  const gymContext = (role) => ({ gymId: GYM_ID, gymRole: role, joinedAt: now });
  await db.collection('userProfiles').doc(OWNER_UID).set({ gym: gymContext('owner') }, { merge: true });
  await db.collection('userProfiles').doc(ownerTestUser.uid).set({
    uid: ownerTestUser.uid, displayName: 'Demo Owner (QA)', email: OWNER_TEST_EMAIL,
    joinedAt: now, totalWorkouts: 0, currentStreak: 0, isWorkingOut: false,
    gym: gymContext('owner'),
  }, { merge: true });
  await db.collection('userProfiles').doc(memberTestUser.uid).set({
    uid: memberTestUser.uid, displayName: plan.members[0].name, email: MEMBER_TEST_EMAIL,
    joinedAt: now, totalWorkouts: 0, currentStreak: 0, isWorkingOut: false,
    gym: gymContext('member'),
  }, { merge: true });

  console.log('\nDone — demo gym seeded.');
}

async function main() {
  const plan = buildPlan();
  printSummary(plan);
  if (MODE === 'write') {
    await applyPlan(plan);
  } else {
    console.log('\n(dry run — pass --write to actually seed Firestore)');
  }
}

main().catch((err) => {
  console.error('[seed-demo-gym] failed:', err);
  process.exit(1);
});
