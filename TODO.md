# Zenith Fitness — Feature Roadmap

**Status Legend:** 🎯 Planned | 🚧 In Progress | ✅ Done | 🔥 High Priority

---

## 🔥 High Priority (Quick Wins)

### ✅ v2.7.0 - UI Refinements
- [x] Exercise Library button alignment
- [x] Distinct Active state (green badge + ring)
- [x] Rename default template to "Sample Weekly Plan"

### ✅ v2.8.0 - Progressive Overload Tracker
**Status:** Completed 2026-02-02  
**Impact:** High — Core feature for strength progression  
**Complexity:** Medium

Show visual indicators during active workout:
- [x] 🔺 Green up arrow if weight/reps increased vs last session
- [x] ➡️ Gray equals if same
- [x] 🔻 Red down arrow if decreased
- [x] Display last session stats next to current input fields
- [x] Automatic comparison per set with matching last workout

### ✅ v2.9.0 - Exercise Notes
**Status:** Completed 2026-02-02  
**Impact:** High — Personalization & form tracking  
**Complexity:** Low

- [x] Add notes field to Exercise interface
- [x] Show notes in workout view (expandable with emoji header)
- [x] Editable in Exercise Library (expandable cards)
- [x] Use cases: form cues, pain points, RPE tracking

### ✅ v2.10.0 - Weekly Overview Calendar
**Status:** Completed 2026-02-02  
**Impact:** High — Big picture view  
**Complexity:** Medium

- [x] 7-day grid showing active plan
- [x] Color-coded: completed (green), next up (orange), rest (gray with emoji)
- [x] Tap any day to start that workout
- [x] Week progress bar showing workouts completed/total
- [x] Quick stats: workout days vs rest days
- [x] Replaces "Templates" in bottom nav (Templates moved to Settings)

---

## 📊 Medium Priority

### 🎯 Superset Support
**Impact:** Medium — Training efficiency  
**Complexity:** Medium

- Mark exercises as supersets (A1/A2, B1/B2 pattern)
- Shared rest timer between superset pairs
- Visual grouping in workout view

### 🎯 Volume Goals per Muscle Group
**Impact:** Medium — Targeted progression  
**Complexity:** High (needs muscle group tracking)

- Set weekly volume targets (e.g., 12 sets chest, 15 sets legs)
- Track progress throughout week
- End-of-week summary showing hit/miss

### 🎯 Workout Templates from History
**Impact:** Medium — Convenience  
**Complexity:** Low

- Long-press any past workout → "Save as Template"
- Converts to reusable weekly plan
- Quick iteration on what worked

### 🎯 Comparison View
**Impact:** Medium — Analysis tool  
**Complexity:** Medium

- Select two workouts/weeks to compare
- Side-by-side stats: volume, exercises, PRs
- Visual diff highlighting changes

---

## 🌟 Nice to Have

### 🎯 Rest Day Reminders
**Impact:** Low-Medium — Recovery management  
**Complexity:** Low

- Smart notification after 3+ consecutive workout days
- "Consider a rest day" with option to log it
- Respects active plan's rest days

### 🎯 Exercise Video Links
**Impact:** Low — Form reference  
**Complexity:** Low

- Add optional URL field to exercises
- Tap to open YouTube/form guide
- Embedded preview in workout view?

### 🎯 Deload Week Tracking
**Impact:** Low — Periodization support  
**Complexity:** Medium

- Mark weeks as deload
- Auto-suggest 60-70% volume reduction
- Track deload frequency

---

## 🚀 Future (Post-MVP)

- [ ] Two-way Google Sheets sync (OAuth)
- [ ] Workout reminders/notifications
- [ ] Workout sharing (export/import JSON)
- [ ] Wear OS companion app
- [ ] Exercise form videos (hosted)
- [ ] Community templates library
- [ ] Plate calculator (what plates to load)
- [ ] 1RM calculator and predictions

---

## 🎨 UI/UX Polish Ideas

- [ ] Swipe gestures (swipe exercise left → delete, right → duplicate)
- [ ] Long-press menu for quick actions
- [ ] Haptic feedback on PR achievements
- [ ] Sound effects toggle (celebration, timer)
- [ ] Export workout as shareable image
- [ ] Dark mode schedule (auto-switch at sunset)

---

**Last Updated:** 2026-02-02 01:30 IST  
**Current Version:** v2.10.0  
**Next Target:** v2.11.0 - Superset Support
