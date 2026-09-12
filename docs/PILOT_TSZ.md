# TSZ Gym pilot — agreement draft, month-one scope, and the paid road map (2026-09-13)

Outcome of the demo: they want it, they were already thinking along these
lines, and they pay for a gym-ops app today that they barely open. Every
feature they asked for is being built as a generic capability of the
platform (every gym gets its own library, plans, branding and ratings), never
as TSZ-only code. That is what makes the second gym cheap.

## 1. The one-page pilot agreement (send this; numbers are recommendations)

**Parties.** Zenith Fitness (Rishi Mishra) and TSZ Gym (owner).

**Term.** Pilot of 3 months from the first Monday members install the app.
Either side may end it with 7 days' notice; data export on request.

**Price.** ₹1,499 per month for the pilot, invoiced monthly, everything
included for every member (GymOps + Members Premium, up to 300 members).
From month 4: ₹2,499 per month, or ₹24,999 for the year.

**Onboarding (one-time) — ₹4,999**, waived if the first year is paid up front.
Covers: importing the member list, entering the gym's notice-board plans as
in-app plans, adding the gym's exercises with the trainers' videos, staff
accounts, a poster QR for the desk, one training session for staff.

*Why a fee when the pricing doc said "no setup fee":* the demo turned
onboarding into a content project (their plans, their exercises, their
videos). Charging for it keeps month one cash-positive and makes the content
theirs to care about. Waiving it against an annual payment turns it into a
closing tool.

**Co-branding.** Inside the app the gym's name and logo appear on the splash
screen, the home screen, and the gym tab ("Zenith Fitness · by TSZ Gym").
Zenith Fitness remains the app's name on the Play Store. A separate
white-label listing under the gym's own name is available as an add-on
(section 3). The partnership is co-marketing: the gym promotes the app to its
members; Zenith names the gym as its launch partner. No exclusivity, no equity.

**Data.** Members' training data belongs to the members. Gym operational data
(members, payments, check-ins) belongs to the gym and is exportable. Zenith
does not sell or share either.

**Included in month one.** Section 2. **Not included.** Section 3 items,
which are quoted separately.

## 2. Month-one scope (what we commit to, in the order it ships)

| Feature | What the gym gets | Status |
| --- | --- | --- |
| Gym exercise library with videos | Trainers add the movements they coach with their own video; members see them in every exercise picker and watch the video mid-set, inside the app | Built 2026-09-13 |
| Gym workout plans | The notice-board programmes as one-tap plans; publishing an edit updates every member's copy | Built 2026-09-13 |
| Anonymous session ratings | Members rate a class 1–5 with a comment once it has happened; no name is stored anywhere; owner/manager see averages per trainer and class in Analytics | Built 2026-09-13 |
| Co-branding | Gym name and logo on splash, home and gym tab | Built 2026-09-13 |
| Play Store closed test | The pilot members double as the 12 testers Google requires; APK on day one, Play install the day the developer account clears | Rishi: create the account |
| Onboarding service | Plans and exercises entered for them; member list imported | Rishi + gym: collect the plans and videos |
| Desk-created accounts (3.29.0) | Adding a member by name + mobile creates their Zenith account; they sign in by e-mail code or Google and land in it with the profile filled | Built 2026-09-13 |
| Anonymous ratings, session sharing fixes, announcement badge (3.29.0) | See docs/RELEASE_3.29.0.md | Built 2026-09-13 |
| Owner's 15-point walkthrough (3.30.0): in-app plate camera, deload in plain words, insights on Home, rebuilt Analysis, one-tap Log food, member vs staff gym screens | See docs/RELEASE_3.30.0.md | Built 2026-09-13 |
| Readable errors, no silent failures, no raw ids (3.30.1) | See docs/RELEASE_3.30.1.md | Built 2026-09-13 |

Testing starts Monday 2026-09-14 with real members. Full rollout in a month.

## 3. Paid add-ons (quote when asked; do not build speculatively)

| Add-on | What it is | Price idea | Build cost |
| --- | --- | --- | --- |
| **Personal AI trainer** for the top membership tier | Zen tuned to the head trainer's philosophy and the gym's plans, a proactive daily nudge by push, replies read aloud, voice input. Named coach persona, standard voice. | ₹99 per premium member per month, billed to the gym; or a ₹3,999 gym tier that includes it | ~2 weeks for the persona + nudge + read-aloud; live two-way voice later and separately |
| **White-label app** | The gym's own Play listing ("TSZ Fitness, powered by Zenith"): own package, icon, name; same backend | ₹9,999 setup + ₹1,000/month on top of the plan | ~1 week the first time, then per-gym build config |
| **Smart entry (face recognition)** | Tablet at the door, on-device face match against members who opted in, door controller integration | Hardware at cost + ₹25,000 setup + ₹999/month | 3–6 weeks + vendor; biometric consent and retention under the DPDP Act; needs a prominent-disclosure review on Play |
| **Member data migration** from their current app | Import members, plans and payment history | Included in onboarding if they can export a CSV; ₹2,999 if we have to rebuild it by hand | Depends on the export |

## 4. Two things to find out from the owner

1. **Exactly which app they use today** (the name). It decides what we replace
   and whether their member and payment history can be exported.
2. **Where the training videos live.** Unlisted YouTube links cost nothing to
   host and play inside the app; raw files would need storage we pay for.

## 5. Why this order makes the most money

Content (their plans, their videos) is what makes the app *theirs* and makes
leaving painful; it also creates a billable onboarding service every gym
needs. Ratings cost two days and give the owner a number no competitor shows
him. Co-branding costs nothing and satisfies the "our app" request without
giving up the brand. The AI trainer is the one feature that lets the gym
charge its own members more, so it is priced per premium member rather than
given away. Face recognition is a hardware project with regulatory weight;
it earns only as a quoted add-on after the software subscription is paying.
