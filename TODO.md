# Zenith Fitness - Critical Fixes TODO

**Created:** 2026-02-01 12:15 PM
**Status:** IN PROGRESS

---

## Priority Issues (Must Fix)

### 1. ❌ Splash Screen
- [ ] Remove fixed 1.5s timer - show content as soon as data loads
- [ ] Fix white screen on cold start - splash should appear immediately
- **Root cause:** Using setTimeout instead of actual data loading state

### 2. ❌ Home Stats Cards
- [ ] Remove "Total Volume" and "Avg/Session" - not useful metrics
- [ ] Replace with meaningful stats OR just remove the cards
- **Why:** Volume varies by muscle group (legs vs arms), comparison is meaningless

### 3. ❌ Template Selection Dropdown
- [ ] Add dropdown/selector to choose which template to start
- [ ] Currently just lists templates - no way to select one easily
- **Expected:** User picks template from dropdown → starts workout

### 4. ❌ Remove "Log Rest Day" Button
- [ ] Delete the manual rest day button entirely
- [ ] Rest days should be auto-detected (no workout = rest day)
- **Logic:** If no workout logged for a day, it's automatically a rest day

### 5. ❌ Google Sheets Import - Exercise Auto-Population
- [ ] Read "Exercise Data" sheet and auto-add exercises to exercise database
- [ ] Sheet has: Exercise Name, Muscle Group, Equipment
- [ ] These should become available in exercise picker
- **Sheet URL:** `1WvpNhL-CNxFet5VvN_iTtYcDwh3ehCNwv9oYRGFXu1s`

### 6. ❌ Google Sheets Import - Template Creation
- [ ] Read "Workout Plan" sheet and create template automatically
- [ ] Sheet has the user's actual workout routine
- [ ] Should appear as importable template after import
- **Expected:** Import → Template created → Shows in Templates dropdown

### 7. ❌ Templates Page - Edit Existing Templates
- [ ] Add dropdown to SELECT which template to edit
- [ ] Currently only shows list with no edit option for defaults
- [ ] Allow editing any template (including imported ones)

### 8. ❌ History Page - Shows Only One Exercise
- [ ] Likely caused by missing exercises from import issue (#5)
- [ ] Verify: Once exercises are auto-populated, history should show all
- [ ] Check for other potential causes

### 9. ❌ Progress Page - Graph Not Working
- [ ] Current: Bar graph with near-zero heights
- [ ] Expected: LINEAR graph with distinct points
- [ ] Points should be clickable to show volume details at that time
- [ ] Fix data calculation and chart rendering

---

## Completed ✅
- [x] Light mode support (all views)
- [x] PR notifications
- [x] Workout celebration
- [x] Rest timer presets

---

## Deferred (Later)
- [ ] Two-way Google Sheets sync (needs OAuth)

---

## Google Sheet Reference
- **Sheet ID:** `1WvpNhL-CNxFet5VvN_iTtYcDwh3ehCNwv9oYRGFXu1s`
- **Sheets:**
  - Log Sheet - workout history data
  - Exercise Data - exercise names, muscle groups
  - Workout Plan - template structure
