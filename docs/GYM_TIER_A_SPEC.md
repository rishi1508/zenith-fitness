# Gym OS lite — Tier A implementation spec

> Written 2026-09-06 for the autopilot build. Source of truth for the Tier A work; ROADMAP.md §3 Phase A is the summary, this is the detail. Assumptions Rishi confirmed: demo plans 1m ₹2,500 / 3m ₹6,000 / 6m ₹10,000 / 12m ₹15,000 (placeholder prices); members have phone numbers; the daily check-in code is generated at runtime on a staff phone; classes run Mon–Sat (Aerobics, Zumba, Yoga, Circuit Training…), no capacity cap today but capacity must be supported.

## 0. Ground rules for whoever builds this

- Same codebase, same conventions: React 19 + TS, Tailwind utility classes, `isDark` prop for theming (see `src/views/SettingsView.tsx` for card/border patterns), lucide-react icons, single quotes, 2-space indent.
- **No new top-level localStorage keys.** Gym data lives in Firestore and is read through listeners in `src/gymService.ts`; the only local cache is the `gymContext` on the user's profile, mirrored via the existing `userProfiles` doc.
- **Do not touch** `src/storage.ts`, `src/streakService.ts`, `src/sharedExercises.ts`, chart internals, or the auth flow except where this spec says so.
- Every agent: `npx tsc -b` clean, `npm run build` clean, `npx eslint <your files>` clean, then commit with a conventional message ending in `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Never leave the tree in a non-building state.
- Firestore cost discipline: listeners on `gyms/{gymId}` and `gyms/{gymId}/members/{uid}` only; collection queries use `where` + `limit`; dashboard aggregates are computed client-side from `checkins` of the last 30 days (`where('at', '>=', ...)`, limit 5000) and from the members collection (≤ 600 docs) — acceptable for one gym.

## 1. Roles and access

| Role | Where stored | Can |
|---|---|---|
| `member` | `userProfiles/{uid}.gymId` + `gyms/{gymId}/members/{uid}` | own membership card, check in, classes, announcements |
| `trainer` | `gyms/{gymId}.staff[uid] = 'trainer'` | + members directory (read), check-in console, mark class attendance, today's code |
| `manager` | `staff[uid] = 'manager'` | + add/edit members, plans, record payments, classes CRUD, announcements |
| `owner` | `staff[uid] = 'owner'` and `gyms/{gymId}.ownerUid` | + dashboard, gym settings, staff roles |
| Zenith admin | `src/admin.ts` | everything (create gyms) |

`gymRole` on `userProfiles` mirrors the staff map for fast client checks; the rules trust the gym doc, not the profile.

## 2. Types (add to `src/types.ts`)

```ts
export type GymRole = 'member' | 'trainer' | 'manager' | 'owner';
export type MembershipStatus = 'active' | 'expiring' | 'expired' | 'frozen' | 'none';
export type CheckinMethod = 'member-qr' | 'staff-qr' | 'code' | 'manual';
export type PaymentMethod = 'upi' | 'cash' | 'card' | 'other';

export interface GymPlan { id: string; name: string; months: number; price: number; active: boolean }

export interface Gym {
  id: string;
  name: string;
  logoUrl?: string;
  accentColor?: string;          // hex, applied to --accent when set
  address?: string;
  phone?: string;
  ownerUid: string;
  staff: Record<string, Exclude<GymRole, 'member'>>;
  joinCode: string;              // 6 chars A–Z0–9, members enter this to join
  plans: GymPlan[];
  /** sha256(`${code}:${date}:${gymId}`) of today's 6-digit check-in code; members hash their input and compare. */
  dailyCodeHash?: string;
  dailyCodeDate?: string;        // YYYY-MM-DD local
  memberCount: number;           // denormalised, updated on add/remove
  createdAt: string;
  subscriptionStatus: 'pilot' | 'active' | 'lapsed';
  pilotEndsAt?: string;
}

export interface GymMember {
  uid: string;                   // real auth uid, or `demo_<n>` for seeded members
  name: string;
  phone?: string;
  email?: string;
  photoURL?: string | null;
  role: GymRole;
  joinedAt: string;
  planId?: string;
  planStart?: string;            // ISO date
  planEnd?: string;              // ISO date (exclusive end)
  frozen?: boolean;
  trainerUid?: string;
  notes?: string;
  lastCheckinAt?: string;
  lastWorkoutAt?: string;
  checkinCount30d?: number;      // denormalised by client on check-in
}

export interface GymPayment { id: string; uid: string; amount: number; method: PaymentMethod; paidAt: string; months: number; planId?: string; note?: string; recordedBy: string }
export interface GymCheckin { id: string; uid: string; at: string; date: string /* YYYY-MM-DD local */; method: CheckinMethod; byUid: string }
export interface GymClass { id: string; name: string; weekday: number /* 0=Sun..6 */; startTime: string /* HH:mm */; durationMin: number; trainerUid?: string; capacity?: number /* undefined = uncapped */; active: boolean }
export interface GymClassSession { id: string /* `${classId}_${YYYY-MM-DD}` */; classId: string; date: string; enrolled: string[]; attended: string[] }
export interface GymAnnouncement { id: string; text: string; audience: 'all' | { classId: string }; byUid: string; byName: string; at: string }

/** Cached on userProfiles/{uid} so the app knows which gym to load on start. */
export interface GymContext { gymId: string; gymRole: GymRole; joinedAt: string }
```

`UserProfile` gains `gym?: GymContext | null`.

## 3. Firestore layout

```
gyms/{gymId}                                    Gym
gyms/{gymId}/members/{uid}                      GymMember
gyms/{gymId}/payments/{paymentId}               GymPayment
gyms/{gymId}/checkins/{checkinId}               GymCheckin   (id = `${uid}_${date}` → one per member per day, idempotent)
gyms/{gymId}/classes/{classId}                  GymClass
gyms/{gymId}/classes/{classId}/sessions/{date}  GymClassSession
gyms/{gymId}/announcements/{id}                 GymAnnouncement
gymJoinCodes/{code}                             { gymId }    (lookup for join-by-code without listing gyms)
userProfiles/{uid}.gym                          GymContext | null
```

## 4. Rules (append to `firestore.rules`)

```
function gymDoc(gymId) { return get(/databases/$(database)/documents/gyms/$(gymId)).data; }
function isGymStaff(gymId) { return signedIn() && request.auth.uid in gymDoc(gymId).staff; }
function gymStaffRole(gymId) { return gymDoc(gymId).staff[request.auth.uid]; }
function isGymManager(gymId) { return isGymStaff(gymId) && gymStaffRole(gymId) in ['manager', 'owner']; }
function isGymOwner(gymId) { return signedIn() && request.auth.uid == gymDoc(gymId).ownerUid; }
function isGymMember(gymId) { return signedIn() && exists(/databases/$(database)/documents/gyms/$(gymId)/members/$(request.auth.uid)); }

match /gymJoinCodes/{code} { allow get: if signedIn(); allow write: if false; }   // written by admin/owner via gymService using a batch that also creates the gym

match /gyms/{gymId} {
  allow read: if isGymMember(gymId) || isGymStaff(gymId) || isAdmin();
  allow create: if signedIn() && request.resource.data.ownerUid == request.auth.uid && request.resource.data.staff[request.auth.uid] == 'owner';
  allow update: if isGymOwner(gymId) || isAdmin()
                || (isGymStaff(gymId) && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['dailyCodeHash', 'dailyCodeDate']))
                || (isGymManager(gymId) && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['memberCount', 'plans']));
  allow delete: if false;

  match /members/{uid} {
    allow read: if isGymStaff(gymId) || isAdmin() || request.auth.uid == uid;
    // joining: a signed-in user creates their own member doc with role 'member'
    allow create: if isGymManager(gymId) || isAdmin() || (signedIn() && request.auth.uid == uid && request.resource.data.role == 'member');
    allow update: if isGymManager(gymId) || isAdmin()
                  || (isGymStaff(gymId) && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['lastCheckinAt', 'checkinCount30d']))
                  || (request.auth.uid == uid && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['lastCheckinAt', 'checkinCount30d', 'lastWorkoutAt', 'photoURL', 'phone']));
    allow delete: if isGymManager(gymId) || isAdmin();
  }
  match /payments/{id}   { allow read: if isGymStaff(gymId) || isAdmin() || request.auth.uid == resource.data.uid; allow create, update: if isGymManager(gymId) || isAdmin(); allow delete: if isGymOwner(gymId) || isAdmin(); }
  match /checkins/{id}   { allow read: if isGymStaff(gymId) || isAdmin() || request.auth.uid == resource.data.uid;
                           allow create: if isGymStaff(gymId) || isAdmin() || (signedIn() && request.auth.uid == request.resource.data.uid && request.resource.data.method in ['member-qr', 'code']);
                           allow update, delete: if isGymManager(gymId) || isAdmin(); }
  match /classes/{id}    { allow read: if isGymMember(gymId) || isGymStaff(gymId) || isAdmin(); allow write: if isGymManager(gymId) || isAdmin();
    match /sessions/{date} { allow read: if isGymMember(gymId) || isGymStaff(gymId) || isAdmin();
                             allow create, update: if isGymStaff(gymId) || isAdmin()
                               || (isGymMember(gymId) && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['enrolled']));   // member enrol/unenrol
                             allow delete: if false; } }
  match /announcements/{id} { allow read: if isGymMember(gymId) || isGymStaff(gymId) || isAdmin(); allow create: if isGymStaff(gymId) || isAdmin(); allow update, delete: if isGymManager(gymId) || isAdmin(); }
}
```

Also relax `userProfiles/{uid}` update so a **manager of the member's gym** may set `gym`: add `|| (request.resource.data.diff(resource.data).affectedKeys().hasOnly(['gym']) && isGymManager(request.resource.data.gym.gymId))`.

## 5. Service API (`src/gymService.ts`)

Pure Firestore module in the style of `src/workoutSessionService.ts` (auth from `./firebase`, `onSnapshot` listeners returning unsubscribe fns). Required exports:

```ts
// membership context
getMyGymContext(): Promise<GymContext | null>              // from userProfiles/{me}.gym
listenToGym(gymId, cb: (g: Gym | null) => void): () => void
listenToMyMembership(gymId, cb: (m: GymMember | null) => void): () => void
joinGymByCode(code: string): Promise<{ gym: Gym; member: GymMember }>   // gymJoinCodes lookup → create members/{me} role member → set profile.gym → increment memberCount
leaveGym(gymId): Promise<void>

// gym admin
createGym(input: { name; address?; phone?; plans?: GymPlan[] }): Promise<Gym>   // owner = me; writes gym + gymJoinCodes + members/{me} (role owner) + profile.gym in one batch; plans default to the four demo plans
updateGym(gymId, patch: Partial<Pick<Gym, 'name' | 'logoUrl' | 'accentColor' | 'address' | 'phone' | 'plans'>>): Promise<void>
setStaffRole(gymId, uid, role: Exclude<GymRole,'member'> | null): Promise<void>   // owner only; keeps members/{uid}.role in sync

// members
listMembers(gymId, opts?: { status?: MembershipStatus; trainerUid?: string; search?: string; limit?: number }): Promise<GymMember[]>   // client-side filter after one query is fine (≤600)
listenToMembers(gymId, cb): () => void
addMember(gymId, input: { name; phone?; email?; planId?; planStart?; trainerUid?; notes? }): Promise<GymMember>   // creates a `manual_<id>` uid if no auth user; if email matches an existing userProfile, link that uid and set profile.gym
updateMember(gymId, uid, patch: Partial<GymMember>): Promise<void>
removeMember(gymId, uid): Promise<void>
membershipStatus(m: GymMember, now?: Date): MembershipStatus   // pure: none if no planEnd; frozen; expired if planEnd < today; expiring if ≤ 7 days left; else active
renewMembership(gymId, uid, planId, startFrom?: 'today' | 'planEnd'): Promise<void>   // extends planEnd by plan.months

// payments
recordPayment(gymId, input: { uid; amount; method; months; planId?; note?; paidAt? }): Promise<GymPayment>   // also calls renewMembership
listPayments(gymId, opts?: { uid?; sinceISO?; limit? }): Promise<GymPayment[]>

// check-in
checkinMember(gymId, uid, method: CheckinMethod): Promise<{ created: boolean; checkin: GymCheckin }>   // id `${uid}_${localDate}`; set with merge → idempotent; updates members/{uid}.lastCheckinAt (+checkinCount30d best-effort)
rotateDailyCode(gymId): Promise<string>                      // staff: random 6 digits, stores hash + date on gym doc, returns the plain code for display
verifyDailyCode(gym: Gym, code: string): boolean            // pure: sha256(`${code}:${localDate}:${gym.id}`) === gym.dailyCodeHash && gym.dailyCodeDate === localDate
gymQrPayload(gymId): string                                  // `zenith://gym/${gymId}/checkin`
memberQrPayload(gymId, uid): string                          // `zenith://gym/${gymId}/member/${uid}`
parseQrPayload(text): { kind: 'gym-checkin'; gymId } | { kind: 'member'; gymId; uid } | null
listCheckins(gymId, opts: { sinceISO: string; uid?: string; limit?: number }): Promise<GymCheckin[]>

// classes
listClasses(gymId): Promise<GymClass[]>;  listenToClasses(gymId, cb)
saveClass(gymId, cls: Omit<GymClass,'id'> & { id?: string }): Promise<GymClass>;  deleteClass(gymId, id)
listenToSession(gymId, classId, date, cb)
enrol(gymId, classId, date, uid) / unenrol(...)             // arrayUnion / arrayRemove on sessions/{date}.enrolled, respecting capacity (client check)
markAttendance(gymId, classId, date, uid, attended: boolean)
upcomingSessions(classes: GymClass[], from: Date, days = 7): Array<{ cls: GymClass; date: string }>   // pure

// announcements
postAnnouncement(gymId, text, audience): Promise<void>       // also deliverPush to members (audience all → members with fcm tokens; keep best-effort, reuse pushService.deliverPush per uid, cap at 300)
listenToAnnouncements(gymId, cb, limit = 30)

// dashboard (pure aggregations over data fetched once)
computeDashboard(input: { members: GymMember[]; checkins30d: GymCheckin[]; payments90d: GymPayment[]; classes: GymClass[]; sessions7d: GymClassSession[]; now?: Date }): DashboardStats
```

`DashboardStats` = `{ totalMembers; activeMembers; expiringIn7; expiringIn30; expired; frozen; checkinsToday; checkinsPerDay: Array<{date; count}> /* 30 */; checkinsPerHour: number[24] /* last 30 days */; activeThisWeek /* distinct uids with a check-in or workout in the last 7 days */; atRisk: GymMember[] /* joined >30d ago, no check-in/workout in 14d, not expired/frozen */; duesOutstanding: Array<{ member; daysOverdue }> /* planEnd passed, not frozen */; revenue30d; revenue90d; newMembers30d; signupToActive /* of members joined in last 30d, share with ≥2 check-ins */; classFill: Array<{ cls; avgEnrolled; avgAttended; capacity? }> }`. Put the pure functions in `src/gymStats.ts` and unit-test them with a small esbuild-bundled node script like the streak tests.

Hashing: use `crypto.subtle` (available in the WebView) with a small `sha256Hex(s: string): Promise<string>` helper in `src/gymService.ts`; `verifyDailyCode` therefore becomes async.

## 6. Screens

All new views live in `src/views/gym/` and shared pieces in `src/components/gym/`. Register views in `src/views/index.ts` and routes in `App.tsx` (`View` union + render switch) — the **data-layer agent adds the routes with placeholder components** so the UI agents never edit `App.tsx`.

### 6.1 Entry points (App.tsx, data-layer agent)
- `useGym()` hook/context (`src/gym/GymContext.tsx`): loads `GymContext` from the profile on sign-in, subscribes to the gym doc and my membership, exposes `{ gym, membership, role, loading, refresh }`. Guests → null.
- Header: when `gym` is set, a small pill with the gym name (and logo if any) next to the streak pill; tap → `gym-home`. Accent colour: when `gym.accentColor` is set, set CSS var `--accent` on `documentElement`.
- Services list: first entry "My Gym" (or "Join a gym" when no gym) → `gym-home` / `gym-join`.
- Routes: `gym-join`, `gym-home`, `gym-checkin`, `gym-classes`, `gym-class` (detail), `gym-announcements`, `gym-membership`, `gym-dashboard`, `gym-members`, `gym-member` (detail), `gym-console` (staff check-in console), `gym-classes-manage`, `gym-settings`, `gym-create`.

### 6.2 Member screens (member-UI agent)
- **JoinGymView**: enter 6-char code (uppercase, auto-format) or scan the gym's join QR (`zenith://gym/<id>/join`). Success → toast + navigate `gym-home`. Zenith admin also sees "Create a gym" → `gym-create`.
- **GymHomeView** (member): gym header card (name, logo, accent), **Membership card** (plan, ends on, status chip, days left, big member QR — `memberQrPayload`), primary button "Check in", today's classes strip, latest 3 announcements, links to Classes / Announcements / Membership; staff additionally see a "Staff" section with buttons to Console / Members / Classes / Dashboard (owner) / Settings (owner).
- **CheckinView** (member): three tabs — *Scan* (camera, decode gym QR → `checkinMember(method 'member-qr')`), *Code* (6-digit input → `verifyDailyCode` → `checkinMember(method 'code')`), *Show my QR* (member QR large, for staff to scan). Shows "Checked in today at HH:mm" state and this week's check-in dots. Camera: `qr-scanner` npm package (pure JS, uses getUserMedia, works in Capacitor WebView) — add `android.permission.CAMERA` to `android/app/src/main/AndroidManifest.xml`.
- **ClassesView**: next 7 days grouped by day; each session shows time, trainer, enrolled/capacity, Enrol / Leave; full → "Full" (disabled). **ClassDetailView**: description-less; enrolled list for staff.
- **AnnouncementsView**: reverse-chron list; staff get a composer (audience all / a class).
- **MembershipView**: plan history (payments), current plan, renewal reminder copy, gym contact.

### 6.3 Staff / owner screens (staff-UI agent)
- **GymDashboardView** (owner/manager): stat tiles (active members, checked in today, expiring 7d, dues outstanding, new 30d, revenue 30d), InteractiveLineChart of check-ins per day (30d), 24-bar peak-hours strip, **At-risk list** (name, phone tap-to-call `tel:`, last seen), **Expiring / overdue list** with "Record payment" shortcut, class fill table. Works on phone and desktop width (use `sm:grid-cols-2 lg:grid-cols-3`).
- **MembersView**: search by name or phone, filter chips (all / active / expiring / expired / frozen / no plan), sort by expiry; "Add member" form (name, phone, email, plan, start date, trainer). Row → **MemberDetailView**: card, status, plan controls (change plan, set start/end, freeze/unfreeze), **Record payment** sheet (amount prefilled from plan, method, months, note) which also renews, payments history, check-in history (30 entries), trainer assignment, notes, remove.
- **CheckinConsoleView** (trainer+): big **Today's code** (generate/rotate; shows plain code large for the desk), the **gym QR** (large, for members to scan), *Scan member QR* (camera → `checkinMember(method 'staff-qr')` with success sheet showing name/plan status, red warning if expired), *Manual* (search by name/phone → tap to check in, method 'manual'). Live "checked in today" count and last 10 check-ins.
- **ClassesManageView** (manager+): weekly grid Mon–Sat, add/edit class (name, weekday(s) multi-select creates one class per day, time, duration, trainer, capacity optional), toggle active; per-session attendance marking for trainers (tap names).
- **GymSettingsView** (owner): name, address, phone, logo URL, accent colour picker (preset swatches), plans editor (name/months/price/active), staff list with role dropdown (add staff by email → looks up `userProfiles` by email), join code display + regenerate, join QR.
- **CreateGymView** (Zenith admin only): name + address + phone → `createGym`.

## 7. Demo seed (data-layer agent, `scripts/seed-demo-gym.mjs`)

Admin-SDK script (uses `GOOGLE_APPLICATION_CREDENTIALS`) that creates gym `demo-iron-temple` "Iron Temple Fitness" with: the four plans; owner = Rishi (`BXedteurc3bPydsehvPIdVWPTbM2`) + a test owner auth user `demo.owner@zenith-fitness.test`; 6 trainers (`demo_trainer_1..6`, fictional Indian names); 250 members with fictional names and phone numbers (+91 9xxxxxxxxx random), plans distributed 1m 40% / 3m 30% / 6m 20% / 12m 10%, join dates over the last 14 months, ~15% expired, ~8% expiring in 7 days, ~5% frozen; payments consistent with plans; 90 days of check-ins with realistic patterns (peak 6–9am and 6–9pm, Sunday low, each active member 2–5 visits/week, at-risk members none in 14+ days); 8 classes Mon–Sat (Aerobics 6:30, Zumba 7:30, Yoga 8:00, Circuit Training 18:30, HIIT 19:30, Spin 7:00 alt days…) with sessions for the last 14 and next 7 days, enrolled/attended filled. Idempotent (re-running wipes and recreates the demo gym only). Sets Rishi's `userProfiles.gym` to owner of the demo gym. Also creates a **member demo login** `demo.member@zenith-fitness.test` (uid linked to one seeded member) so the QA pass can walk the member screens.

## 8. Testing in autopilot

- Pure logic (`gymStats.ts`, `membershipStatus`, `upcomingSessions`, `parseQrPayload`, code hashing) gets node unit tests via esbuild bundle in the scratchpad, like the streak tests.
- DEV-only sign-in hook for headless QA: in `AuthContext`, when `import.meta.env.DEV` and the URL has `?__devToken=<customToken>`, call `signInWithCustomToken` once and strip the param. Never active in production builds.
- QA agent: mint custom tokens for `demo.owner@…` and `demo.member@…` with the admin SDK, drive `npm run dev` with puppeteer (global `puppeteer`, `--no-sandbox`), screenshot every screen in §6 at 412×915 and 1280×800, fix what breaks, zero console errors.

## 9. Out of scope for Tier A

Payments processing, WhatsApp, PDF reports, lead tracking, per-trainer payroll, member self-registration without a code, multi-gym membership for one user (one gym per profile).

## 10. Gym feed (3.19.0, redesigned 3.19.1, 2026-09-09)
`My Gym` is `Feed | Member | Manage`, and **Feed is the landing segment** — it is what a member
opens the tab for on most days; the card, plan and QR are one tap away and rarely change.

Modelled on Strava's athlete posts rather than a workout-only wall: a post is the member's own
words, optionally carrying an attachment. `GymFeedPost.kind` is one of `workout | photo | text |
pr | achievement`, derived from what was attached. The composer offers Session, Photo and Post;
the end-of-session celebration offers the session, and the level-up modal offers the achievement.
Nothing ever posts itself.

Card: avatar · name · "did Push Day · 3h" · the member's text · a 4-up metric strip
(volume / sets / time / kcal, from `workoutSummary`, which prices the session through
`src/energy.ts`) · a trophy line when PRs fell · the photo · three reactions · comments.

Cost shape: one small document per post, listed newest-first with a 20-doc limit, so opening the
feed is ~20 reads. A photo lives in `feed/{postId}/media/image` as a 900 px JPEG data URL and is
read only when that card renders. Comments live in `feed/{postId}/comments/{id}` and are read only
when the thread is opened; `commentCount` on the post keeps the collapsed card honest.

Rules: only this gym's people can read. A member creates posts and comments as themselves, deletes
their own, and may otherwise change exactly two things on someone else's post — their own key in
the `reactions` map, and `commentCount` by ±1. Staff can remove anything.

## 11. Geofenced check-in and renewal outreach (3.19.0)
- `Gym.location` + `Gym.geofenceM` (default 100 m, `src/geo.ts`). A poster-QR check-in verifies the
  member's position, adds their own GPS accuracy to the radius so a poor fix does not lock them out,
  and stores the distance on the check-in. **This runs on the member's phone**: it stops a photo of
  the poster being scanned from home, not a determined faker. The daily 6-digit code stays the
  rules-verified path and is what every location failure points to.
- `needsRenewal` / `normalizePhoneIN` / `whatsAppUrl` / `upiPayUri` / `buildRenewalMessage` in
  `gymStats.ts` (pure, `tests/gymRenewal.test.ts`) power a renewal card in the staff member detail:
  a wa.me deep link with the message pre-written, and a copyable `upi://pay` link built from
  `Gym.upiVpa`. No API, no fees.

## 12. Peak hours, 3.20.0
The dashboard's hour histogram is scrubbable: press and slide and each bar reports its hour and its
count ("142 at 7 PM · 18 of 402 check-ins came in that hour"). The busiest hour is highlighted when
nothing is held; every bar is a focusable button with a spoken label, and pointer events cover mouse
and touch alike.

## 13. Adding a member (3.21.0)
Two ways, both in the Add member sheet:
- **Search Zenith** (`searchUserProfiles`) — exact email plus a display-name prefix query, two cheap
  reads. Picking a result fills the form, and `addMember` links the membership to that uid.
- **Invite by email** (`inviteMemberByEmail`) — creates the membership now, so the owner can set a
  plan and take payment, plus a `gymInvites/{email}` record. The invitee claims it on their first
  sign-in with that address (`claimGymInvite`). No temporary password is emailed: Zenith's own email
  sign-in is the credential.

Rules: `gymInvites` is keyed by the lower-cased email so the rule can check
`request.auth.token.email.lower() == email`; staff write them, the invitee reads and deletes their
own. The member self-create rule now accepts either a valid join code **or** a matching invite.

## 14. The gym's own content and anonymous ratings (3.28.0, 2026-09-13)

Asked for by the first gym at the demo; built generically.

**Exercises** — `gyms/{gymId}/exercises/{id}` (`GymExercise`, `src/gymLibrary.ts`).
Staff write, members read. `GymContext` starts one listener per gym that fills
a module cache; `withGymExercises()` appends the rows to every picker and
`findExercise()` resolves an exercise by id then name across the member's
library and the gym's. Nothing is copied into the member's own data. The
video (`videoUrl`) plays in `VideoModal` from the workout card
(`ActiveWorkoutView`) and from My Gym → Exercise videos (`GymLibraryView`,
staff add/edit/remove with `ExerciseForm`; the "creator notes" slot carries
the trainer's cues).

**Plans** — `gyms/{gymId}/plans/{id}` (`GymWorkoutPlan`). Staff publish from
Train → Weekly plans → Share with gym (`publishGymPlan`; the gym plan keeps
the local plan's id, so re-sharing updates it). Members adopt from
`GymPlansView` (Train → "Plans from <gym>", or My Gym → Workout plans):
`adoptGymPlan` copies the days into a local plan tagged `sourceGymPlanId`,
sets it active, and bumps `useCount` once. Rules let a member change only
`useCount`, by exactly one.

**Ratings** — `gyms/{gymId}/ratings/{voterHash}` (`GymSessionRating`),
written only by `api/rate.ts`. The route verifies the caller is a member (not
staff) who was enrolled in or attended `classes/{classId}/sessions/{date}`,
dated within 14 days, then writes `{classId, date, trainerUid, stars, comment,
at}` under an HMAC of `(gym, class, date, uid)` derived from the Firebase key —
one vote per person, re-rate overwrites, no uid stored. Members rate from
`ClassDetailView` once the session date has passed; a per-device marker hides
the card afterwards. Managers/owners read them in Analytics (`RatingsCard` +
explainer sheet; `summarizeRatings` in `src/gymRatings.ts`); trainers cannot
read the collection.

**Co-branding** — `GymHint` carries `gymName`; the splash shows "by <gym>",
the home app bar's eyebrow leads with the gym's name, the home gym row shows
`logoUrl`. Play listing name stays Zenith Fitness; white-label is a paid
add-on (`docs/PILOT_TSZ.md` §3).

## 15. One person, one account; the desk creates accounts (3.29.0, 2026-09-13)

**Identity key.** `userProfiles/{uid}.phone` (E.164) plus `phoneIndex/{e164} → uid`,
written only by the server (`api/_profile.ts`: `normalizePhone`, `claimPhone`
transaction, `completeProfile`). Firebase Auth already keeps one account per
e-mail; the index does the same for the number. Every path that completes a
profile goes through `completeProfile`:
- e-mail sign-up (`api/otp.ts` `complete` — name, phone, dob, sex required/
  validated; if the number already belongs to an account with no e-mail, the
  e-mail joins THAT account instead of creating another),
- the in-app setup screen (`api/account.ts` `complete-profile`, shown by
  `App.tsx` via `useMyProfile` when the profile has no phone),
- the front desk (`api/members.ts`).

**Front desk** (`MembersView` → `createMemberAccount` → `api/members.ts create`):
name + mobile required, e-mail/dob/sex optional, or pick an existing Zenith
account from search (`uid`). Resolution order: picked uid → phoneIndex →
Auth by e-mail → new Auth user. Refuses (409) a number on another account or
a person in another gym. Writes the profile (complete, `createdBy: 'staff'`),
the member doc under the real uid (+ memberCount when new), and the gym
pointer. Payments/plans stay client-side as before.

**No self-enrolment.** `joinGymByCode` and `inviteMemberByEmail` are removed;
the members `create` rule allows staff/admin only (plus finishing a legacy
e-mail-invite placeholder). `JoinGymView` is now the explainer ("the desk
adds you by your number") and shows the account's number. Sign-in with Google
for an account the desk created by e-mail: Firebase's one-account-per-e-mail
takes the account over with the trusted provider, so it is the same uid.
SMS sign-in, when built, mints a custom token for `phoneIndex[e164]`.

**Account switching.** `signOut` and a different-uid sign-in clear
`zenith_*` local storage (device keys excepted), terminate Firestore, clear
its IndexedDB cache and reload (`resetFirestoreCache` in `src/firebase.ts`).

**Sessions (same release).** `participantUids` on session docs; any joined
participant may write `currentTemplateExercises` (`syncSessionTemplate`);
`reconcileWorkoutWithTemplate` removes for everyone and orders by the
template; `assertNoOpenSession` guards `createSession`/`joinSession`.
