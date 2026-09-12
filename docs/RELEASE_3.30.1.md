# 3.30.1 — 2026-09-13

The "before a customer reports it" pass that followed the fifteen-point
walkthrough: the failures the app used to swallow, the raw error strings it
used to show, and the last screens that ignored the theme.

## Errors you can read
- **Plain-language errors.** Every toast that used to print whatever the
  database said (`FirebaseError: Missing or insufficient permissions`,
  `permission-denied`, `unavailable`) now says what happened in a sentence
  — "You do not have permission for that.", "You seem to be offline. Try
  again when you are back on the network.", "Your session has expired. Sign
  in again." One helper (`friendlyError`) does the mapping; messages our own
  code wrote in plain English pass through unchanged. Forty-plus sites across
  the gym, buddy, session, plan, profile and equipment screens. The sign-in
  screen keeps its own curated copy.
- **"Failed to X" → "Could not X."** Fallback copy on the session lobby,
  group session bar, staff payments, equipment and start-session sheet.

## Failures that were silent
- **Buddy chat.** A message or workout invite that did not send now says so
  (the text is put back in the box). Before, it disappeared quietly.
- **Buddies list.** If the list cannot load you see "Could not load your
  buddies. Try again" with a retry, instead of an empty screen. A failed
  search says "Search is unavailable right now."
- **Edit profile.** A save that fails keeps the form open and tells you.
- **Notifications toggle.** When the phone granted permission but the token
  could not be stored, the toggle used to look on while nothing was saved.
  It now says "Notifications could not be turned on. Try again."

## Gym screens
- **No more raw ids.** Where a trainer or member no longer matched an
  account, screens showed the account id. They now say "Unknown member"
  (check-in console, classes, gym settings, and every list that names a
  trainer).
- **Dues tile says what it counts** — "3 members", not a bare "3".
- **Offline screen follows the theme** (light-theme users no longer get a
  dark modal).
- **Weekly overview** "ACTIVE" pill → "Active".

## Housekeeping
- `src/friendlyError.ts` with unit tests (469 tests total, all green).
- Headless sweeps: free 9/9, member 9/9, owner 7/7, walkthrough 12/12, zero
  console errors.
