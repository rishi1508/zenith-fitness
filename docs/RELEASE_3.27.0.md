# 3.27.0 — 2026-09-13

The Play Store build. Everything below came out of a full-project review done
as a 25-person launch team (see `docs/LAUNCH_REVIEW_2026-09-13.md` for the
findings, what was fixed, what was deferred and the owner's to-do list).

## The free / premium line, for real
- **Client gates** on Zen, Insights & analysis, Weight/phase/energy, plate
  scan and the buddy cap (3 on free). A locked screen says what the feature is
  and how Premium is obtained; there is nothing to buy — a gym that runs on
  Zenith is the way in. `PAYWALL_ENFORCED = true`.
- **Server checks** on Zen and the plate scan, so a modified client cannot
  reach the models. Admin > paid > gym member > free, on both sides.
- Verified headless: a free account meets a lock at all nine places; a gym
  member walks straight through all nine; the API answers 403 to the free
  account and serves the member.

## Fixed
- **Joining a gym by code did not work** — the joining member's +1 on the
  gym's member count was denied by the rules, which failed the whole batch.
- **Claiming an e-mail invite did not work** — the invitee could not read the
  placeholder membership, and the pointer written on success had a shape the
  app never read.
- **Anyone in a gym could work out today's check-in code offline**: the hash
  sat on the gym document every member can read; six digits behind a readable
  hash is a one-second brute force. The hash now lives in a staff-only
  document and the rules judge the member's input.
- **Push spam**: the push route accepted any recipient from any signed-in
  account. A push may only go to a buddy, someone with a pending request
  either way, or (staff) a member of the sender's gym. Announcements fan out
  server-side in one call instead of 300 client posts into the sender's own
  30-per-minute limit.
- **Account deletion was partial** (profile, tokens, notifications, buddy
  pairs, chats, follows, sessions, posts, comments, reactions and counters
  all stayed). It is complete now, the auth account goes first so a partial
  failure can never leave a signed-in account, and gym owners are refused
  until ownership is transferred.
- **Sign-in codes**: attempts are counted in a transaction (no racing past
  the five-try cap), per-device guess ceiling, the address is no longer stored
  in Firestore, a code whose e-mail failed to send is refunded.
- **Zen** could hold a request open for 100 s and then time out with nothing;
  a turn that produced no answer still counted against the day; the data
  protocol's second round was charged as a new turn; `energy_range` lookups
  were silently dropped. All four fixed. The OpenAI fallback also has a
  monthly ceiling now ($4 of the $8 credit) alongside a lower daily one.
- **Plate scan** works from one clock started at the top of the request, so
  the paid fallback always has room to finish inside the platform limit.
- The desk's check-in console re-read every check-in of the day every 30 s —
  a 300-member gym burnt ~36K reads an hour with the console open. It listens
  now: one read per new check-in.
- Payment and renewal land together or not at all. A member's 30-day check-in
  count is exact (it used to be an increment that never came back down).
  31 Jan + 1 month is 28 Feb, not 3 Mar.
- Sync: per-key timestamps, newer side wins, listener ignores stale
  snapshots; account-scoped state resets on account switch; every "day" is
  the local calendar day; guest data parked on sign-in and restorable from
  Settings. (From the client-core batch; details in the launch review.)
- Copy audit: no emoji in UI text, no exclamation-mark toasts, consistent
  sentence case, plain words for errors.

## Platform
- **AAB** built in CI next to the APK and attached to the release; version
  code derived from the version (3.27.0 → 32700); `allowBackup="false"`;
  PNG launcher/PWA icons; manifest description; service-worker cache v4.
- The in-app "Update available" banner no longer shows in the Android app
  (Play handles updates).
- Store assets and forms drafted under `store/play/` (icon, feature graphic,
  six screenshots, listing copy, Data safety, Health apps declaration,
  content rating).
- `public/privacypolicy.html` rewritten; it now states exactly what account
  deletion removes and what stays.

## Rules
62/62 cases in the Rules API matrix (36 new). Deployed 2026-09-12 ahead of
the tag so the desk code rotation could be verified end-to-end; the tag
redeploys the same file.
