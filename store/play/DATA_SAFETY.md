# Google Play Data safety form — Zenith Fitness (Android, `com.zenith.fitness`)

Filled out section-by-section as the Play Console form asks (Play Console →
App content → Data safety). Definitions used (per Google's Data safety help,
answer 10787469, fetched 2026-09-12):

- **Collected** = transmitted off the device (to our servers, or to a third
  party), regardless of whether it is later stored.
- **Shared** = transferred to a third party that is not processing the data
  solely as our service provider, under our instructions. A service provider
  (our own backend on Firebase/GCP, EmailJS sending an OTP email on our
  behalf) is not "shared." Google Gemini and OpenAI receiving a photo or a
  chat prompt to generate an answer we display back to the same user **are**
  treated as sharing here — they are separate companies processing the
  content for us, and this is called out explicitly rather than argued away.
- **Ephemeral** = accessed and used only in memory, for no longer than needed
  to serve that one request, never written to disk by us.
- **Required vs optional** = whether the feature that uses the data is core
  to the app (required) or the user can use the app without ever providing
  it (optional).
- **Purposes** = the fixed list Play offers: App functionality, Analytics,
  Developer communications, Advertising or marketing, Fraud prevention /
  security / compliance, Personalization, Account management.

This is a recommendation, not a submission — re-verify each answer against
the live Play Console form, whose exact wording/options can move.

---

## Security practices (top of the form)

| Question | Answer | Why |
|---|---|---|
| Is all user data encrypted in transit? | Yes | Firebase, Vercel, Gemini, OpenAI and EmailJS are all called over HTTPS; no plaintext endpoints. |
| Do you provide a way for users to request data deletion? | Yes | In-app: Settings → Account → Delete account (`api/account.ts` → `api/_accountWipe.ts`). Also by email to the contact address. |
| Is data encrypted at rest? | Yes | Google Cloud (Firestore) default encryption at rest — no customer-managed key, none needed. |
| Committed to Play Families Policy? | No / not applicable | App is rated for an 18+ audience, not directed at children. |

---

## Location

| Data type | Collected | Shared | Ephemeral | Required/Optional | Purposes |
|---|---|---|---|---|---|
| Approximate location | **No** | — | — | — | — |
| Precise location | **No** | — | — | — | — |

**Justification:** `android/app/src/main/AndroidManifest.xml` declares no
`ACCESS_FINE_LOCATION` / `ACCESS_COARSE_LOCATION` permission, and no
geolocation Capacitor plugin is installed (checked `package.json`). The
geofenced check-in code (`src/geo.ts`, `requestPosition`) exists in the
shared web bundle and would, on a platform that grants it, read the device
coordinates on-device, compute a haversine distance to the gym, and send
only that distance in metres to `gyms/{gymId}/checkins` (never the
coordinates) — see `src/geo.ts` and `firestore.rules` `checkins`. **But on
this Android app specifically, the permission needed for that code path to
ever run is not declared**, so the native app does not access device
location at all today. Flagged separately in the report below — this is
either an intentional Android-only fallback to code-based check-in, or a
gap where the geofenced QR check-in silently fails on Android; worth
Rishi's own check before submission, since it changes this answer if fixed.

---

## Personal info

| Data type | Collected | Shared | Ephemeral | Required/Optional | Purposes |
|---|---|---|---|---|---|
| Name | Yes | No | No | Required | App functionality, Account management |
| Email address | Yes | No | No | Required | Account management, App functionality |
| User IDs | Yes | No | No | Required | App functionality, Account management |
| Phone number | Yes | No | No | Optional | App functionality |
| Address | No | — | — | — | — |
| Race and ethnicity | No | — | — | — | — |
| Political or religious beliefs | No | — | — | — | — |
| Sexual orientation | No | — | — | — | — |
| Other info | No | — | — | — | — |

**Justification:**
- **Name / User IDs** — Firebase Auth UID and display name back every
  `userProfiles/{uid}` and `users/{uid}/…` document (`firestore.rules`,
  `src/types.ts`); needed to run the account at all.
- **Email address** — collected at sign-in (Google or email OTP,
  `api/otp.ts`). EmailJS sends the code email on our behalf as a service
  provider (private-key API call, not a data sale/share) — see
  `api/otp.ts` header comment.
- **Phone number** — optional field a member can add to their gym profile;
  visible to that gym's staff only (`firestore.rules` `gyms/{gymId}/members`
  update rule allowing `phone`; FACTS: staff sees name/phone/email/plan
  dates/payments/check-ins for their own gym only).

---

## Financial info

| Data type | Collected | Shared | Ephemeral | Required/Optional | Purposes |
|---|---|---|---|---|---|
| User payment info | No | — | — | — | — |
| Purchase history | No | — | — | — | — |
| Credit score | No | — | — | — | — |
| Other financial info | Yes | No | No | Optional | App functionality |

**Justification:** There is no in-app purchase and the app never touches a
card number or payment credential — premium is switched on by the gym or an
admin, not bought. What *is* collected: a gym's dues ledger entered by its
staff for its own members — amount, method label (`upi`/`cash`/`card`/
`other`), billing months, note (`src/types.ts` `GymPayment`,
`src/gymService.ts` `recordPayment`, `firestore.rules`
`gyms/{gymId}/payments`, readable only by that gym's staff and the member
the payment is about). This is "Other financial info," not payment
processing.

---

## Health and fitness

| Data type | Collected | Shared | Ephemeral | Required/Optional | Purposes |
|---|---|---|---|---|---|
| Health info | No | — | — | — | — |
| Fitness info | Yes | No | No | Optional | App functionality, Personalization |

**Justification:** Steps, active/total calories, heart rate, resting heart
rate, sleep duration, exercise sessions and body weight are read from Health
Connect only with the user's permission (`android/app/src/main/AndroidManifest.xml`
health permissions, `src/activity/healthConnect.ts`), and body weight is the
only value written back. It lands in the user's own `users/{uid}/…`
Firestore documents — never another user's, never sold, never used for ads.
The one nuance: when the user asks Zen a question, a short numeric summary
of their own data (not raw Health Connect records) is sent to Google Gemini,
and to OpenAI on fallback, to generate that one reply (`api/zen.ts`,
`api/_zenPersona.ts`) — this is processed **ephemerally** (not stored by us
server-side, not retained by the model provider beyond serving that
request), so it stays inside "Collected, not shared" rather than tipping
this row into "Shared," matching the task brief's own instruction to keep
health data as collected-not-shared. No medical/diagnosis data ("Health
info") is collected at all.

---

## Messages

| Data type | Collected | Shared | Ephemeral | Required/Optional | Purposes |
|---|---|---|---|---|---|
| Emails | No | — | — | — | — |
| SMS or MMS | No | — | — | — | — |
| Other in-app messages | Yes | Yes (limited) | Partially | Optional | App functionality |

**Justification:** Buddy chat (`chats/{chatId}/messages`) and gym feed
comments are stored in Firestore, readable only by the chat pair or that
gym's members/staff (`firestore.rules`) — never sent to a third party.
Zen coach messages are different: they never reach Firestore at all (kept
in `localStorage` on-device per the FACTS/`api/zen.ts` header), but the
message text plus a context summary is sent to Google Gemini (Gemma), and
to OpenAI on fallback, to generate the reply — that is a real third-party
share, hence "Yes (limited)" and "Partially" ephemeral (the Zen leg is
ephemeral and on-device only; buddy/gym messages are neither shared nor
ephemeral — they're stored, just not shared).

---

## Photos and videos

| Data type | Collected | Shared | Ephemeral | Required/Optional | Purposes |
|---|---|---|---|---|---|
| Photos | Yes | Yes (limited) | Partially | Optional | App functionality |
| Videos | No | — | — | — | — |

**Justification:** Three photo sources: (1) profile photo — from the
Google account or user-set, stored in `userProfiles`; (2) gym feed /
announcement photos — user- or staff-posted, downscaled client-side and
stored as base64 in Firestore (`src/gymFeed.ts`, `firestore.rules`
`feed/{postId}/media`), visible to that gym's members/staff only, never a
third party; (3) food-scan plate photos — downscaled on-device
(`src/nutrition/scan.ts`) and sent to Google Gemini, falling back to
OpenAI, for a one-time nutrition estimate (`api/foodscan.ts`,
`api/_openaiScan.ts`) — **this is the "Yes (limited)" share** and it is
ephemeral: the photo is not written to Firestore or any of our storage
after the response comes back. Videos: not collected — `Exercise.videoUrl`
(`src/types.ts:15`) is only an optional external link (YouTube/form-guide),
never an uploaded file.

---

## Files and docs

| Data type | Collected |
|---|---|
| Files and docs | **No** |

No document upload/import feature anywhere in the app.

---

## Calendar

| Data type | Collected |
|---|---|
| Calendar events | **No** |

No calendar integration or permission.

---

## Contacts

| Data type | Collected |
|---|---|
| Contacts | **No** |

No `READ_CONTACTS` permission declared, no contacts-import feature; buddies
are found by in-app search only.

---

## App activity

| Data type | Collected | Shared | Ephemeral | Required/Optional | Purposes |
|---|---|---|---|---|---|
| App interactions | No | — | — | — | — |
| In-app search history | No | — | — | — | — |
| Installed apps | No | — | — | — | — |
| Other user-generated content | Yes | No | No | Required | App functionality |
| Other actions | No | — | — | — | — |

**Justification:** No analytics or crash-reporting SDK is present (checked
`package.json` dependencies and grepped the codebase for `getAnalytics`,
`Crashlytics`, `Sentry`, `Bugsnag`, `Mixpanel`, `Amplitude` — none found), so
no telemetry/interaction data is collected. "Other user-generated content"
covers workouts, weekly plans, body-weight/measurement logs, the nutrition
diary and custom foods/meals the user builds — the core records the app
exists to store, all under `users/{uid}/…` and owner-readable only.

---

## Web browsing

| Data type | Collected |
|---|---|
| Web browsing history | **No** |

No browser-history access; the one outbound network call not covered
elsewhere is an unauthenticated GET to GitHub to check the latest APK
release tag (FACTS) — it carries no user data.

---

## App info and performance

| Data type | Collected |
|---|---|
| Crash logs | **No** |
| Diagnostics | **No** |
| Other app performance data | **No** |

No Crashlytics/Sentry/equivalent SDK ships in the app. `console.log`/
`console.error` calls inside the Vercel functions (`api/*.ts`) are our own
server-side operational logs, not data collected from the device via an SDK
in the app, and carry no personal data (status codes, model names, timing) —
not a Data-safety-reportable collection.

---

## Device or other IDs

| Data type | Collected | Shared | Ephemeral | Required/Optional | Purposes |
|---|---|---|---|---|---|
| Device or other IDs | Yes | No | No | Optional | App functionality |

**Justification:** Firebase Cloud Messaging registration token, stored at
`userProfiles/{uid}/fcmTokens/{tokenId}` and used only to fan out this
user's own push notifications (`api/push.ts`); readable only by that user
(`firestore.rules`). Optional because it only exists if the user grants the
Android 13+ `POST_NOTIFICATIONS` permission.

---

## Summary for the report

Collected: Name, Email, User IDs, Phone (optional), Other financial info
(gym dues, optional), Fitness info, Other in-app messages, Photos, Other
user-generated content, Device/other IDs.
Shared with a third party (limited, named): food-scan photos and Zen chat
text/context → Google Gemini API, falling back to OpenAI API, purely to
generate the one response shown back to the same user; never used for ads,
never sold, never used to train a model on our side.
Not collected at all: Location (see the flag above), Health info (medical),
Files/docs, Calendar, Contacts, Web browsing, App interactions/analytics,
Crash/diagnostics.
