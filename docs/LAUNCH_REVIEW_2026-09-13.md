# Launch review — Play Store readiness (2026-09-13)

Written overnight while Rishi slept, per the brief: review the whole project
as a 25-person team would (security, backend, mobile platform, data, product,
design, copy, QA, support, finance, legal), fix everything that does not need a
decision from him, document the rest, and leave only the steps that genuinely
need his hands. Everything here shipped as **3.27.0** (tag `v3.27.0`).

Related: `docs/RELEASE_3.27.0.md` (what changed, in release-note form),
`docs/STORE_PUBLISHING.md` (the decision and the two store checklists),
`store/play/README.md` (assets and the forms), `docs/AUDIT_2026-09-10.md`
(the previous audit this builds on).

---

## 1. Rishi's to-do (the only steps that need you)

In order. Nothing else in this document is waiting on you.

1. **Play developer account** — pay the $25, complete identity verification
   (1–3 days). Personal accounts created after Nov 2023 must run a closed test
   with 12 testers for 14 days before production; plan for that.
2. **Create the app** in Play Console: package `com.zenith.fitness`, Health &
   Fitness, free. Opt into **Play App Signing** (our CI keystore becomes the
   upload key). Upload `zenith-fitness-v3.27.0.aab` from the GitHub release.
3. **Register the Play signing key with Firebase** — Play Console → Setup →
   App signing → copy the *App signing key certificate* SHA-1 and SHA-256 →
   Firebase console → Project settings → Your apps → Android → Add fingerprint.
   Without this, Google sign-in fails on the Play-installed build (the APK
   we ship today is signed with the upload key, which is already registered).
4. **Fill the forms** from the drafts: store listing copy
   (`store/play/LISTING.md`), graphics (`store/play/icon-512.png`,
   `feature-graphic-1024x500.png`, `screenshots/01–06`), Data safety
   (`store/play/DATA_SAFETY.md`), Health apps declaration
   (`store/play/HEALTH_DECLARATION.md`), content rating
   (`store/play/CONTENT_RATING.md`). Privacy policy URL:
   `https://zenith-fitness-18e2a.web.app/privacypolicy.html`. Account
   deletion URL (Play asks for one): the same page, section "Your rights and
   deleting your account" — deletion itself is in-app under Settings → Account.
5. **Closed testing**: create the track, add 12+ tester e-mails (gym members
   are ideal), share the opt-in link, ask them to install and open it. After
   14 days, apply for production access.
6. **After the gym-owner demo**, tell me to remove the QA admin account
   (`upLvcTSoE5SS7lOmhYBKHFWSV0r1`) from `firestore.rules`, `src/admin.ts` and
   `api/_http.ts`. It is kept on purpose so the demo still works.
7. **Cloud Functions**: CI's functions step is `continue-on-error`; check the
   `v3.27.0` run. If it failed, run
   `npx firebase-tools deploy --only functions --project zenith-fitness-18e2a`
   from this machine (the one-time owner deploy has worked before).

Optional, no rush: set `OPENAI_DAILY_USD_CAP` / `OPENAI_MONTHLY_USD_CAP` on
Vercel only if you want different guards than the defaults ($0.25 / $4).

---

## 2. What was verified before tagging

| Check | Result |
| --- | --- |
| TypeScript (`tsc -b`), ESLint, Vitest | clean · 342 tests pass (27 files) |
| `api/*.ts` type-check (not covered by `tsc -b`) | clean |
| Cloud Functions type-check | clean |
| Firestore rules matrix (Rules API, `scripts/rules-test.mjs`) | 62/62 (36 new cases) |
| Live API after deploy (`scratchpad/free_api.mjs`) | 16/16 — free account 403 on Zen and scan, member passes, stranger push looks like "no tokens", non-staff announce 403, bad shapes 400, bad token 401, OTP/admin guards, CORS allowlist |
| Free account UI sweep (`scratchpad/free_ui.mjs`, dev server, production data) | 9/9 locked: Zen card → Premium sheet; Energy, Phase, Insights, Analysis, plate scan → locked screen; "Free" pill on profile; 0 console errors |
| Gym member UI sweep | 9/9 open, 0 console errors |
| Owner UI sweep (`scratchpad/owner_ui.mjs`) | Manage, check-in console (rotate writes `private/dailyCode`, clears the gym-doc copy), Analytics, Members render; 0 console errors |
| Code check-in against live rules (REST as member) | wrong hash 403 · right hash 200 · back-dated 403 |

The QA accounts (`scratchpad/qa_creds.json`): owner, member, admin, and a new
**free** account `demo.free@zenith-fitness.test` (no gym, no grant) for the
free side of the line.

---

## 3. Findings by discipline — fixed

### Security / backend (api/*)
- **Push route accepted any recipient from any signed-in account.** Now:
  buddy, pending request either way, or staff→own gym member. Payload shape
  and size validated (uid pattern, title ≤120, body ≤500, ≤12 data entries).
  Announcements are one server call (`action: 'announce'`, staff-only,
  5/min · 40/day) with member token lookups at 25 in flight and FCM batches
  of 500.
- **Account deletion left most of a person behind.** The wipe now covers:
  `users/{uid}` tree, profile + fcmTokens, notifications, buddy pairs + their
  chats, requests both ways, follow edges both ways, hosted sessions, gym
  member doc + staff role, own feed posts (+ comments/media), comments and
  reactions on others' posts, rate-limit counters, pending OTP. Auth account
  deleted **first**; all steps run even if one fails and the leftovers are
  named; gym owners get 409 until ownership is transferred. What stays (gym
  payments/check-ins, shared-library contributions) is now stated in the
  privacy policy.
- **OTP**: verify in a transaction; per-IP verify limit (60/h); code doc holds
  hashes only (no e-mail address at rest); limits refunded when EmailJS
  fails; fetch timeouts; trusted client IP from `x-real-ip`.
- **Zen**: Gemma timeout 100 s → 55 s so the OpenAI fallback fits inside the
  120 s limit; quota refunded on 5xx and when the shared window was full;
  second round of the data protocol carries a signed ticket (HMAC from the
  Firebase key) so one turn is charged once and cannot be faked;
  `energy_range` accepted by the normaliser (it was in the allowed list but
  fell through to `null`).
- **Plate scan**: premium enforced server-side by default; 4/min per user and
  600/day global ceilings; one clock from the top of the handler
  (`TOTAL_BUDGET_MS` 56 s) so the paid fallback gets what is left, never less
  than 8 s; refunds on every counter.
- **OpenAI guards**: $2/day → $0.25/day + $4/month (`aiQuota/month-YYYY-MM`).
- **Shared**: `api/_http.ts` — CORS allowlist (hosted app, Capacitor origins,
  local dev; unknown origins get no header), generic "not configured" reply
  (env var names were being echoed to clients), admin uid list with trimming,
  Gemini key in `x-goog-api-key` rather than the URL. `assertPremium` honours
  admins (server precedence now equals the client's).
- **Cloud Function** clamps what a session doc can turn into (≤40 exercises,
  ≤30 sets, name ≤60, valid dates, duration ≤24 h) and only acts on the
  project's own budget notification.
- Dead password sign-in path removed from `AuthContext` (the provider stays
  enabled in Firebase — the DEV sign-in used by the headless sweeps needs it;
  it is not exposed in the UI).

### Firestore rules + services (gym)
- **Joining by code was broken** (member's +1 on `memberCount` denied). Fixed
  in rules: exactly +1 in the batch that creates the member doc.
- **Invite claiming was broken** (placeholder unreadable; wrong pointer
  shape). Rules let the invitee read/replace the placeholder their own invite
  names; the claim is one batch with the right `{gymId, gymRole, joinedAt}`.
- **Daily code hash readable by every member** → moved to
  `gyms/{id}/private/dailyCode` (staff-only). Members submit a hash; rules
  compare. Rotate clears the old gym-doc copy.
- **Back-dated self check-ins** refused (date must be within a day of now).
- A member can add/remove only **their own** name in a class session; a
  manager can only point a **gym-less** profile at their gym; a trainer can
  only take down **their own** notice (author or manager).
- Payment + renewal in one transaction. `checkinCount30d` is the exact count
  of the last 30 dates on the member doc. Desk console listens instead of
  polling (30 s poll re-read every check-in of the day: ~36K reads/hour for a
  300-member gym). `addMonthsISO` clamps month-end. `addMember` uses date-only
  plan starts and refuses to link someone in another gym. Role in
  `GymContext` comes from the gym's staff map / ownerUid (what the rules
  check). Mark-all-read in chunks of 400. Dead, rules-denied
  `getPendingSessionInvites` removed.

### Client core (batch 1, commit 73a8f6f)
- Sync protocol: per-key `updatedAt` stamps; newer side wins on pull;
  listener ignores snapshots at or before our stamp; pending writes dropped on
  account switch; workouts debounced 2.5 s.
- Account-scoped state reset on uid change; guest data parked on sign-in and
  restorable from Settings → Data & backup.
- Every "day" is the **local** calendar day (was a mix of UTC and local).
- `saveWorkout` reports storage failure instead of silently dropping.
- Offline gate does not interrupt an active workout; nested profile back
  stack; back button closes Level-up / Badge / Welcome-tour overlays.
- Platform: `allowBackup="false"`; location permissions declared (geofence
  check-in); `versionCode` derived from the version; AAB built and attached in
  CI; PNG icons (any + maskable); manifest description; SW cache v4 with
  `ignoreSearch`; stale `firebase-messaging-sw.js` removed; update banner off
  on native.
- Copy: emoji out of UI text, sentence case, plain error words, no "!!"
  toasts.

### Premium (commit 0f7fa0e)
- `PremiumProvider` (one profile read per uid + live gym), `PremiumGate`,
  `UpgradeSheet` (no prices; "I have a gym code"), feature map with
  `FREE_BUDDY_LIMIT = 3`, `canUse(tier, feature, enforced)`; 5 unit tests.

### Store / legal / support
- `store/play/`: icon 512, feature graphic, six 1080×2340 screenshots with
  captions, `LISTING.md`, `DATA_SAFETY.md`, `HEALTH_DECLARATION.md`,
  `CONTENT_RATING.md`. Privacy policy rewritten; deletion section matches the
  wipe exactly. Contact: rishimishra1508@gmail.com.
- Health Connect: the integration is already the right one (Google Fit's
  APIs end in late 2026; Strava's "connect Google Fit" is the old path).
  Manifest declares exactly the READ_* scopes the code asks for (+
  WRITE_WEIGHT); the permissions-rationale activity ships in the plugin's
  manifest; Activity tab shows a "Connect Health Connect" card and the state
  ("not connected — days you enter by hand are kept as-is"). Nothing more to
  add before Play; the declaration form is drafted.

### Housekeeping
- Four stale sub-agent worktrees (`.claude/worktrees/agent-*`, all at an
  ancestor of main, no unique commits) removed with their branches.

---

## 4. Deferred — documented, not blocking

| Item | Why deferred | Suggested when |
| --- | --- | --- |
| `userProfiles` public/private split (email and compare stats readable by any signed-in user) | Schema migration + rules two-phase rollout; needs a client release that writes both shapes first | First release after Play |
| Clear Firestore IndexedDB cache on sign-out | Shared-device leak is theoretical for a phone app; the account-scoped reset already covers localStorage | Post-launch |
| Back at root exits the app | Rishi's earlier decision: do not exit | — |
| MRR history from the payments log (currently current-month uses live plan state) | Data model work | When the first gym asks |
| Firestore TTL policies (otpCodes, zenLimits, aiQuota, old sessions) | Console-side config; cheap to leave | Post-launch |
| CSP header on Hosting | Needs an allowlist audit of every third-party script/font; risk of breaking the PWA | Post-launch |
| Firebase API key restrictions / App Check | App Check needs the Play SHA and a Play-installed build to test | After the closed test starts |
| Chat message reactions: a buddy can rewrite the other's reaction keys | Map keyed by emoji, so a per-uid rule is not expressible; 1:1 chat, low stakes | — |
| Payments recorded against an invite placeholder keep the placeholder uid after the claim | Rules keep payments manager-only; needs a server step | With the first real invite |
| "Update available" banner on the PWA links to the GitHub release (APK) | Fine until the Play listing exists | Point it at the Play URL once live |
| Buddies search with an empty query lists the first 50 profiles on Zenith | Discoverability feature by design; profiles are readable by any signed-in user anyway. Revisit with the profile public/private split | With the split above |
| Play "Health apps" review may ask for a demo video of the Health Connect flow | Only if requested | On request |
| Node 20 runtime for Cloud Functions is decommissioned 2026-10-30 | Bump `functions/package.json` engines to 22 + `firebase-functions` | Before end of October |

---

## 5. Two-phase notes for this release

Rules apply to every installed build the moment they deploy (deployed
2026-09-12 ~06:00 IST, ahead of the tag). Effects on a phone still running
3.26.1 until it updates:
- Code check-in verifies against the private doc: after staff rotate with
  3.27.0, an older member build says "wrong code" until it updates (its local
  check reads the gym doc, which is now empty). Everything else in the older
  build keeps working; all other rule changes are loosenings or match what the
  old client already did.
- The API changes are backward compatible with 3.26.1 (the `dataTicket` is
  optional; the announcement loop still passes because the old client sends
  `gymId` in `data`).

## 6. Where the verification scripts live

`scratchpad/free_setup.mjs` (creates the free QA account and ID tokens),
`free_api.mjs` (16 API checks), `free_ui.mjs` (`WHO=free|member`),
`owner_ui.mjs`, `rotate_probe.mjs`, `scripts/rules-test.mjs` (run with
`ADC=<adc.json>`). Screenshots in `scratchpad/free-ui/`.
