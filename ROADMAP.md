# Zenith Fitness — Roadmap & Playbook (v2.0)

> Rewritten 2026-09-06 after the v3.15.0 release and the brainstorm that followed it. v1.1 (2026-04-23) said "no gym ops, no nutrition, no wearables". v2.0 reverses those three, for the reasons in §0.2. Everything else from v1.1 that still holds was kept. Review this document before any significant scope or direction decision.

---

## 0. TL;DR

- **Direction:** B2B-lite, unchanged. A member app that is branded by, distributed through and paid for by independent gyms, pitched first to the gym Rishi trains at (200–300 members, 5–7 trainers, morning classes, some evening).
- **What changed:** the app now also carries **Gym OS lite** (members, plans, dues, check-in, trainers, classes, owner dashboard) and **Health services** (nutrition, activity from wearables, bulk/cut coaching). A 300-member gym with trainers will ask for ops on day one, and "one-stop" health tracking is what makes the member side sticky enough to sell.
- **Business model:** flat monthly fee per gym for the gym tools plus premium-for-all-members; **freemium** for everyone else: core tracking and nutrition logging free, analysis and camera food scan premium.
- **Infra:** Firebase (Blaze once the gym signs), Vercel for API routes (already used for push; OTP moves there now), no AWS.
- **Immediate order of work:** (1) security fix, (2) Gym OS lite Tier A, (3) nutrition MVP, (4) Health Connect + bulk/cut, (5) Play Store listing + pitch.

### 0.1 Personal constraints (unchanged)

10-to-7 job, 6–10 hours a week on weekends for Zenith, not a marketer. Every phase below is sized for that pace.

### 0.2 Why v1.1's "don't build" items moved into scope

| v1.1 said | v2.0 says | Why |
|---|---|---|
| No gym ops | Gym OS **lite**: the 20% of ops a 300-member gym actually uses daily | The first customer runs classes and trainers; an engagement dashboard alone won't get a yes. Payroll, inventory, accounting stay out. |
| No nutrition | Nutrition logging free, analysis premium | Members want one app; nutrition is the other half of results. Indian-food coverage is a real gap in MyFitnessPal that we can fill. |
| No wearables | Android Health Connect only | One integration covers most bands sold in India. Per-vendor APIs stay out. |

---

## 1. Strategic direction

### 1.1 Three users

| User | Surface | Pays? |
|---|---|---|
| **Member** | Phone app (Android APK / PWA) | Free via gym, or freemium if not attached to a gym |
| **Trainer** | Same app, trainer role | No; comes with the gym subscription |
| **Owner / manager** | Same app on phone **and** the web URL on a laptop, owner role | Yes: flat monthly fee per gym |

One codebase. Owner and trainer screens are role-gated views inside the existing React app; the web build already works on desktop. No second Next.js repo (v1.1 §6.3 is withdrawn): a solo developer cannot maintain two front-ends.

### 1.2 Positioning

"The app your gym gives you: your workouts, your food, your progress in one place — and the tools your gym needs to keep you coming back."

### 1.3 Differentiators

1. Buddy + compare + N★ weekly streak with freezes (shipped 3.15.0)
2. Gym-branded, gym-distributed, premium free for members
3. Indian-context nutrition: IFCT foods, katori/roti portions, Indian packaged goods via barcode
4. Owner dashboard that answers "who is about to leave" and "who owes me money" in one screen
5. Offline-first, INR pricing, Hindi later

### 1.4 What is still explicitly out

Payroll, inventory, accounting, a public social feed, AI form-check video, personal-trainer marketplace, ads, iOS before product-market fit, per-vendor wearable cloud APIs, a separate admin web app.

---

## 2. Decisions log (2026-09-06)

Agreed with Rishi during the brainstorm. Change these only by editing this section first.

| # | Decision |
|---|---|
| D1 | OTP moves server-side to Vercel; the derived-password scheme is removed and the 8 affected accounts are rotated (one re-login). |
| D2 | Upgrade Firebase to Blaze when the gym signs; budget alerts at ₹500 and ₹2,000. Until then Vercel carries server logic. |
| D3 | First gym: 200–300 members, 5–7 trainers, morning classes and some evening classes. Multi-gym data model from day one. |
| D4 | Check-in: member scans the gym QR, or staff scans the member QR, **plus** two non-scan fallbacks: a daily 6-digit gym code shown at reception, and staff marking attendance from the member list. |
| D5 | Dues are recorded manually (UPI/cash) in Tier A. No payment processing until Tier C. |
| D6 | Owner dashboard lives in the same app, usable at the web URL on a laptop and on the phone. |
| D7 | Nutrition at launch: calories + macros, barcode scanning, Indian portion units. Micronutrients later. |
| D8 | Wearables v1: Android Health Connect only, plus manual entry. iOS HealthKit when an iOS build exists. |
| D9 | Freemium: core workout tracking **and nutrition logging** are free for everyone. Premium = analysis (deterministic + AI), camera food scan, advanced analytics. Gym members get premium free while their gym's subscription is active. |
| D10 | This roadmap replaces v1.1. |

---

## 3. Phased playbook

### Phase S — Security fix (1–2 weekends, before anything is shown to the gym)

- OTP send/verify/complete as Vercel API routes with Firestore-backed codes and rate limits (per email 3/hour, 6/day; per IP 15/day; 5 verify attempts per code).
- Sign-in via Firebase **custom token** minted server-side. Remove `derivePassword` from the client.
- Rotate passwords on the 8 existing email-OTP accounts so the old path is dead.
- EmailJS: private key server-side only; enable "private key required" so the leaked public key stops working from browsers.
- In-app **account deletion** (Play Store requirement) as a server route that wipes Firestore + Auth.
- Admin **Users** screen: auth users vs profiles, last sign-in, disable / delete.

Success: no client bundle secret can send email or sign in as someone else.

### Phase A — Gym OS lite, Tier A (4–6 weekends)

Everything needed to onboard the first gym and run it day to day.

- **Gym entity + roles**: `gyms/{gymId}`, roles owner / manager / trainer / member on the profile. Join by QR or 6-char code.
- **Members**: directory, search, membership plan (name, duration, price), start/expiry, status (active / expiring / expired / frozen), assigned trainer, phone, notes.
- **Dues**: record a payment (amount, method, date, plan, months), see outstanding and upcoming renewals. No gateway.
- **Check-in**: four methods per D4. One check-in per member per day. Check-ins also feed the member's streak view ("you were at the gym") without counting as a workout.
- **Classes**: schedule (name, weekday, time, trainer, capacity), member enrols/unenrols, trainer marks attendance. Keep it a timetable, not a booking engine.
- **Trainer view**: assigned members, their last workout, streak, check-ins, plan expiry.
- **Owner dashboard** (phone + web): active members this week, check-ins today and per hour, at-risk list (no check-in or workout in 14+ days, joined 30+ days ago), expiring in 7 / 30 days, outstanding dues, signup → active conversion, top exercises and class fill rates. Built on the InteractiveLineChart engine.
- **Gym branding**: name, logo, accent colour on splash and header; falls back to Zenith branding.
- **Announcements**: owner/trainer push to all members or a class (uses existing push pipeline).

Success: the owner opens the dashboard at least weekly and acts on the at-risk or dues list.

### Phase N — Nutrition MVP (3–4 weekends)

- Food library with the same creator/shared model as exercises: curated core dataset (§6.3), Open Food Facts barcodes, user-created foods shared to everyone, favourites and recents.
- Diary: meals per day, quantity in grams **and** Indian units (katori, roti, piece, cup, tbsp), quick-add macros, copy yesterday.
- Targets: calories, protein, carbs, fat, water. Daily ring on Home.
- Free for everyone per D9.

### Phase H — Health Connect + bulk/cut (2–3 weekends)

- Read from Health Connect: steps, active calories, resting/avg heart rate, sleep, exercise sessions. Write our workouts back (stub exists in `healthSync.ts`).
- Activity view: daily steps and calories, weekly trend, sleep.
- **Phase engine**: 14-day weight trend (EMA), weekly rate in %/week; classify bulk / cut / maintain with ±0.25 %/week thresholds; adaptive maintenance-calorie estimate from intake vs weight change; goal rate with "too fast" / "stalled" warnings. Uses body weight (exists) + nutrition (Phase N).
- Premium: the analysis layer (phase engine, AI coach on food + activity, camera food scan via a server route with per-user quota).

### Phase P — Play Store + pitch (parallel, non-engineering mostly)

Follow the checklist in §8. Pitch when Tier A is demo-ready with realistic seed data.

### Phase B / C — after the first gym is live

- Tier B: class waitlists, member progress report PDF for renewal talks, trainer notes, body measurement check-ins by trainers.
- Tier C: Razorpay payment links for renewals, WhatsApp reminders, lead/trial tracking, second-gym self-serve onboarding.

---

## 4. Gym partnership pitch

Unchanged from v1.1 in spirit; see §4.3 there. Updated points:

- You are still offering a **free 3-month pilot**, not selling. Money enters after you can show attendance, at-risk and dues data the owner already uses.
- Bring: your phone with Tier A seeded with 3 months of realistic fake data for a 250-member gym, and your laptop open on the owner dashboard. One printed page. No slides.
- Objection to add: "We already have a register / Excel for fees." → "Keep it. The app records the same thing in two taps and tells you who is overdue and who is about to leave. Export to Excel any time."
- Pricing when it comes: ₹2,500–₹3,000 / month flat up to 300 members including trainer accounts and premium for every member; ₹5,000 for 300–600.

---

## 5. Product model

### 5.1 Roles and access

| Role | Can |
|---|---|
| member | Own data; see own gym's classes, announcements, own check-ins |
| trainer | + assigned members' progress, mark class attendance, check members in |
| manager | + all members, dues, plans, check-in, classes, announcements |
| owner | + dashboard, gym settings, staff roles, billing status |
| Zenith admin | Everything, plus shared library and user management (`src/admin.ts`) |

### 5.2 Freemium (replaces v1.1 §14 tiers)

| Tier | Who | Includes |
|---|---|---|
| Free | Anyone | Workouts, plans, streaks, buddies (cap 3), body weight, **nutrition logging**, basic charts, manual activity entry |
| Premium (₹99/mo, ₹599/yr) | Direct users | + analysis (phase engine, coach insights, AI coach with our key), camera food scan, Health Connect insights, advanced analytics, unlimited buddies/templates, export |
| Gym-sponsored | Members of a paying gym | Premium, free, while the gym is active; plus classes/check-in/announcements |

Never paywall: logging of any kind, streaks, basic charts, offline, account deletion.

---

## 6. Technical plan

### 6.1 Infra

- **Firebase**: Auth, Firestore, FCM, Hosting. Blaze at gym signing (D2). Cloud Functions then take: nightly at-risk + expiry aggregates, daily gym stats rollups, gym subscription lapse handling, purchase verification.
- **Vercel** (hobby): `/api/push` (exists), `/api/otp` (Phase S), `/api/account/delete` (Phase S), `/api/food/scan` (Phase H, premium), `/api/food/search` proxy if FatSecret is ever added.
- **No** self-hosted database. Curated food data ships as a static JSON bundle on Hosting/CDN; user and shared foods live in Firestore.

### 6.2 Firestore additions

```
gyms/{gymId}
  name, logo, accentColor, address, ownerUid, staff: {uid: role}
  code (6-char join code), dailyCheckinCode, dailyCheckinCodeDate
  plans: [{id, name, months, price}]
  subscriptionStatus: 'pilot' | 'active' | 'lapsed', pilotEndsAt, monthlyFee
  memberCount (denormalised)

gyms/{gymId}/members/{uid}
  role, joinedAt, planId, planStart, planEnd, status, trainerUid, phone, notes
  lastCheckinAt, lastWorkoutAt (denormalised), atRisk (nightly)

gyms/{gymId}/payments/{id}        uid, amount, method, paidAt, months, planId, recordedBy
gyms/{gymId}/checkins/{id}        uid, at, method: 'member-qr' | 'staff-qr' | 'code' | 'manual', byUid
gyms/{gymId}/classes/{id}         name, weekday, startTime, durationMin, trainerUid, capacity
gyms/{gymId}/classes/{id}/sessions/{date}   enrolled: [uid], attended: [uid]
gyms/{gymId}/announcements/{id}   text, audience: 'all' | classId, byUid, at
gyms/{gymId}/stats/{yyyy-mm-dd}   checkins, activeMembers, newMembers, dues  (nightly rollup, Blaze)

userProfiles/{uid}   + gymId, gymRole, subscriptionTier, subscriptionSource

sharedFoods/{id}     name, nameKey, brand?, barcode?, per100g: {kcal, protein, carbs, fat, fibre?}, units: [{label, grams}], createdBy, source: 'ifct' | 'usda' | 'off' | 'user'
users/{uid}/data/nutrition        value: { targets, days: {yyyy-mm-dd: {meals: [...]}} }  (or one doc per month if it grows)
users/{uid}/data/activity         value: { days: {yyyy-mm-dd: {steps, activeKcal, restingHr, sleepMin}} }
otpCodes/{email}, otpLimits/{key} admin-only (no client rules)
```

### 6.3 Nutrition data sources

| Source | Use | Notes |
|---|---|---|
| IFCT 2017 (NIN Hyderabad) | Core Indian raw foods, 528 items | Authoritative for India. Check redistribution terms; ship as derived nutrient table. |
| Curated Indian dishes (~300–500) | Dal, roti, sabzi, biryani, idli/dosa… with katori/roti portions | Built once by us from IFCT + standard recipes. The differentiator. |
| USDA FDC Foundation + SR Legacy | Generic raw ingredients | Public domain. Skip the 1.9M branded rows. |
| Open Food Facts | Barcodes for packaged goods | Free API, no key, ODbL attribution in-app. Client-side calls are fine. |
| OpenNutrition | Possible top-up for restaurant chains | Verify licence and freshness first. |
| FatSecret | Optional later | Best coverage but needs a server proxy and attribution. Only if users complain about coverage. |
| Edamam, CalorieNinjas | Not used | Weak on Indian food, small free quotas. |

### 6.4 Wearables

- Android **Health Connect** via `@capacitor-community/health-connect`: steps, active calories, heart rate, sleep, exercise sessions. Most major brands (Samsung, Xiaomi/Mi Fitness, Amazfit/Zepp, Fitbit, Garmin, Pixel) sync into it; some budget brands still don't → manual entry fallback.
- No Fitbit/Garmin/Google Fit REST integrations (per-vendor OAuth, and Google Fit REST is deprecated).
- iOS HealthKit when there is an iOS build.

### 6.5 Security rules to add

- `gyms/{gymId}`: read by staff and members of that gym; write by owner/manager. Subcollections: members/payments writable by manager+; checkins creatable by the member (own uid, method member-qr/code) or by staff; classes writable by manager+, sessions enrol/unenrol by member for own uid.
- `sharedFoods`: same shape as `sharedExercises`.
- `otpCodes`, `otpLimits`: no client access.

### 6.6 Cost discipline

Paginate, denormalise aggregates, nightly rollups instead of live counts. Watch Firestore reads weekly once the gym is on; a 300-member gym opening the app daily is ~10k reads/day, well inside Blaze's free quota.

---

## 7. Metrics

**Member:** weekly active, week-2 retention, sessions per active member, % with a buddy, % logging food ≥3 days/week.
**Gym:** check-ins/day, at-risk count and how many were contacted, dues outstanding, renewals within 7 days of expiry, class fill rate, owner dashboard opens/week.
**Business:** gyms in pilot / paying, MRR, premium conversions, infra cost as % of MRR.

Decision points (from v1.1, dates reset to gym signing): 3 months → owner using the dashboard weekly or fix the product; 9 months → 2 paying gyms or another 3-month sales push; 12 months → 3+ gyms or accept it's a personal project.

---

## 8. Play Store pre-launch checklist (unchanged from v1.1 §3)

Privacy policy URL, in-app account deletion (Phase S), web deletion request page, data safety form, target API level, Play App Signing with keystore backed up twice, 4–6 screenshots, descriptions, content rating, $25 fee, test on 3 devices, closed testing with 10 gym members before production.

---

## 9. Risks (additions to v1.1 §11)

| Risk | Mitigation |
|---|---|
| Owner wants full billing/payments before paying | Tier C has payment links; hold the line on accounting |
| Nutrition data quality complaints | Curated Indian set first; user corrections flow through the shared-food creator model; FatSecret as upgrade |
| Budget wearables don't sync to Health Connect | Manual entry; phone step counter as a later fallback |
| Blaze cost surprise | Alerts at ₹500 / ₹2,000; no unbounded fan-out functions; camera scan quota per user |
| Scope creep from a 300-member gym's wish list | §1.4 and the Tier A/B/C split; "second gym asks too" rule before promoting to Tier A |

---

*Document version 2.0 — 2026-09-06. Supersedes v1.1 (2026-04-23). Next review: when the first gym pilot starts.*
