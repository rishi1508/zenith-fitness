# Store publishing — decision and checklist (2026-09-12)

## Decision
- **Play Store: yes, start this week.** $25 once. The bottleneck is not money but Google's rule for new personal accounts: a closed test with **12 opted-in testers for 14 continuous days** before production access — so the clock has to start now to be live in ~3 weeks. The gym's first members are the testers; the closed test *is* the pilot onboarding.
- **App Store: yes, after the first gym signs.** $99/year, but the real cost is a Mac build path (no Mac here), an iPhone to test on, and iOS-specific work below. Ship TestFlight first; the App Store listing follows.
- **iPhone members today:** the PWA — Safari → Share → Add to Home Screen. Camera works (file input), web push works on iOS 16.4+, no HealthKit. India is ~4–5% iOS overall; expect 10–15% at a mid-market gym, not 30–40%.

## Play Store checklist
1. Developer account ($25), identity verification (1–3 days).
2. Build an **AAB** (`bundleRelease`) in CI alongside the APK; enrol in Play App Signing (our keystore becomes the upload key).
3. Store listing: icon 512, feature graphic 1024×500, 4–8 phone screenshots (412-wide sweeps in `scratchpad/sweep-*` are the raw material), short + full description, category Health & Fitness.
4. Privacy policy URL: `https://zenith-fitness-18e2a.web.app/privacypolicy.html` (exists).
5. **Data safety** form: account info, health & fitness data, photos (food scans, not stored), device identifiers for push. Say so honestly.
6. **Health Connect declaration** (Play's "Health apps" form) for the READ_* permissions in `AndroidManifest.xml` — Google reviews this separately; write the per-permission rationale from `docs/HEALTH_SPEC.md`.
7. Content rating questionnaire; target audience 18+.
8. Closed testing track → opt-in link → 12 members install and open it → 14 days → apply for production.
9. What it buys: auto-updates (no more "Update available"/APK dance), Play Protect trust, crash & vitals, one link to share.

## App Store checklist (later)
1. Apple Developer Program ($99/yr). A Mac path: GitHub Actions macOS runners (10× minute multiplier — a handful of builds/month fits the free tier), Codemagic free tier, or a used Mac mini.
2. `npx cap add ios`, Xcode project, provisioning, APNs key uploaded to Firebase for push.
3. **Sign in with Apple is mandatory** because Google sign-in is offered (guideline 4.8) — Firebase Auth supports it; add the provider.
4. HealthKit instead of Health Connect: `@capgo/capacitor-health` has the iOS half; add entitlements, plist purpose strings, and Apple's HealthKit privacy-policy requirements.
5. **Never show a "buy premium" path in the iOS app.** Premium is granted by the gym outside the app; that is allowed as long as the app neither sells digital goods nor links out to buy them (3.1.1). Keep it that way.
6. TestFlight external testing (up to 10,000) as the iPhone members' channel before the listing is approved. Review typically 1–3 days.
7. Effort: 2–3 weekends. Do it once the first gym is paying.
