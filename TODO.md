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

### ✅ v2.24.0 - Superset Support
**Status:** Completed 2026-02-11  
**Impact:** Medium — Training efficiency  
**Complexity:** Medium

- [x] Add supersetGroup field to types (v2.21.0)
- [x] Visual grouping in workout view (v2.23.1)
  - Badge on exercise icon
  - Inline superset label
  - Connector lines between superset exercises
  - Group headers
- [x] UI to assign superset groups in weekly plan editor (v2.24.0)
  - Dropdown selector for groups A/B/C/D
  - Purple highlight when assigned
- [ ] *Future:* Shared rest timer (skip rest between A1→A2)

### 🎯 Volume Goals per Muscle Group
**Impact:** Medium — Targeted progression  
**Complexity:** High (needs muscle group tracking)

- ~~Set weekly volume targets (e.g., 12 sets chest, 15 sets legs)~~ ✅ v2.28.0
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

### ✅ v2.25.0 - Deload Week Tracking
**Status:** Completed 2026-02-11  
**Impact:** Low — Periodization support  
**Complexity:** Medium

- [x] Toggle deload mode in Week View
- [x] Track deload history (ISO week format)
- [x] Show weeks since last deload
- [x] Recommend deload after 4+ weeks
- [x] Visual indicators (teal theme)

---

## 🚀 Future (Post-MVP)

- [ ] Two-way Google Sheets sync (OAuth)
- [ ] Workout reminders/notifications
- [x] ~~Workout sharing (export/import JSON)~~ ✅ v2.31.0 - Full data backup!
- [ ] Wear OS companion app
- [ ] Exercise form videos (hosted)
- [ ] Community templates library
- [x] ~~Plate calculator~~ ✅ v2.22.0 - Added to Settings!
- [x] ~~1RM calculator~~ ✅ v2.23.0 - Multiple formulas, weight recommendations!

---

## 🎨 UI/UX Polish Ideas

- [ ] Swipe gestures (swipe exercise left → delete, right → duplicate)
- [ ] Long-press menu for quick actions
- [ ] Haptic feedback on PR achievements
- [x] ~~Sound effects toggle~~ ✅ v2.27.0 - Master toggle + per-type!
- [x] ~~Export workout as shareable image~~ ✅ v2.26.0 - Share from History!
- [x] ~~Dark mode schedule~~ ✅ v2.29.0 - Auto theme with customizable hours!

---

**Last Updated:** 2026-02-11 05:00 IST  
**Current Version:** v2.32.0  
**Next Target:** Swipe Gestures, Long-press Menu
