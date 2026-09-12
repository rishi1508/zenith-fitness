# 3.28.0 — 2026-09-13

The first gym's asks, built for every gym. See `docs/PILOT_TSZ.md` for the
pilot terms and the paid add-ons, `docs/GYM_TIER_A_SPEC.md` §14 for the data
model.

## New
- **Your gym's exercises, with your trainers' videos.** Staff add the
  movements they coach (My Gym → Manage → Exercise videos) with a YouTube or
  video-file link and their cues. Members see them in every exercise picker
  and the video plays **inside the app** from the exercise card mid-set — no
  more bouncing to a browser tab. Members can also browse the whole list
  under My Gym → Member → Exercise videos.
- **Your gym's workout plans.** Staff share any of their weekly plans with
  the gym (Train → Weekly plans → Share with gym). Members find them under
  Train → "Plans from <gym>" or My Gym → Workout plans, and adopt one with a
  tap; it becomes their active plan. Sharing again after an edit refreshes
  every member's copy.
- **Anonymous session ratings.** Once a class has happened, members who were
  in it rate it 1–5 with an optional comment from the class page. The rating
  is written by the server under a keyed hash of who voted — one rating per
  person per session, and no name anywhere in the database, so members say
  what they actually felt. Owners and managers see the 30-day average,
  per-trainer and per-class lines, and the comments in Analytics. Trainers do
  not see ratings.
- **Your gym's name on the app.** The splash screen reads "Zenith Fitness ·
  by <gym>", the home screen leads with the gym's name, and the gym's logo
  sits on the home gym row.

## Verified
Rules matrix 74/74; type-check, lint and 347 tests clean; headless end to
end against production data — owner adds a video exercise (YouTube embed
renders), shares a plan; member adopts it (active plan, use count 1), plays
the video, rates a session through the live API (document carries stars,
comment, trainer — no uid); owner's Analytics shows 5.0 / 5 · 1 rating and
the comment. QA data removed afterwards.
