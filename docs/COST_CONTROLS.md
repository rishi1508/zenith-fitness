# Cost controls (Blaze, since 2026-09-07)

The project runs on Firebase Blaze so daily free quotas no longer hard-stop the app. These are the
controls that bound spend, in the order they act.

## 1. Hard stop: billing kill switch
- **Budget** "Zenith Fitness monthly cap" on billing account `01A920-193AE7-B8A1F6`: ₹100 per calendar
  month, e-mail alerts to billing admins at 50 / 90 / 100 %, and every spend update is published to the
  Pub/Sub topic `projects/zenith-fitness-18e2a/topics/billing-alerts`.
- **Function** `capBilling` (`functions/src/index.ts`, us-central1, 1 instance max) consumes the topic. When
  `costAmount >= budgetAmount` it calls `cloudbilling.projects.updateBillingInfo` with an empty billing
  account, which detaches billing from the project: every service falls back to the free (Spark) limits
  instead of billing further. It runs as the dedicated service account
  `billing-cap@zenith-fitness-18e2a.iam.gserviceaccount.com`, which holds `roles/billing.admin` on the
  billing account (the only predefined role with `billing.resourceAssociations.delete`),
  `roles/billing.projectManager` + `roles/browser` on the project, and `roles/run.invoker` on its own
  Cloud Run service. No other principal in the project can detach billing.
- **Latency:** Google recalculates budget spend several times a day and usage data can lag by hours, so the
  worst case is roughly one day of overspend before the switch fires. At our cost rates that is a few
  hundred rupees even under sustained abuse.
- **Dry run:** publish a message with attribute `dryRun=true` (scratchpad `killswitch_test.mjs` does this and
  reads the log line). The dry run checks permissions and logs `wouldDisable` without touching billing.
- **After it fires:** Cloud console → Billing → *Link a billing account* re-attaches the account. Check
  the Firestore usage graphs for the cause before re-linking.

## 2. Per-service bounds
| Service | Free allowance | Bound in place |
|---|---|---|
| Firestore (asia-south2) | 50K reads / 20K writes / day | Owner dashboard reads ~515 docs per load via `dailyStats` aggregates (was ~4.5K). Client has IndexedDB persistence, so listeners resume from cache. Rules require sign-in everywhere; gym data is role-gated. No PITR, no backup schedules. |
| Cloud Functions (2nd gen) | 2M invocations / month | `saveWorkoutOnSessionComplete` max 3 instances, `capBilling` max 1. Artifact Registry `gcf-artifacts` cleanup: keep 2 most recent images, delete older than 1 day. |
| Auth | Free (no SMS) | Only e-mail/password and Google providers are enabled. Phone auth (billed SMS) stays off. |
| Hosting | 10 GB storage, 360 MB/day egress | Nothing beyond the kill switch. |
| Gemini API (Zen) | Free tier: 30 RPM / 14.4K RPD | Key lives in a **separate project with no billing account**. Gemma 4 has no paid tier, so linking that project to billing breaks Zen rather than billing it. Server quotas: 6/min, 60/day per user; 24/min global. |
| Vercel (`api/*`) | Hobby plan | Hobby never bills; it pauses at its limits. Every route has a `maxDuration` (zen 120 s, foodscan/push/account/admin 60 s, otp 30 s) and works from one time budget so a slow model cannot hold an invocation open. Push: 30/min, 600/day per sender, and only to buddies / pending requests / own gym members; announcements fan out server-side (5/min, 40/day per staff). Food scan: 4/min + 10/day per user, 600/day across everyone. |
| EmailJS (OTP) | 200 e-mails / month | Free plan blocks rather than bills. OTP route: 3/h, 6/day per e-mail, 15/day per IP, 60 verify attempts/h per IP; a code whose mail failed to send is refunded. |
| BigQuery, Cloud Build, Logging, Pub/Sub | Free tiers | No datasets; builds only on deploy; a few log lines per day. |

## 3. Known soft spots (not billing-critical, tracked)
- Firestore has no per-user read limit. A malicious signed-in user can loop reads; rules do not yet bound
  `request.query.limit` on `userProfiles` / `sharedExercises` lists. Bounded by §1.
- Any signed-in user can call `api/push.ts` for any recipient (FCM is free; Firestore cost per call is a
  few reads). A per-user rate limit is a follow-up.
- App Check is deferred until the Android app ships through Play (Play Integrity rejects sideloaded APKs).
- Cloud Functions run on Node 20, decommissioned 2026-10-30: bump `functions/package.json` engines to 22.

## 4. Checking usage
Scratchpad `fs_usage.mjs` prints today's Firestore reads/writes/deletes per hour from Cloud Monitoring.
The Firebase console → Usage and billing shows the same plus the current invoice.
