# 3.30.0 — 2026-09-13

Rishi's fifteen-point walk through the app, plus the root causes behind the
three that had been reported before.

## Root causes, finally
- **Plate scan "crash".** Every capture path handed the phone to the system
  camera — an intent that puts Zenith in the background, where Android
  reclaims the process on many phones; the photo then came back through a
  relaunch that read as a crash. The scan now photographs **inside the app**
  (a live camera preview, `InAppCamera`), so the app never leaves the
  foreground and there is nothing to restore. Choosing an existing photo
  still uses the system picker (rare path; restore stays wired for it).
- **Header sliding under the status bar.** Three different sources of "how
  tall is the status bar" (the browser's `env()`, Capacitor 8's injected
  `--safe-area-inset-top`, and a height read once at startup) disagreed at
  different moments. One CSS variable now takes the largest of the three and
  every header and overlay uses it.
- **Page jumping to the top when a scroll started on a chart.** The
  rubber-band scroll hook skipped the start of gestures on charts but kept
  handling their movement against the previous gesture's start point.

## Training
- **Deload, explained.** The banner is in plain words with an "i" sheet
  (what it is, why you, what to expect) and "Ask Zen". "Plan a deload week"
  marks the next seven days: each workout shows a calm banner, a **target**
  on every exercise (60% of your recent best, same reps — new exercises too),
  set feedback that never says "lower", no PR fanfare. Deload workouts still
  count for streaks and totals but stay out of PR detection, trend charts and
  comparisons.
- **Home start card.** The day name is the day picker; the buddy button is
  labeled "With a buddy"; "Change plan" opens your weekly plans.
- **Streak freeze.** The counter counts training days (two sessions in one
  day count once) and now says so; the hero, calendar and legend follow the
  commitment you pick, immediately.
- **Insights first.** A quiet Insights card at the top of Home reads your
  trend and offers "Ask Zen" with the question prefilled.
- **Analysis, rebuilt.** Training load, consistency, per-exercise strength
  (estimated 1RM), muscle balance, recovery signals and ranked actionables
  over 4 weeks, 12 weeks or all time — every number with an explainer — plus
  a daily coach's read from Zen and "Ask Zen about this".
- **Buddy sessions** (from 3.29): shared exercise lists, one session at a time.

## Nutrition
- "Log food" opens Add food directly; tapping the ring or macros opens the
  diary. Add food keeps the keyboard closed until you tap, leads with
  "Scan your plate", and starts on Recents. Food rows no longer say where the
  data came from; press and hold a food you created to edit or delete it.
- The diary date is tappable: a calendar with logged days in orange, future
  days and days before your account greyed out. "Targets" is labeled. The
  water target is whole glasses (multiples of 250 ml), also for targets saved
  earlier.
- Plate scan: no "scans left" counter (the daily limit is 20 and you are only
  told when you reach it); the camera starts on a black screen with
  "Starting camera…" — no placeholder glyph — for the plate, barcode and
  gym QR scanners.

## Gym
- Members and staff see different Exercise videos and Workout plans screens:
  members browse and use; staff add, edit, publish and remove.
- A profile's Photos tab is visible only to people in the same gym.
- Activity log for gyms and error reports for admins (from the management
  session): who did what, when.
