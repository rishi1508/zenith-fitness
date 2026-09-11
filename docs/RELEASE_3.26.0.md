# 3.26.0 — 2026-09-12

## The camera, for real this time
Three earlier fixes changed how the camera was *opened*. None handled how it
*comes back*. Android reclaims the app's process behind the camera; Capacitor
delivers the photo on relaunch through `appRestoredResult` — never through the
promise that asked for it — and nothing listened. So the app restarted on Home
with the photo gone, which reads as a crash. `src/captureRestore.ts` now records
why a photo is being taken before the intent starts, catches the retained
result, and routes it: the plate lands in the scanner (right day, right meal),
a feed or notice photo reopens its composer with the shot attached. A toast
says so, so you can see it work on the phone. If the photo did not survive, it
says that instead.

## Fixed
- **Zen chat could not scroll, and lagged.** The shell's rubber-band hook saw
  the h-full chat as an un-scrollable page and hijacked every swipe; bubbles
  re-parsed their markdown twice a second while Zen was thinking. Same root
  cause, same fix, for buddy chat.
- **Profile photo viewer collapsed into a square on scroll.** A `fixed` element
  inside the transformed scroll content re-anchors to it. The viewer is
  portaled to `<body>` and the hook never starts a pull from inside an overlay.
- Empty app bar on every pushed screen is gone (headers start at 82 px, was 140).
- A buddy request already answered elsewhere no longer resurfaces as a card.
- Weekly kcal bars count "on target" within ±10 %, not "≥".

## New
- **Weekly bars** for kcal and water on the diary — 7 days, target line,
  press-and-slide to read any day.
- **Feed → Public feed | Announcements.** Notices moved out of the Member
  segment; staff post from the tab itself; an unread dot marks a new notice.
- **Analytics** (Manage → Analytics, owners/managers): MRR with 30-day change,
  CLV (and CLV:CAC once a marketing spend is set in gym settings), slipping
  members, 12-month acquisition vs churn, 90-day revenue split by category,
  trainer class utilisation, class fill, and an equipment log with uptime.
  Payments now carry a category (membership / personal training / other).

## Rules (apply to every installed build — update the APK)
- A buddy pair can only be created by the person who was asked, against a
  pending request from the other half; chats exist only for a pair.
- Buddy requests live at `<from>__<to>`; only `status` may change.
- Notifications may only be written by a buddy, the sender of the request that
  would make one, or yourself.
- Follower counts move only in step with a real follow edge; a member can bump
  the gym's daily footfall only for a day they checked in.
- New: `gyms/{id}/equipment` (staff read, manager write).

Verified: 26-case allow/deny matrix against the Firebase Rules API; 321 unit
tests; every screen swept headlessly as member and owner with zero console
errors.
