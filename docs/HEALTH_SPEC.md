# Health Management upgrade — spec (v1, 2026-09-07)

Phase N (nutrition) + Phase H (activity, Health Connect, bulk/cut) of ROADMAP.md, built in one pass and
released as 3.18.0. Decisions confirmed by Rishi on 2026-09-07: full scope; ~250 curated Indian dishes
labelled approximate; camera food scan on a Gemini free-tier model cascade; Health Connect read **and**
write-back of workouts. Nutrition logging is free for everyone (D9); analysis, phase engine and camera scan
are Premium (badge only while `PAYWALL_ENFORCED` is false).

## 0. Ground rules (same as docs/REVAMP_SPEC.md §0)
- Tailwind v4 tokens + the `src/ui` kit only. Dark-first, kg/kcal, Indian portion units. No new UI kit.
- Every Firestore read costs money now (docs/COST_CONTROLS.md). Per-day documents, no unbounded listeners,
  no per-keystroke queries. Food search is client-side over static JSON.
- Surgical diffs; match existing style; `git commit -F`; verify with `npm run build`, `npm run lint`
  (scoped to your files), `npx vitest run tests` for pure logic.
- Integration contract: each package exports its views from its own barrel and does NOT edit `src/App.tsx`,
  `src/views/tabs/*`, `src/types.ts` or `firestore.rules` (the integrator wires those). Report the exact
  props of every view you export.

## 1. Shared foundation (already on main — read before coding)
- `src/types.ts` → `Macros`, `FoodSource`, `FoodUnit`, `FoodItem`, `MealSlot`, `FoodEntry`, `NutritionDay`,
  `NutritionTargets`, `ActivitySession`, `ActivityDay`, `PhaseGoal`, `ActivityLevel`, `HealthProfile`,
  `PhaseSettings`.
- `src/health/store.ts` → per-day docs `users/{uid}/nutrition/{date}` and `users/{uid}/activity/{date}`
  with a 90-day cache: `getNutritionDay/saveNutritionDay/fetchNutritionDay/listNutritionDays/
  fetchNutritionRange`, same for activity, small synced values (`getHealthProfile`, `getPhaseSettings`,
  `getTargets`, favourites, recents, custom foods), `subscribeHealth(fn)` for React, `localDateISO`,
  `addDaysISO`, `sumMacros`.
- `src/health/targets.ts` → `estimateBmr`, `estimateMaintenanceKcal`, `computeTargets` (H2 refines).
- `firestore.rules` → `sharedFoods/{foodId}` with the sharedExercises creator model.
- Premium: `usePremium().can('food-scan' | 'analysis')`, `PremiumBadge`, `PremiumGate` from `src/premium`.
- Charts: `InteractiveLineChart` in `src/components/InteractiveLineChart.tsx` (used by BodyWeightView).
- Camera: `src/components/gym/QrScanner.tsx` shows the getUserMedia + permission pattern that works in the
  Capacitor webview and the PWA.
- Tests: `npx vitest run tests` (vitest is a dev dependency; put pure-logic tests in `tests/*.test.ts`).

## 2. Food data — package N1 (`scripts/build-food-db.mjs` → `public/data/foods/`)
Sources, all free:
| Source | How | Licence / attribution |
|---|---|---|
| IFCT 2017 (NIN Hyderabad), 542 foods | npm `@ifct2017/compositions@2.0.9` (`index.csv`, per 100 g; columns documented by `@ifct2017/columns@2.0.13`). **Pin 2.0.9 — it is MIT; the 2025+ repo is AGPL.** Energy column `enerc` is kJ in IFCT: convert to kcal (÷ 4.184). | MIT package; show "Source: IFCT 2017, ICMR-NIN" in the food detail. |
| USDA FoodData Central | Foundation Foods CSV `https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_foundation_food_csv_2026-04-30.zip` (3.7 MB) + SR Legacy CSV `…/FoodData_Central_sr_legacy_food_csv_2018-04.zip` (6.7 MB). Keep generic raw/cooked ingredients only (filter to ~2,500: meats, dairy, grains, legumes, fruit, veg, nuts, oils, eggs; drop branded/restaurant/baby food). Nutrient ids: 1008 kcal, 1003 protein, 1005 carbs, 1004 fat, 1079 fiber, 2000 sugar, 1093 sodium. | Public domain; "Source: USDA FoodData Central". |
| Curated Indian dishes (~250) | Authored in `data/dishes.in.json` by N1: name, aliases (Hindi/regional), group, recipe-derived per-100 g macros computed from IFCT/USDA ingredients with standard home recipes, default units (katori 150 g, small katori 100 g, roti 40 g, paratha 80 g, idli 40 g, dosa 90 g, piece, cup 240 ml, tbsp 15 g, tsp 5 g, glass 250 ml, plate 300 g). `approx: true`. Cover: dals, sabzis, rice dishes, rotis/parathas, South Indian breakfast, snacks/chaat, sweets, beverages (chai, lassi, nimbu pani), non-veg curries, eggs, paneer dishes, common restaurant items. | Ours; UI shows "approx." and lets users correct via the creator model. |
| Open Food Facts | Live lookup by barcode from the client: `GET https://world.openfoodfacts.org/api/v2/product/{barcode}.json?fields=product_name,brands,nutriments,serving_size,quantity` with header `User-Agent: ZenithFitness/3.18 (rishimishra1508@gmail.com)`. Map `energy-kcal_100g`, `proteins_100g`, `carbohydrates_100g`, `fat_100g`, `fiber_100g`, `sugars_100g`, `sodium_100g` (g → mg). Cache hits in `zenith_custom_foods`-style local cache (`zenith_off_cache`, 500 items). | ODbL: show "Data from Open Food Facts" on barcode results. |

Output: `public/data/foods/index.json` (compact search index: `[id, name, aliases, group, source, kcal100]`)
plus shards `public/data/foods/{ifct,usda-a..z,dishes}.json` with full `FoodItem`s. Target ≤ 1.5 MB total
gzipped. Every food carries `units` (grams implicit); IFCT/USDA foods get group-default units (e.g. cereals
→ katori/cup, fruit → piece, oils → tbsp/tsp).
`src/nutrition/foodDb.ts`: `loadFoodIndex()` (lazy, cached in memory + Cache API via the SW), `searchFoods(q,
{limit})` (tokenised prefix + alias match, ranked: exact > startsWith > contains; dishes and IFCT before
USDA; favourites/recents boosted), `getFood(id)` (loads the shard), `lookupBarcode(code)` (OFF with cache),
`gramsFor(food, qty, unit)`, `macrosFor(food, grams)`. `src/nutrition/units.ts` holds the unit table.
Unit tests: index build spot-checks (dal, roti, paneer, rice, banana, chicken breast), kJ→kcal, unit math.

## 3. Diary + targets UI — package N2 (`src/views/nutrition/`, barrel `index.ts`)
- `NutritionTodayView` — date header with ‹ › day switcher (today default), calorie ring + protein/carbs/fat
  bars vs targets, meal sections (breakfast/lunch/dinner/snacks) with entries (name · qty unit · kcal ·
  approx tag), swipe/long-press delete, water counter (+250 ml chips), "Copy yesterday", "+ Add" per meal →
  `FoodSearchView`. Loads `getNutritionDay(date)` instantly, then `fetchNutritionDay(date)` once per view.
- `FoodSearchView` — search box (debounced, client-side), tabs Recents · Favourites · All, barcode button
  (`BarcodeScanView`: `@zxing/browser` `BrowserMultiFormatReader` with EAN-13/EAN-8/UPC-A hints; reuse the
  QrScanner camera/permission pattern; PWA + APK), "Create food" (name, brand, per-100 g macros, units →
  `saveCustomFood` + `sharedFoods` create with `createdBy/createdByName/createdAt`), "Quick add" (kcal + macros
  only). Selecting a food opens `FoodEntrySheet`: qty stepper, unit picker (food.units + g), live macros,
  meal picker, Add → `saveNutritionDay`, `pushRecentFood`.
- `TargetsView` — auto (from `computeTargets` using `getHealthProfile`, latest body weight from
  `storage.getLatestBodyWeight()`, `getPhaseSettings()` or maintain/0) or manual override; profile sheet
  for sex / height / birth year / activity level (`setHealthProfile`). Show how the number was derived.
- `NutritionRing` (small component exported for Home/Health cards): kcal consumed vs target.
- Deps you may add: `@zxing/browser@^0.2`, `@zxing/library@^0.23`.

## 4. Activity + Health Connect — package H1 (`src/activity/`, `src/views/activity/`)
- Plugin: `@capgo/capacitor-health@^8` (Capacitor 8, Health Connect on Android 8+). Verify in its README
  whether exercise sessions can be **written**; if not, evaluate `capacitor-health@^8` for write-back, and
  report which you used. Android: bump `minSdkVersion` 24 → 26 in `android/variables.gradle`, declare only
  the permissions we request (READ_STEPS, READ_ACTIVE_CALORIES_BURNED, READ_TOTAL_CALORIES_BURNED,
  READ_HEART_RATE, READ_RESTING_HEART_RATE, READ_SLEEP, READ_EXERCISE, WRITE_EXERCISE, READ/WRITE_WEIGHT),
  add the permissions-rationale activity/intent filters the plugin documents, ship
  `android/app/src/main/assets/public/privacypolicy.html` (plain, honest, links to the web privacy policy).
- `src/activity/healthConnect.ts`: `isAvailable()`, `requestPermissions()`, `syncDays(from, to)` → builds
  `ActivityDay`s (steps, active/total kcal, resting/avg HR, sleep minutes, sessions) and `saveActivityDay`
  with `source: 'health-connect'` (manual fields preserved → `'mixed'`), `writeWorkout(workout)` → an
  exercise session (type strength training, start/end, kcal if known). Replace the stub in
  `src/healthSync.ts` so `syncWorkoutToHealth` (called from App.tsx on finish) actually writes when the
  user enabled it in Settings (`isHealthSyncEnabled`). Web/PWA: `isAvailable()` false → manual only.
- `ActivityView`: today's steps / active kcal / sleep / resting HR tiles, 7-day bars (steps), sessions list,
  "Sync now" + last-synced line, manual entry sheet (steps, sleep, kcal) for non-syncing phones; connect
  card when Health Connect is available but not authorised. Sync on view open at most once per 15 min.
- `src/activity/index.ts` barrel exports `getWeeklyActivitySummary(days=7)` for the phase engine and Zen.

## 5. Phase engine — package H2 (`src/phase/`, `src/views/phase/`)
- `src/phase/engine.ts` (pure, tested): `weightTrend(entries, days=14)` → EMA series + weekly rate in
  kg and %/week (needs ≥ 4 points over ≥ 7 days, else `insufficient`); `classifyPhase(ratePct)` →
  bulk (> +0.25), cut (< −0.25), maintain; `adaptiveMaintenance({ intakeKcalByDay, weightTrend })` → intake
  average − (rate kg/week × 7700 / 7) when ≥ 10 logged days in the window, else `estimateMaintenanceKcal`;
  `evaluateGoal(settings, trend)` → status on-track / too-fast (> 1.5× target for cut, > 2× for bulk) /
  stalled (|rate| < 0.1 %/week for 3 weeks while cut/bulk) with one-sentence guidance and a suggested
  kcal adjustment (±100–200). Refine `computeTargets` inputs to use the adaptive maintenance when available
  (keep the signature).
- `PhaseView`: goal card (bulk/cut/maintain, target rate presets: cut −0.5/−0.75, bulk +0.25/+0.5, maintain
  0), start date, weight trend chart (raw dots + EMA line via `InteractiveLineChart`), rate badge, status
  line + guidance, "Recalculate targets" → `setTargets(computeTargets(...))`, `PremiumBadge` in the AppBar.
- `PhaseCard` (compact, exported for the Health tab): current phase · rate · status.

## 6. Camera scan + model cascade + Zen — package S1 (`api/`, `src/nutrition/scan.ts`, `src/views/nutrition/FoodScanView.tsx`, `src/zen/`)
- `api/_modelRouter.ts`: ordered cascade with daily free-tier budgets (Rishi's rule — use the strongest
  first, move on when the next call would exhaust a model's daily quota, come back tomorrow):
  `gemini-3.8-flash` 20, `gemini-3.7-flash` 20, `gemini-3.6-flash` 20, `gemini-3.5-flash` 20,
  `gemini-3.5-flash-lite` 500, `gemini-3.1-flash-lite` 500 (requests per day, Pacific-midnight reset like
  the API). Counters in one Firestore doc per day `aiQuota/{YYYY-MM-DD}` = `{ [model]: count }` updated in a
  transaction; keep 1 request of headroom per model. A 429 from a model marks it exhausted for the day
  (`exhausted.[model] = true`) and falls through to the next. All ids verified on the key on 2026-09-07.
  Export `pickModel(db, purpose)`/`recordUse`/`markExhausted` so Zen can adopt it later; do not change Zen's
  Gemma routing now.
- `api/foodscan.ts` (Vercel, same auth/CORS/HttpError pattern as `api/zen.ts`): POST `{ idToken, image
  (base64 JPEG ≤ 1024 px, ≤ 700 KB), hint? }`; per-user quota 10/day (`zenLimits/{uid}.scan`), global
  guard via the router; prompt asks for strict JSON `{ items: [{ name, grams, kcal, protein, carbs, fat,
  confidence }], note }` with Indian dish names and household units in `note`; validate/repair JSON;
  return `{ items, note, model }`. Env: `GEMINI_API_KEY`, `FOODSCAN_PER_USER_PER_DAY` (default 10).
- `src/nutrition/scan.ts`: capture (`<input type=file accept=image/* capture=environment>` fallback +
  getUserMedia), downscale on a canvas to 1024 px JPEG q0.8, call the route, map items to `FoodEntry`s
  with `approx: true`, `source: 'dish'`, `foodId: 'scan:<slug>'`.
- `FoodScanView`: preview → "Analysing…" placeholder (same rotating-status pattern as ZenChatView) →
  editable result list (adjust grams, remove items) → "Add to <meal>". `PremiumGate` around the entry.
- Zen: `buildZenContext` adds "Nutrition: today X kcal / P C F vs targets; 7-day avg …; logged N of 7 days",
  "Activity: 7-day avg steps, sleep, active kcal", "Phase: goal · rate · status". New `ZenRequestKind`s:
  `nutrition_range {from,to}`, `activity_range {from,to}`, `phase_detail`; resolvers in `dataRequests.ts`;
  persona line: "Nutrition coaching: kcal and grams, Indian portions; flag approximate values as such."
  Tests for the router's selection/exhaustion logic and the scan JSON repair.

## 7. Integration (integrator, after merge)
- `src/App.tsx` routes: `nutrition`, `food-search`, `food-scan`, `nutrition-targets`, `activity`, `phase`.
  `src/shell/tabs.ts` maps them to the Health tab.
- `HealthTabView`: replace the "Coming soon" card with `NutritionRing` today card (→ nutrition), rows
  Activity, Weight & phase (`PhaseCard`), Measurements, Insights, ZenCard. `HomeTabView`: compact
  `NutritionRing` row under the streak card when targets exist.
- Settings: Health Connect toggle already exists (`SettingsView` ~line 841) — H1 wires it to the real plugin.
- Rules deploy (sharedFoods), `npm install`, QA (member/owner/admin + nutrition flows headless; Health
  Connect and camera on Rishi's phone in the morning), version 3.18.0, tag.

## 8. Out of scope
Micronutrients, recipes builder, iOS HealthKit, FatSecret, restaurant chains, water reminders/notifications.

## 9. As built (2026-09-07, integrator notes)
- **Shipped in 3.18.0.** Packages N1, N2, H1, H2, S1 merged; App/tabs wired per §7; `FoodSearchView` gained
  `onOpenScan` (camera icon next to the barcode button) as the plate-scan entry point.
- **Health Connect write-back gap.** No Capacitor plugin that builds under AGP 8 can write
  `ExerciseSessionRecord`; `@capgo/capacitor-health` reads steps / calories / heart rate / resting HR / sleep /
  sessions and writes weight only. Finished Zenith workouts are recorded on our own `ActivityDay`
  (`source: 'zenith'`) so the Activity screen shows them; writing them into Health Connect needs a small
  custom Kotlin plugin (or the flomentum plugin once it supports AGP 8) — deferred, see §10.
  `WRITE_EXERCISE` is deliberately not declared. `minSdkVersion` is 26 (Android 8.0+).
- **Phase engine rate** is the least-squares slope through daily weights (not EMA endpoints) — the endpoint
  form under-reads by 25–55 % for weekly loggers. `InteractiveLineChart` gained an additive `overlay` prop.
- **Food data as built:** 3,236 foods — 542 IFCT, 2,420 USDA, 274 curated dishes; 1.36 MB raw / 188 KB
  gzipped; `index.json` precached by `public/sw.js`. IFCT `enerc` blank/contradictory on 15 rows → kcal derived
  from macros. USDA names are verbatim (long). `lookupBarcode` cannot set `User-Agent` from a browser; OFF sees
  the platform UA.
- **Model router state** lives in `aiQuota/{Pacific date}`; first live scan used `gemini-3.8-flash`
  (11 s, six items with grams and macros). Per-user scan quota 10/day; `FOODSCAN_REQUIRE_PREMIUM` left false
  while `PAYWALL_ENFORCED` is false.
- **Shared foods** are written to `sharedFoods` but never read back (no listener by cost rule); user-created
  foods are visible only to their creator until a cheap index doc exists.
- **QA:** scratchpad `qa_318.mjs` (member: targets → diary add → Home ring → phase → manual activity → Zen)
  and `qa_317.mjs` (roles) both clean; `foodscan_e2e.mjs`, `barcode_e2e.mjs`, `zen_e2e.mjs` live checks pass.
  Not testable headless: Health Connect permission flow, camera capture, barcode camera scan.

## 10. Follow-ups
1. Health Connect workout write-back (custom plugin) — needs a device to test.
2. `sharedFoods` discovery: one index doc updated on create, read once per session.
3. Shorter display names for USDA foods; more regional dishes (Bengali, North-East).
4. Per-user rate limit on `api/push.ts`; `request.query.limit` bounds in rules (docs/COST_CONTROLS.md §3).
5. Remove QA admin uid from `src/admin.ts`, `api/admin.ts`, rules after the pitch.

## 11. Post-launch feedback round (3.18.2 / 3.18.3, 2026-09-08)
Owner testing on Android produced 14 issues; all are addressed. Notes worth keeping:
- **Group sessions** built the workout repeatedly (`SessionLobbyView` fired `onSessionStart` on every
  snapshot AND re-subscribed on every parent render because the callback was a fresh arrow). Each repeat
  hit `startWorkout`'s "discard?" prompt, so the session workout was never built. Fixed with a
  fire-once ref + a stable listener; `templatesEqual` no longer compares `defaultReps` (it changes on
  every set logged, so the participant reconcile — which deletes unlogged exercises — ran constantly).
- **Plate scan** killed the WebView: a 12 MP JPEG was decoded at full size for the preview *and* for
  the canvas. Now `createImageBitmap` with resize options, `toBlob` instead of `toDataURL`, the small
  copy is the preview, and the fetch has a 75 s deadline. One capture path only (camera / gallery).
- **Zen** returned 502 on the data round-trip: the API answers 500 "Internal error encountered" for some
  valid prompts on one Gemma model while the peer serves them. 5xx is now switchable; only 429 pins the
  preferred model.
- **Food search** ranking: a name whose head (before the first comma/bracket) equals the query gets
  +45, and raw IFCT staple groups get −200 unless the user has logged them. Canonical foods must be
  named so the head IS the search word — "Rice (cooked)", not "Plain rice (cooked)".
- **ml basis**: `FoodItem.basis` / `FoodEntry.basis` = 'ml' for drinks; `per100g` then means per 100 ml
  and every label says ml. 41 foods carry it.
- **Saved meals**: `SavedMeal` in `zenith_meals` (synced), published to `sharedMeals` (rules mirror
  sharedFoods). The Community tab reads 20 docs on demand — no listener.
- **Experience levels**: `src/levels.ts`, lifetime volume → level, step 1.5 t then 2.5 t then ×1.35.
  `zenith_level_seen` is seeded silently on first run so nobody is congratulated for old history.
- **Buddy ordering**: `src/buddyAffinity.ts`, local synced tally with a 30-day half-life. No new reads.

## 12. "Only shows the first exercise" — the actual cause (3.18.4, 2026-09-09)
Two different bugs wore the same symptom, which is why the first fix did not land.
1. **3.18.2** fixed `SessionLobbyView` calling `onSessionStart` on every snapshot (real, but only
   affected group sessions).
2. **3.18.4** fixed the one that bit him: **the active workout had no scroll region.** It is the only
   view rendered outside `AppShell`, and the app root is `h-dvh flex flex-col overflow-hidden`. A
   six-exercise workout is ~3 500 px inside a 915 px box, so everything below the first exercise was
   clipped with no way to scroll. Reproduced headlessly (`scratchpad/repro_active.mjs`) before fixing:
   all six exercises were in the DOM and in localStorage, only the container was wrong.
   **Rule: any view rendered outside AppShell must supply its own `overflow-y-auto` main.**
   `scratchpad/qa_318.mjs` now asserts the active workout scrolls to its last exercise.

Connectivity: `useOnlineStatus` gave Firestore a single 4 s attempt; a cold channel on mobile data is
often slower, so the blocking gate appeared on nearly every launch. Now two attempts at 8 s each, and a
`permission-denied` still counts as reachable.

## 13. Energy ledger (3.19.0, 2026-09-09)
`src/energy.ts` is the model, `src/health/energyDay.ts` wires it to what is stored, and
`src/health/energyInsights.ts` turns it into advice. Three layers, deliberately kept apart so
nothing is counted twice:

| Layer | Source | Notes |
|---|---|---|
| `resting` | Mifflin–St Jeor BMR ÷ 24 h | Null when the profile lacks height/age/sex. Fallback 1 kcal/kg/h. |
| `workouts` | Logged sets × the exercise's MET | Session minutes apportioned by `sets × (setSeconds + restSeconds)`, priced per exercise; real `duration` is ground truth, capped at 240 min. |
| `movement` | Steps, or the device's own active kcal | `active = max(device, our estimate)`, never a sum. |

`activeKcal = (MET − 1) × restingKcalPerHour × hours`, so the resting burn during a session is
never double counted. `Exercise.met` is optional: absent means derive it from the category
(`DEFAULT_MET_BY_CATEGORY`) plus an equipment delta. The creator can set a real MET in the
exercise library and it rides along on the shared exercise doc.

UI: `EnergyCard` on the Health tab → `EnergyView` (`view: 'energy'`) with the day's split, the
phase's target balance, a 7-day burned-vs-eaten strip and the insights. The end-of-session
celebration shows `workoutEnergy().activeKcal` as "kcal burned".

Zen: today's line is in the context pack (`energyContextLine`), and `energy_range` is a new
`zen_request` kind returning the day-by-day ledger. The answer states that active calories are
`max(device, estimate)` so the model does not add them up.

Health Connect now syncs itself (`src/activity/autoSync.ts`): on launch, on foreground, and every
15 minutes, behind one staleness gate and one in-flight promise. Before this, the numbers only
refreshed while the Activity screen was open — which was wrong everywhere else the moment the
ledger started reading them.

## 14. Feel (3.19.0)
`src/sound.ts` synthesises ten cues with the Web Audio API (nothing in the bundle, no licence);
`src/haptics.ts` pairs each with a vibration pattern; `feedback(cue)` fires both and each channel
checks its own switch (`zenith_sound_settings`, `zenith_haptic_settings`). Constraints held by
`tests/feedback.test.ts`: every cue under 700 ms, 329–2100 Hz, sine/triangle only, routine haptics
one beat. Wired to set completion, rest start / three-seconds-out / done, PRs, finishing a session
and levelling up.

## 15. Camera capture on Android (3.19.0, 2026-09-09)
The plate scan and the gym feed's progress photo go through `@capacitor/camera`
(`src/nativeCamera.ts`) on native, and keep the `<input type="file">` only on the web.

Why, after "taking photo still crashes the app" on 3.18.5: a file input with `capture`
hands the screen to the system camera app from inside the WebView, and
(a) this app *declares* `android.permission.CAMERA` for the QR scanner, which makes the
runtime grant mandatory before any image-capture intent may start — without it the launch
throws and the process dies; (b) the camera app is memory-hungry, so Android often destroys
our activity behind it and the WebView returns cold, losing the photo. The plugin owns the
permission prompt and the bridge restores the pending call across a recreated activity. It
also writes an already-downscaled file (1600 px), so the 12 MP original is never decoded in
the WebView; `prepareScanImage` still does the final 1024 px framing.

Supporting changes: `READ_EXTERNAL_STORAGE` (maxSdk 32) for gallery picks on Android ≤ 12;
the FileProvider covers external-files and files dirs; `variables.gradle` pins
`kotlin_version = 2.4.10` so the camera plugin does not load a second Kotlin plugin version
alongside `@capgo/capacitor-health`.

Scan reliability: a 500/502/timeout from one Gemini model, or an unparseable reply, now
advances the model cascade instead of failing the request, and does **not** mark that model
exhausted for the day (`isTransientStatus` in `api/_modelRouter.ts`). That was
"it failed a few times, then it worked".

Every add-food flow (scan and manual) ends on the diary for that day — `showDiary` in
App.tsx rewinds `food-search` / `food-scan` out of the navigation history first.

## 16. Why the plate scan kept failing (3.19.1, 2026-09-09)
Two independent faults, both server-side. Found by reading `aiQuota/2026-09-09` in production:
the three strongest models were flagged `exhausted` after **1, 2 and 2 calls** out of 20 free
requests each.

1. **A demand spike was being read as a daily quota.** `isExhaustedStatus` counted 503, and Gemini
   answers `503 "This model is currently experiencing high demand"` during any spike. The first
   spike of the day permanently disabled that model, so by the third scan the cascade had collapsed
   onto the weakest models or nothing at all. Replaced with `classifyFailure(status, message)`:
   *exhausted* only for 404 and a 429 whose message names a per-**day** quota; *transient* for 503,
   500, 502, 504, 408 and a per-**minute** 429; *fatal* otherwise. A transient failure skips that
   model for the current request only (`pickModel({ skip })`) and leaves its budget alone.
2. **Thinking tokens were eating the answer.** Gemini 3.x flash reasons before answering and those
   tokens come out of `maxOutputTokens`. Measured on a real plate: `thoughts=1099, out=275` — over
   the old 1200 cap, so the JSON came back truncated and unparseable. That is what the user saw as
   *"Couldn't read that plate. Try a clearer, closer photo."* — a message about the photo when the
   photo was fine. Now 2400 with `thinkingLevel: 'minimal'`, plus a retry without the field for any
   model that rejects it.

Also: the per-call timeout went 20 s → 26 s (a clean scan measured 17 s and the next model was cut
off at 20 s), `MAX_MODEL_ATTEMPTS` 3 → 4, and a failed scan now **refunds** the user's daily credit
(`refundLimit`) — retrying our own flakiness was eating their ten a day.

Diagnostics: `POST /api/foodscan` with `debug: true` from an admin uid returns a per-attempt array
(model, status, finishReason, token usage, and the first 300 chars of an unparseable reply). That
is how both faults were found; use it before theorising again.
