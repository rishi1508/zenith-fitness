# Gym owner demo — 2026-09-13 — and how we charge

## Verified the night before
- Hosting serves 3.26.1 with the Vercel push endpoint; APK `zenith-fitness-v3.26.1.apk` on the GitHub release.
- Production bundle boots and routes in guest mode with zero console errors; the same code was swept as owner and member (42 screens, both themes) against production data with zero errors.
- Live API: Zen answered on Gemma (200), plate scan answered on Gemini 3.6 (200, 6 items); both OpenAI fallbacks exercised in production and tallied ($0.001 total).
- The gym: `TSZ Gym`, 258 members (250 seeded), 252 payments, 8 classes, 4 feed posts, **0 announcements, no UPI id, no location set**.

## Tonight (10 minutes)
1. Install the 3.26.1 APK on your phone, open it once on Wi-Fi so caches warm. Otherwise the "Update available" banner sits on top of the demo.
2. My Gym → Feed → Announcements → post two notices (a holiday timing, a new class). Zero notices looks unused.
3. My Gym → gear → Gym settings: enter the gym's **UPI id** (the renewal message carries a payment link) and **set the location** (geofenced QR check-in refuses without it — the daily code still works).
4. Settings → notifications on. Ask one buddy to send you a message during the demo — the heads-up card is worth thirty seconds.
5. Carry a second phone signed in as a member (`demo.member@zenith-fitness.test`) — the announcement and check-in land on it live.
6. Have real food on the table for the plate scan. Mobile data as backup to their Wi-Fi.

## The demo — 20 minutes, member first, then owner
Say once, up front: "The 250 members you'll see are sample data at your gym's scale; the features are live."

**1. Member's day (3 min, your phone).** Home: today's workout suggested from the plan → Start. Check in: Check-in console on the second phone shows the code; enter it → "In today" ticks up on Manage. Log a plate: point at the food → items and macros in ~15 s. Feed: your set shared to the gym, reactions.

**2. Owner's week (7 min).** My Gym → Manage: Active / In today / Dues. Peak hours — hold and slide ("7 PM is your bottleneck; that's your staffing chart"). Members → Expiring → open one → **WhatsApp reminder with the UPI link** → Record payment → plan extends. Check-in console: today's code, rotate it, manual check-in. Classes: attendance. Announcements from the Feed tab → post live → the member phone shows the unread dot.

**3. Analytics (6 min).** Tap MRR → the sheet explains it and shows twelve months. Tap **Slipping** → names with "4 visits this month · 9 the month before" → tap one → their page → WhatsApp. "This list is a renewal at risk; one message this week usually brings them back." Acquisition vs churn: scrub a month. Revenue split: set a payment's category to PT to show the slice move. Facility: class fill, trainer utilisation. Equipment: add a machine, mark it down.

**4. Members' premium (3 min).** Zen: "How was my week?" — it answers from real data. Badges, level ring, streak.

**5. Close (1 min).** Price, pilot, next steps: trainers get staff accounts, members join with the poster QR / join code, you import the member list.

**Do not** demo Health Connect (device-specific), geofenced QR if location isn't set, or push notifications unless enabled on both phones.

**If something stalls:** a slow scan now finishes via the fallback (~14 s); if Zen takes 30 s it is thinking — say so. Airplane-mode-on-off fixes a stuck Firestore listener. Everything else has a back button.

## Pricing — decision

**Model: flat per gym, everything included. Not per member, not usage.**
- The owner's mental model is a fixed monthly cost; per-member pricing punishes the thing we want most (every member installing the app, which is our distribution).
- Our marginal cost per member is near zero (Firestore reads; AI fallback pennies). Per-member has no cost logic behind it.
- Usage/on-demand pricing is unheard of for gym software and makes the bill unpredictable.
- "Members Premium" (scan, Zen, badges, feed) stays **included** for every member of a paying gym — it is what makes the gym's members open the app, which is what makes the owner's dashboard worth paying for. Keep it as a named line so it is a visible value and a future lever, not a separate SKU today.

**Anchors (India, single branch ≤300 members, 2026):** ₹999–₹3,399/month; typical all-in ₹12k–40k/year. Consumer fitness apps charge members ~₹2,500/year each. His gym: 150–300 members × ₹1,500–2,500 = ₹3–6 lakh/month revenue; one saved renewal pays a month of this tool.

| | Price | Covers |
|---|---|---|
| **Pilot, months 1–3** | **₹1,499/month**, no setup fee, cancel any time | GymOps + Members Premium for every member, up to 300 members |
| **Standard, after pilot** | **₹2,499/month** or **₹24,999/year** (two months free) | Same, ≤300 members |
| Larger gym | ₹3,999/month | 300–600 members |
| Members Premium unbundled (only if ever asked) | ₹99/member/month, billed to the gym | Do not lead with this |

Why ₹1,499 for the pilot: it is under every comparable tool, it is revenue from day one (your goal), and it is small enough that the owner is buying a trial rather than making a decision. Raise to Standard on results — bring the Slipping list and the renewals recovered to the month-3 conversation.

**Ask in the meeting:** "What are you paying for the membership app today, and how much of it do you use?" If they pay ₹2,000+ for something they barely open, Standard is at-or-under that from day one and the pilot is a formality.

**Say it as:** "₹1,499 a month for the first three months, everything on, for all your members. If it pays for itself in renewals — and one saved membership does — we go to ₹2,499 from month four, or ₹24,999 for the year."
