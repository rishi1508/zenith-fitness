# 3.29.0 — 2026-09-13

Fourteen issues from Rishi's own use on 2026-09-12, plus the account model
the gym needs.

## Accounts
- **One person, one account.** Registration now collects name, mobile
  number, date of birth and sex. The number is claimed for the account on
  the server (`phoneIndex`), so two accounts can never share one, and it is
  the key that ties sign-in methods together: an e-mail code, Google, and
  SMS sign-in later all land in the same account. Existing accounts without
  a number see a one-time "finish your account" screen.
- **The front desk creates real accounts.** Adding a member (name + mobile
  required, e-mail/date of birth/sex optional) creates or links the person's
  Zenith account, fills their profile and writes the membership under their
  real uid. When they sign in, everything is already there — only the app
  tour remains. A number that belongs to another account, or a person in
  another gym, is refused with a clear message.
- **Nobody enrols themselves.** Joining by code and e-mail invites are gone;
  the rules only let staff create memberships. The old "Enter gym code"
  places now explain that the desk adds you by your number, and show the
  number to give them.
- **Switching accounts on one phone is clean.** Sign-out (and a sign-in by a
  different account) now also clears the Firestore cache and restarts the
  app, so nothing of the previous person survives.

## Buddy sessions
- Exercises added or removed by **any** participant reach every phone, at
  the **same position** as on the phone that made the change (they used to
  land at the end, and only the host's changes travelled). A removal is a
  removal for everyone.
- **One session at a time.** Starting or joining a session while you are
  hosting or in another one is refused with the name of the open session;
  lobbies abandoned for six hours are cancelled automatically.
- One notification at session start instead of two (participants no longer
  broadcast "started a workout" at each other).
- The Add Exercise button is no longer hidden behind the rest timer.

## Gym
- Posting an announcement completes as soon as the notice is saved; the
  push fan-out runs behind it (the composer used to sit on "Posting…").
- **Unseen announcements** show as a count on the Announcements tab and on
  the My Gym tab icon, cleared when the tab is opened.

## Health
- The water target is whole glasses (multiples of 250 ml), so it can
  actually be met one glass at a time.
- Charts (weekly kcal/water, peak hours, acquisition) read a bar only on
  **press and hold**, then slide; a plain swipe scrolls the page.
- Plate scan: smaller capture (1280 px, q80) and a larger Android heap, so
  the camera return is far less likely to be reclaimed mid-flight.
- Status bar: on edge-to-edge Android the bar's real height pads the page,
  so no header sits against the clock.
