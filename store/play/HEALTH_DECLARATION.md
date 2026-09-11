# Play Console Health apps declaration — Zenith Fitness

Covers Play Console → App content → **Health apps declaration form**, and
the Health Connect **permissions rationale** requirement. Based on
developer.android.com/health-and-fitness/health-connect/publish (fetched
2026-09-12) plus what's actually in this repo — re-check the live console
form, whose exact field wording can move.

## 1. Health features (checkbox section)

Select:

- **[x] Activity and fitness** — the app reads steps, calories, heart rate,
  sleep and exercise sessions, and shows them back to the user
  (`src/activity/healthConnect.ts`, `ActivityView`).
- **[x] Nutrition and weight management** — the app reads and writes body
  weight via Health Connect (`WRITE_WEIGHT`), and uses it together with the
  in-app nutrition diary for the bulk/cut phase engine (`docs/HEALTH_SPEC.md`
  §5, §4).
- Leave every **Medical** and **Human Subjects Research** box unchecked —
  Zenith gives no diagnosis, treatment or clinical-research functionality;
  `ZEN_PERSONA` explicitly tells the coach to suggest a professional for pain
  or health concerns, never to diagnose (`api/_zenPersona.ts`).

Do **not** check "My app does not have any health features" — it reads and
writes Health Connect data.

## 2. Data type category explanations

Health Connect groups its record types into a handful of categories in the
declaration form (Activity, Body measurements, Sleep, Vitals — the exact
console grouping labels can differ slightly from this list; match by the
underlying record type, not the label). Per-permission rationale, ready to
paste, one sentence each — these describe exactly what `src/activity/healthConnect.ts`
does with each and nothing more:

| Permission (`AndroidManifest.xml`) | Health Connect record type | Rationale sentence |
|---|---|---|
| `READ_STEPS` | Steps | "Reads your daily step count so Zenith can show your activity alongside your logged workouts." |
| `READ_ACTIVE_CALORIES_BURNED` | ActiveCaloriesBurned | "Reads active calories burned so Zenith can show energy expenditure from your workouts and daily movement." |
| `READ_TOTAL_CALORIES_BURNED` | TotalCaloriesBurned | "Reads total calories burned so Zenith can compare what you eat against what you burn." |
| `READ_HEART_RATE` | HeartRate | "Reads your heart rate readings to show your daily average alongside your training." |
| `READ_RESTING_HEART_RATE` | RestingHeartRate | "Reads your resting heart rate to show trends in recovery over time." |
| `READ_SLEEP` | SleepSession | "Reads your sleep sessions so Zenith can show sleep duration next to training load." |
| `READ_EXERCISE` | ExerciseSession | "Reads exercise sessions logged in other apps so all your workouts appear together in one activity view." |
| `READ_WEIGHT` | Weight | "Reads your weight history so Zenith's charts and phase tracking stay in sync with what you log elsewhere." |
| `WRITE_WEIGHT` | Weight | "Writes a weight entry when you log it in Zenith, so your other Health Connect–connected apps see the same number." |

**Use case (top-level, for the form's free-text justification):** fitness and
wellness — activity and energy tracking, phase (bulk/cut/maintain) coaching,
and as context for the in-app AI coach ("Zen") to answer the user's own
questions about their own training and activity data. Not a medical device,
not for diagnosis or treatment.

`WRITE_EXERCISE` is deliberately **not** requested — the manifest comment
explains no Capacitor plugin buildable against AGP 8 can write an
`ExerciseSessionRecord`, so finished Zenith workouts are recorded in the
app's own `ActivityDay` model instead of Health Connect
(`src/activity/healthConnect.ts` file header).

## 3. Privacy policy requirement

Health Connect requires the privacy policy shown to the user from the
permissions-rationale screen to be the **same** one linked from the Play
Store listing. This app satisfies it as follows:

- The rationale activity (`ACTION_SHOW_PERMISSIONS_RATIONALE` intent filter,
  plus the Android 14+ `ViewPermissionUsageActivity` alias) ships inside the
  `@capgo/capacitor-health` plugin's own library manifest and merges in
  automatically — see the comment block above the health `<uses-permission>`
  entries in `android/app/src/main/AndroidManifest.xml`.
- It renders `public/privacypolicy.html`, which the Vite build plus
  `npx cap sync android` copies to `android/app/src/main/assets/public/privacypolicy.html`
  — i.e. the on-device copy is the exact same file as the one this task
  rewrites and hosts at
  `https://zenith-fitness-18e2a.web.app/privacypolicy.html`.
- Because both are the same file by construction, the Play Store listing's
  privacy policy URL (`store/play/LISTING.md`) and the in-app rationale
  screen automatically stay in sync — there is nothing extra to wire up here
  beyond keeping that one file current.
- Action item for Rishi: after any future `public/privacypolicy.html` edit,
  re-run `npx cap sync android` before the next release build so the bundled
  asset doesn't drift from the hosted page — the two will look identical
  today (right after this task), but that only holds until the next sync.

## 4. Notes / things worth double-checking

- The "Activity and fitness" + "Nutrition and weight management" pairing is
  my read of the closest fit to what the app actually does; the live Play
  Console form's exact checkbox wording wasn't directly viewable from here
  (fetched via a summarizing tool, not a logged-in console session) — sanity
  check the two boxes against the console's own copy before submitting.
- If `docs/HEALTH_SPEC.md` §4's TODO ever turns into shipping a plugin that
  *can* write exercise sessions, add `WRITE_EXERCISE` here and to the
  manifest at the same time — the declaration must list every permission
  actually requested, no more, no less.
