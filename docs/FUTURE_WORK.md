# Future Work — Known Open Items

Track for later. Each item skipped intentionally because it's either a
semantic decision for the user or a larger refactor.

## Open bugs / inconsistencies (from 3.10.0 audit)

1. **Streak vs. totalWorkouts semantic mismatch.**
   `storage.calculateStats` counts rest days in `currentStreak` but
   excludes them from `totalWorkouts`. User-visible as
   "Streak 10 · Total 5" which looks wrong. Needs a product call:
   - Option A: total counts rest days too (matches streak).
   - Option B: streak counts only non-rest workouts.
   Locations: `src/storage.ts` (calculateStats) and
   `src/buddyComparison.ts` (computeCurrentStreak).

2. **Shared exercise library — writes are unrestricted.**
   `firestore.rules` permits any signed-in user to update
   `shared/{document}`. Any user could overwrite the entire library.
   Mitigation requires per-exercise provenance or a Cloud Function
   gatekeeper — not trivial without breaking existing writes.

3. **Concurrent-edit race on shared exercise notes.**
   Two users editing the same exercise's notes ~simultaneously ends
   up with last-write-wins. Proper fix needs per-exercise `updatedAt`
   + merge logic in `pullSharedExercises`. Current behavior is
   "acceptable-for-now" because the collision probability is low.

## When picking up

- Streak/total: start from `storage.calculateStats`, then fan out to
  every place that displays either number (Home, Profile, Buddy card,
  Compare). Choose semantics once; apply uniformly.
- Shared library: consider Cloud Function for writes, or move notes
  to a public subcollection with creator field on each doc.
- Concurrent edit: add `updatedAt` per-exercise field; merge taking
  newest per-field, not per-doc.
