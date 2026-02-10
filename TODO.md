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

### 🚧 Superset Support
**Impact:** Medium — Training efficiency  
**Complexity:** Medium  
**Status:** Types defined (2026-02-11), UI implementation pending

- [x] Add supersetGroup field to WorkoutExercise type
- [x] Add supersetGroup field to TemplateExercise type  
- [ ] Mark exercises as supersets (A1/A2, B1/B2 pattern)
- [ ] Shared rest timer between superset pairs
- [ ] Visual grouping in workout view
- [ ] UI to assign superset groups in weekly plan editor

### 🎯 Volume Goals per Muscle Group
**Impact:** Medium — Targeted progression  
**Complexity:** High (needs muscle group tracking)

- Set weekly volume targets (e.g., 12 sets chest, 15 sets legs)
- Track progress throughout week
- End-of-week summary showing hit/miss

### ✅ v2.11.0 - Workout Templates from History
**Status:** Completed 2026-02-02  
**Impact:** Medium — Convenience  
**Complexity:** Low

- [x] Copy icon in history cards
- [x] Converts workout to new weekly plan
- [x] Prompts for custom name
- [x] Adds as Day 1 + Rest Day template
- [x] Toast confirmation

### ✅ v2.21.0 - Comparison View
**Status:** Completed 2026-02-11  
**Impact:** Medium — Analysis tool  
**Complexity:** Medium

- [x] New ComparisonView component with workout selector
- [x] Side-by-side stats: volume, sets, avg weight, duration
- [x] Exercise-by-exercise breakdown with diff indicators
- [x] Summary card showing overall improvement/decline
- [x] Accessible from Progress view (Compare button)

---

## 🌟 Nice to Have

### ✅ v2.12.0 - Rest Day Reminders
**Status:** Completed 2026-02-02  
**Impact:** Low-Medium — Recovery management  
**Complexity:** Low

- [x] Detects 3+ consecutive workout days
- [x] Blue banner on home screen suggesting rest
- [x] One-tap button to log rest day
- [x] Auto-refresh after logging

### ✅ v2.13.0 - Exercise Video Links
**Status:** Completed 2026-02-02  
**Impact:** Low — Form reference  
**Complexity:** Low

- [x] Video URL field in Exercise Library editor
- [x] Opens in new tab during workouts
- [x] Displayed with notes in blue callout box
- [x] Icon: ▶️ Watch Form Video

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

**Last Updated:** 2026-02-11 03:30 IST  
**Current Version:** v2.20.0  
**Next Target:** Superset Support UI, Comparison View
