#!/usr/bin/env node
// Rebuilds gyms/{gymId}/dailyStats/{date} aggregates from that gym's
// existing checkins collection — the one-time backfill for R4 (see
// docs/REVAMP_SPEC.md §7): the dashboard now reads dailyStats instead of
// scanning 30 days of raw checkins, but any check-ins recorded before
// checkinMember started denormalising dailyStats need this to catch up.
//
// Uses firebase-admin, authenticated via GOOGLE_APPLICATION_CREDENTIALS
// (a service-account JSON with Firestore admin access) + GOOGLE_CLOUD_PROJECT
// naming the zenith-fitness project (same convention as seed-demo-gym.mjs).
//
// Usage:
//   node scripts/backfill-gym-daily-stats.mjs --dry-run [gymId]   # prints the summary, writes nothing
//   node scripts/backfill-gym-daily-stats.mjs --write [gymId]     # overwrites gyms/{gymId}/dailyStats/*
//
// gymId defaults to demo-iron-temple. Overwrites (not increments) each
// dailyStats/{date} doc, so it's safe to re-run.

const args = process.argv.slice(2);
const MODE = args.includes('--write') ? 'write' : args.includes('--dry-run') ? 'dry-run' : null;
if (!MODE) {
  console.error('Usage: node scripts/backfill-gym-daily-stats.mjs --dry-run | --write [gymId]');
  process.exit(1);
}
const GYM_ID = args.find((a) => !a.startsWith('--')) || 'demo-iron-temple';

// Local-time hour bucketing must match the client (device local time).
// This script may run from CI or an operator's shell in any timezone, so
// bucket explicitly in Asia/Kolkata to match Zenith's gyms.
const HOUR_FORMATTER = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false });
function hourOfIST(iso) {
  const h = Number(HOUR_FORMATTER.format(new Date(iso)));
  return h === 24 ? 0 : h; // en-US hour12:false can format midnight as "24"
}

async function main() {
  const admin = await import('firebase-admin');
  if (!admin.default.apps.length) admin.default.initializeApp();
  const db = admin.default.firestore();

  console.log(`\nBackfilling dailyStats for gym ${GYM_ID} — ${MODE === 'write' ? 'APPLYING' : 'DRY RUN (nothing written)'}`);
  console.log('Reading checkins…');
  const snap = await db.collection('gyms').doc(GYM_ID).collection('checkins').get();
  console.log(`  ${snap.size} check-in docs read.`);

  const byDate = new Map(); // date -> { count, hours: Map<hour, count> }
  for (const docSnap of snap.docs) {
    const c = docSnap.data();
    if (!c.date || !c.at) continue;
    let entry = byDate.get(c.date);
    if (!entry) { entry = { count: 0, hours: new Map() }; byDate.set(c.date, entry); }
    entry.count += 1;
    const hour = hourOfIST(c.at);
    entry.hours.set(hour, (entry.hours.get(hour) ?? 0) + 1);
  }

  const dates = [...byDate.keys()].sort();
  const totalCheckins = [...byDate.values()].reduce((sum, e) => sum + e.count, 0);
  console.log(`  ${dates.length} distinct days, ${totalCheckins} check-ins aggregated.`);
  if (dates.length) console.log(`  range: ${dates[0]} .. ${dates[dates.length - 1]}`);

  if (MODE !== 'write') {
    console.log('\n(dry run — pass --write to actually write dailyStats docs)');
    return;
  }

  console.log('Writing dailyStats…');
  const col = db.collection('gyms').doc(GYM_ID).collection('dailyStats');
  const CHUNK = 400; // stay comfortably under Firestore's 500-op batch limit
  for (let i = 0; i < dates.length; i += CHUNK) {
    const batch = db.batch();
    for (const date of dates.slice(i, i + CHUNK)) {
      const entry = byDate.get(date);
      const hours = {};
      for (const [hour, count] of entry.hours) hours[String(hour)] = count;
      batch.set(col.doc(date), { date, count: entry.count, hours });
    }
    await batch.commit();
  }

  console.log(`\nDone — wrote ${dates.length} dailyStats docs for ${GYM_ID}.`);
}

main().catch((err) => {
  console.error('[backfill-gym-daily-stats] failed:', err);
  process.exit(1);
});
