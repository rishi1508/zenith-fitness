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
