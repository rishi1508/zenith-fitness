# Zenith Fitness — UI revamp (Direction A) + Zen + premium scaffolding + admin console

> Written 2026-09-06 for the autopilot build. Approved direction: the "Dark Performance" canvas (https://claude.ai/code/artifact/5281b0b1-686f-4cc7-bbd5-c972eb23e228). Same codebase (React 19 + TS + Vite + Tailwind v4 + Firebase + Capacitor), same view-state-machine routing, restyled shell and landing screens, no rewrite of feature internals unless stated.

## 0. Ground rules

- Read `CLAUDE.md`, `ROADMAP.md` §1–2, `docs/GYM_TIER_A_SPEC.md` §1 and §6.1 first.
- Every agent: `npx tsc -b` clean, `npm run build` clean, `npx eslint <touched files>` clean (≈95 pre-existing lint problems elsewhere; don't fix unrelated files), commit with conventional messages ending `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` via `git commit -F <file>`. Never leave the tree non-building.
- No emoji as icons (lucide-react only). No gradients on surfaces or buttons (flat accent). No new top-level localStorage keys — preferences go in `AppSettings` (`storage.getAppSettings/updateAppSettings`).
- New UI uses the token utilities (§1) and the kit (§2); do not thread `isDark` into new components (legacy components keep their `isDark` prop; pass `theme === 'dark'` where they need it).
- Copy: specific, short, no filler. Money `₹` with `toLocaleString('en-IN')`. Dates `en-IN`.
- Firestore cost discipline as before. Zen quota discipline as in §6.

## 1. Design tokens (Tailwind v4 `@theme` in `src/index.css`)

```css
@theme {
  --color-bg: #0f0f0f;  --color-surface: #17171a;  --color-surface-2: #1f1f23;  --color-border: #2a2a2f;
  --color-text: #f4f4f5; --color-muted: #a1a1aa;  --color-subtle: #71717a;
  --color-accent: #f97316; --color-accent-soft: rgba(249,115,22,.14);
  --color-ok: #22c55e; --color-warn: #f59e0b; --color-danger: #ef4444; --color-info: #38bdf8;
  --font-display: "Sora", "Manrope", system-ui, sans-serif;
  --font-sans: "Manrope", -apple-system, "Segoe UI", system-ui, sans-serif;
  --radius-control: 12px; --radius-card: 16px;
}
[data-theme="light"] { --color-bg:#f7f7f8; --color-surface:#ffffff; --color-surface-2:#f1f1f3; --color-border:#e6e6ea; --color-text:#111114; --color-muted:#6b6b75; --color-subtle:#9a9aa3; }
```
Tailwind v4 turns these into utilities: `bg-bg bg-surface bg-surface-2 border-border text-text text-muted text-subtle text-accent bg-accent bg-accent-soft font-display font-sans`. Because the light theme overrides the variables, one class works in both themes — the existing `[data-theme="light"]` hex-override block in `index.css` stays for legacy screens. Gym accent: `GymContext` already sets `--accent`; map `--color-accent: var(--accent, #f97316)` so a gym's colour flows into the utilities.
Type: display 26/32 700 (page title), 18/24 700 (card title), stat 24/28 700 tabular; body 15/22 500; caption 11/16 700 uppercase tracking .08em `text-subtle`. Load Sora + Manrope from Google Fonts in `index.html` with `display=swap` (system fallback offline).
Spacing 8-pt; screen padding 20px; card padding 16px; primary button 52px; secondary 44px; hit targets ≥ 44px; safe-area insets respected (existing pattern).

## 2. Component kit — `src/ui/` (barrel `src/ui/index.ts`)

`AppBar` (title | eyebrow+title | custom left; right slot), `TabBar` (items, active, onChange; optional centre item rendered as the elevated 56px accent disc — see mockup; hidden on `active` workout view), `Sidebar` (desktop ≥1024px: same items vertically + user block), `Card` (`padding` 'md'|'none'), `ListRow` (leading icon tile, title, subtitle, trailing: chevron | pill | custom; 56px), `StatTile` (eyebrow, value, sub; `tone`), `Sheet` (bottom sheet: scrim, grab handle, registers `backHandlerRegistry` so Android back closes it, focus trap not required), `Chip` (`on`), `Pill` (`tone` ok|warn|danger|accent|info|neutral), `Button` (`variant` primary|secondary|ghost|danger; `size` lg|md|sm; loading state), `IconButton` (badge count), `SegmentedControl`, `EmptyState` (icon, title, body, action), `Skeleton`, `SectionHeader` (caption + trailing link), `Toast` via `ToastProvider` + `useToast()` (replace `MemberToast`/`StaffToast` usages), `WeekDots` (7 dots: on/rest/today/off — from the streak engine's data). Keep each ≤120 lines, props typed, no `any`.

## 3. Shell and navigation — `src/shell/`

- `AppShell.tsx` wraps the current `<main>` content of `App.tsx`: renders `AppBar` (per-view config), content, and `TabBar` (phone) or `Sidebar` (desktop). App.tsx keeps its state machine, effects and handlers; the JSX around `<main>` moves into the shell. Do not touch workout/session logic.
- Tabs: `home | train | gym | health | you`. **`gym` appears only when `useGym().gym` is set** (5 tabs, gym centred and elevated); otherwise 4 tabs. `src/shell/tabs.ts` exports `TABS`, `viewToTab: Record<View, Tab>` and `tabRoot: Record<Tab, View>`. Tapping a tab navigates to its root and resets the history stack (existing `navigationHistory`).
- Root views: `home` → `HomeTabView`, `train` → `TrainTabView`, `gym` → existing `gym-home` (see §4), `health` → `HealthTabView`, `you` → `YouTabView`. Removed views: `services`, `profile` (merged into `you`). Every other existing view keeps working and is mapped to a tab for highlighting: history/progress/analysis/settings/buddies*/session-lobby → `you` (buddies also reachable from the top bar); templates/weekly/exercises/common-templates/compare/active → `train`; body-weight/body-measurements/coach/coach-chat/zen → `health`; gym-* → `gym`.
- Top bar right slot (all tabs except during `active`): streak pill (existing `StreakButton`, restyled to kit), buddies `IconButton` with `buddyAlertCount` badge → `buddies`, and on `you` the settings gear. Gym pill leaves the header (My Gym is a tab now).
- `HomeTabView`: today card (active plan + next day from `storage.getLastUsedDay`/plan; "Start workout"; last-time line from history; "Change day" opens the existing day picker); `WeekDots` + one-line streak nudge from `getStreakSummary()`; paused-workout banner (keep behaviour from `HomeView`); `DeloadSuggestion`; gym card (name, next class, "Check in" → `gym-checkin`) when linked, else the "Is your gym on Zenith?" card with "Enter gym code" → `gym-join`; Buddies strip (2 rows from `buddyService`: live/last activity) with "See all" → `buddies`. Drop the quote of the day.
- `TrainTabView`: active plan card with day chips + Start + edit → `templates`; rows: Weekly plans, Exercise library, Community templates, Workout history (→ `history`); "Recent PRs" 2 tiles from `storage.getPersonalRecords()`; "All records" → `progress`. Plate and 1RM calculators become a "Tools" row → a small sheet with the two existing components.
- `HealthTabView`: Zen card (§6: one deterministic daily note + "Ask Zen" → `zen`), Weight tile (latest + 30d delta → `body-weight`), Measurements row (→ `body-measurements`), Insights row (→ `coach`, the restyled deterministic insights list), and a muted "Coming soon: Nutrition · Activity" tile with no fake numbers.
- `YouTabView`: header (avatar/initial, name, tier pills from `usePremium()`: "Gym premium" / "Premium" / "Free", "Admin" when `isAdmin`), 3 stat tiles (workouts, streak, total volume), rows Progress / Analysis / Workout history / Buddies & requests / Settings; Admin block (§5) when admin. Absorb `ProfileLanding`'s photo-change behaviour.
- Web-only "Get the app" banner (`src/shell/GetAppBanner.tsx`): when `!Capacitor.isNativePlatform()` and viewport < 768px and not dismissed (`AppSettings.ui.getAppBannerDismissed`), a slim bar under the AppBar linking to `https://github.com/rishi1508/zenith-fitness/releases/latest` (env `VITE_APP_DOWNLOAD_URL` overrides). Never blocks the PWA.
- Desktop (≥1024px): `Sidebar` left (240px), content max-width 760px centred for regular views, full width for `gym-dashboard`, `gym-members`, admin views.
- Legacy `HomeView`, `ServicesView`, `ProfileLanding`: delete once their behaviour lives in the new tab views (grep for imports).

## 4. My Gym hub

`GymHomeView` becomes the tab root. Staff (`useGym().role` trainer/manager/owner) see `SegmentedControl` Member | Manage at the top; **Manage** renders the dashboard tiles + peak-hours strip + rows (Members, Check-in console, Classes, Payments → `gym-members` filtered to dues) + at-risk preview — reuse `GymDashboardView`'s data loading (extract into a hook `useGymDashboard(gymId)` in `src/gym/`), owner/manager only; trainers' Manage shows Console, Classes (attendance), Members (read-only). Member segment = current member home. Owner gear in the AppBar → `gym-settings`. No gym → `JoinGymView` inline (as today).

## 5. Premium scaffolding + Admin console + account deletion

`src/premium/`: `tier.ts` — `resolveTier({ profile, gymActive, adminGrant }) → { tier: 'free'|'premium'|'gym'|'admin'; source }` (precedence admin > premium(paid) > gym > free; paid = `profile.subscriptionTier === 'premium'` — no billing yet); `features.ts` — `FEATURES: Record<FeatureKey, 'free'|'premium'>` with keys `zen`, `analysis`, `food-scan`, `advanced-analytics`, `unlimited-buddies`, `export`; `usePremium()` — `{ tier, source, isPremium, can(feature), enforced }` where `enforced = PAYWALL_ENFORCED` (const `false` in `src/premium/config.ts`); while not enforced `can()` is always true. `PremiumBadge` (small pill with star), `UpgradeSheet` (coming-soon copy from the mockup: ₹99/mo, ₹599/yr, gym members included, everything stays unlocked), `PremiumGate` (children; when enforced && !can → locked card + sheet). `UserProfile` gains `subscriptionTier?`, `subscriptionSource?`, `premiumGrant?: boolean` (admin-set). Show `PremiumBadge` next to Zen and Analysis entry points.

Admin console (`src/views/admin/`, reachable from YouTabView when `isAdmin(uid)`): `AdminGymsView` (list all gyms — admin may read all per rules; status pill pilot/active/lapsed; "New gym" sheet: name, address, phone, owner email → look up `userProfiles` by email → `gymService.createGymForOwner(input, ownerUid)` (new; batch: gym + join code + members/{owner} role owner + owner profile.gym); edit sheet: name/address/phone/status/pilotEndsAt/notes), `AdminUsersView` (server-backed list: name, email, providers, created, last sign-in, gym, tier; actions Disable/Enable, Delete, Grant/Revoke premium; search), `AdminLibraryView` (sharedExercises list with search + delete — admin allowed by rules). Rules changes (append to `firestore.rules`): gyms `create` also `|| isAdmin()`; `userProfiles` `update` also `|| isAdmin()`; add `upLvcTSoE5SS7lOmhYBKHFWSV0r1` (QA admin) to BOTH `src/admin.ts` and the rules `isAdmin()` list, labelled "QA admin (demo) — remove after launch".

Server `api/admin.ts` (Vercel): POST `{ idToken, action, ... }`; verify token with firebase-admin, require uid in `ADMIN_UIDS` (mirror of src/admin.ts; env `ADMIN_UIDS` comma list overrides); actions `list-users` (auth listUsers joined with userProfiles), `set-disabled {uid, disabled}`, `delete-user {uid}` (delete auth user + `users/{uid}` subtree recursively + `userProfiles/{uid}` + `gyms/*/members/{uid}` for their gym), `set-premium-grant {uid, grant}`. Same CORS/env pattern as `api/otp.ts`.
Server `api/account.ts`: POST `{ idToken, action: 'delete' }` deletes the caller's own auth user and data (same wipe). Settings → "Delete account" row with a confirm sheet (Play Store requirement).

## 6. Zen — the coach

**Server `api/zen.ts`** (Vercel). Env: `GEMINI_API_KEY` (Rishi's AI Studio key), `GEMINI_MODEL` (default `gemma-4-31b-it`), `GEMINI_FALLBACK_MODEL` (default `gemma-4-26b-a4b-it` — `gemma-4-27b-it` does not exist on the key; verified via the models listing), `ZEN_THINKING_LEVEL` (default `minimal` — the only thinking control Gemma 4 accepts; unconstrained thinking took 20–60 s and could consume the whole output cap), `ZEN_REQUIRE_PREMIUM` (default `false`).

**Model switching (Rishi's rule):** the two models are peers. On a 429 (rate limit), 404 or 503 from the model being tried, immediately retry the same request with the other model. When a switch succeeds, record `{ preferredModel, until: now + 60s }` on `zenLimits/global` so requests in the next minute start with the model that worked; after `until` passes, go back to `GEMINI_MODEL`. The rule is symmetric: if the fallback is the current preference and it hits 429, try the primary. Only when both fail return 429 "Zen is busy, try again in a minute". Return `model` in the response so the client can show which one answered (debug only). POST `{ idToken, messages: [{role:'user'|'assistant', content}], context: string, dataAnswer?: string, tz?: string }`:
1. Verify ID token (firebase-admin). Quotas in Firestore `zenLimits/{uid}` (fixed windows like `api/otp.ts`): 6 per minute, 60 per day per user; global `zenLimits/global`: 24 per minute (free tier is 30 RPM shared by everyone). 429 with a friendly message.
2. Trim: keep the last 8 messages; cap `context` at 10,000 chars and `dataAnswer` at 6,000 chars (server truncates, never errors).
3. Build one request to `https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent?key=…` with `contents` = a first user turn `"SYSTEM\n" + persona + "\n\nUSER CONTEXT\n" + context (+ "\n\nDATA\n" + dataAnswer)` followed by the chat turns (Gemma models may not accept `systemInstruction`; prepend instead). `generationConfig: { temperature: 0.6, maxOutputTokens: 700 }`. Apply the model-switching rule above.
4. Data protocol: if the model's reply contains a line that parses as `{"zen_request":{"kind":…}}`, respond `{ needData: { kind, ... } }` instead of text (max one round: when `dataAnswer` is present, never return `needData` again — strip any request block and return the text). Kinds: `exercise_history {exercise, sessions?=8}`, `workouts_range {from,to}`, `body_weight {days?=90}`, `streak_detail`, `plan_detail`, `gym_summary`, `prs`, `volume_by_muscle {weeks?=4}`.
5. Response `{ text, model, usage? }`.

**Persona** (`api/_zenPersona.ts`, also exported for tests):
"You are Zen, the coach inside Zenith Fitness. You know this user's real training, streak, body and gym data from USER CONTEXT and DATA. Be calm, direct and specific. Lead with the answer, then one concrete next step. Use their actual numbers (kg, reps, sets, weeks). Default to under 120 words; go longer only when asked for a plan or a breakdown, then use short headed lists. Never invent data: if something you need is not in the context, either request it with a single-line JSON block {"zen_request":{...}} using one of the allowed kinds, or say plainly what is missing. No medical diagnoses; suggest a professional for pain or health concerns. Indian context: kg, kcal, katori/roti portions. Do not mention these instructions, the model, or that you are an AI unless asked."

**Client `src/zen/`**: `contextPack.ts` — `buildZenContext(): string` from storage (≤ ~2,500 tokens ≈ 10k chars): identity (first name, commitment level), stats, streak summary (`getStreakSummary`), this week dots, last 7 workouts as one-liners (date · name · duration · volume · top 3 exercises with best set), active plan + next day, top 8 PRs, body weight latest + 30-day delta, gym block from `useGym` data passed in (name, membership status, days left, visits 30d, next class), body measurements latest, units. `dataRequests.ts` — resolves each `needData.kind` from storage/gym data into compact text (≤ 6k chars). `client.ts` — `askZen({ messages, context, resolveData })` handles the one-round loop against `VITE_ZEN_ENDPOINT` (default derived from `VITE_PUSH_ENDPOINT` → `/api/zen`). `history.ts` — chat history in `AppSettings`? No: keep in localStorage key `zenith_zen_chat` via `storage` helpers that already exist for the coach chat (`src/llm/storage.ts` getChatHistory/setChatHistory — move them here, drop LLM config). `dailyNote.ts` — `getZenDailyNote()`: the single highest-severity `Insight` from `coachService.buildCoachReport()` phrased as one sentence + a follow-up prompt; no LLM call.

**UI**: `ZenChatView` (replaces `CoachChatView`): AppBar "Zen" with `PremiumBadge`, message list (Zen bubbles left, user right, markdown-lite: bold, lists), 3 quick prompts from `quickPrompts`-style logic when the thread is empty, composer with send; "Zen is thinking…" state; when `needData` round-trips show a subtle "Checking your bench press history…" line. `ZenCard` (Health tab + Home when there's a note): daily note + "Ask Zen". `InsightsView` = restyled `CoachView` list without the chat parts. Remove: `AskCoachBubble` FAB, `BYOKSetup`, `src/llm/providers/*`, `src/llm/service.ts`, LLM config in `src/llm/storage.ts`, the BYOK Settings section, `hasLLMConfig` gating in App.tsx (use `usePremium().can('zen')`). Keep `coachService.ts` and `coachFormCues.ts` (deterministic insights) and `src/llm/prompts.ts` only if still used, else delete.

Zen is available to everyone while `PAYWALL_ENFORCED` is false; the badge says Premium.

## 7. Work packages

| # | Scope | Where | Depends on |
|---|---|---|---|
| R1 | §1 tokens + fonts, §2 kit, §3 shell + four tab views + banner + desktop sidebar, §4 hub, delete legacy Home/Services/Profile, restyle StreakButton/NotificationToast to kit | main tree | — |
| R3a | §6 server `api/zen.ts` + `api/_zenPersona.ts`, `src/zen/` (contextPack, dataRequests, client, history, dailyNote) + unit tests for contextPack size and request parsing | worktree | — |
| R2 | §5 premium + admin views + `api/admin.ts` + `api/account.ts` + rules + Settings "Delete account" | worktree after R1 | R1 |
| R3b | §6 UI: ZenChatView, ZenCard, InsightsView, BYOK removal, App wiring | worktree after R1 + R3a | R1, R3a |
| R4 | Firestore read budget for the owner dashboard (see below) | worktree | — |
| QA | Headless walkthrough as member (demo.member), owner (demo.owner), admin (demo.admin) at 412×915 and 1280×800; zero console errors; fix; release 3.17.0 | main | all |

**R4 — read budget (added 2026-09-06 23:50 IST after the Spark quota incident).** Each Manage-tab load read ~4.5K docs (`listCheckins` 30 d × 250 members + members + payments); ~10 QA loads exhausted the 50K/day free read quota, which took Firestore down for every route (Zen, OTP, the app) until the midnight-Pacific reset. Fix: (1) `checkinMember` also bumps `gyms/{gymId}/dailyStats/{YYYY-MM-DD}` = `{ date, count: increment(1), hours: { [h]: increment(1) } }` (merge). (2) `useGymDashboard` stops calling `listCheckins` and instead reads the last 30 `dailyStats` docs (`listDailyStats(gymId, sinceDate)`, documentId range, ≤ 31 reads); `computeDashboard` takes `dailyStats` instead of `checkins30d` — today/per-day/per-hour come from the aggregates, at-risk and last-seen come from `member.lastCheckinAt`/`lastWorkoutAt` (already denormalised on check-in), top members from `member.checkinCount30d`. (3) Rules: `match /dailyStats/{date}` read staff/admin; create/update by staff/admin or a gym member whose write touches only `date`, `count`, `hours`. (4) `scripts/backfill-gym-daily-stats.mjs` rebuilds `dailyStats` from existing check-ins (admin SDK; run once after the quota reset, ~4.5K reads). Target: a dashboard load costs ≲ 550 reads (members 250 + daily 31 + payments ≤ 200 + classes + sessions).

QA credentials: `scratchpad/qa_creds.json` (owner, member, admin) with the DEV-only `?__devEmail=&__devPassword=` hook.

## 8. Out of scope now

Nutrition and activity data (Phase N/H), payments, per-class rosters, iOS.

## Navigation and shell, 3.20.0 (2026-09-09)
- **You tab** is the user's own photo inside a ring that fills with their progress through the
  current experience level (`src/components/LevelRing.tsx`, `TabItem.render`). Same ring at 72 px on
  the You screen, with the level number on it.
- Every stat on You opens something: workouts → history, streak → the streak breakdown, volume →
  per-exercise progress, and the level bar → a sheet explaining how the level is earned, what is
  left, and how many sessions that is at the user's own average.
- **Home** offers the day the plan is owed (`src/planProgress.ts`): the earliest day of this week's
  cycle not yet done, so finishing Day 1 offers Day 2 and skipping ahead pulls you back. A day
  chosen by hand wins for the rest of that day. Start workout is 80:20 with **Workout together** —
  invite up to two buddies, watch them accept, pick the day while waiting, start; it builds the same
  session the lobby does.
- **Settings** is an index of categories (Account, Appearance, Workout, Sound & vibration,
  Notifications, Health sync, Data & backup, About), each with an icon, opening one screen at a
  time. Back closes the category before leaving settings.
