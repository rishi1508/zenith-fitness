# Zenith Fitness - Critical Fixes TODO

**Created:** 2026-02-01 12:15 PM
**Status:** IN PROGRESS

---

## Priority Issues (Must Fix)

### 1. ✅ Splash Screen — FIXED
- [x] Remove fixed 1.5s timer - now loads data and dismisses
- [x] Splash shows immediately, no white screen
- **Fix:** Removed setTimeout, splash hides when loadData completes

### 2. ✅ Home Stats Cards — FIXED
- [x] Removed "Total Volume" and "Avg/Session"
- [x] Now shows only "This Week" and "Total Workouts"
- **Why:** Volume metrics are meaningless (legs vs arms comparison)

### 3. ✅ Weekly Plan System — MAJOR REFACTOR
- [x] Templates → Weekly Plans (e.g., "4 Full Body + 1 Arms")
- [x] Each plan has multiple days with their own exercises
- [x] Home shows active plan label with switch button
- [x] Day selector dropdown (Day 1, Day 2, etc.)
- [x] Remembers last used day and active plan

### 4. ✅ Remove "Log Rest Day" Button — FIXED
- [x] Deleted the manual rest day button
- [x] Rest days are auto-detected (no workout = rest day)

### 5. ✅ Google Sheets Import - Exercise Auto-Population — FIXED
- [x] Now reads "Exercise Data Transpose" sheet (first COLUMN has names)
- [x] Extracts exercise names from first column
- [x] Auto-adds to exercise database with guessed muscle groups
- **Note:** Re-import to populate exercises

### 6. ✅ Google Sheets Import - Weekly Plan Creation — FIXED
- [x] Now reads "Workout Plan" sheet properly
- [x] Creates WeeklyPlan with SEPARATE days (Day 1, Day 2, etc.)
- [x] Each day has its own exercises
- [x] Empty days marked as rest days
- [x] Sets imported plan as active automatically
- **Note:** Re-import to create proper weekly plan

### 7. ✅ Templates Page - Edit All Templates — FIXED
- [x] Added Edit button to ALL templates (not just custom)
- [x] Default templates can now be edited
- [x] Delete button only shows for custom templates
- [x] Light mode styling for buttons

### 8. ❌ History Page - Shows Only One Exercise
- [ ] Re-test after running import (exercises should now populate)
- [ ] Verify all exercises show after import fix
- [ ] Check for other potential causes

### 9. ✅ Progress Page - Graph Fixed
- [x] Replaced bar chart with interactive SVG line chart
- [x] Points are clickable - shows date, volume, max weight/reps
- [x] Area fill under line for visual appeal
- [x] Hover/click interaction on points
- [x] Shows last 15 sessions

---

## Completed ✅
- [x] Light mode support (all views)
- [x] PR notifications
- [x] Workout celebration
- [x] Rest timer presets

---

## In Progress
- [ ] **Weekly Plan Creator** - per-day input (significant UI work)
  - Need to refactor Templates view to manage WeeklyPlans
  - UI for adding/removing days
  - Assign exercises per day
  - Mark rest days

## Deferred (Later)
- [ ] Two-way Google Sheets sync (needs OAuth)

---

## Google Sheet Reference
- **Sheet ID:** `1WvpNhL-CNxFet5VvN_iTtYcDwh3ehCNwv9oYRGFXu1s`
- **Sheets:**
  - Log Sheet - workout history data
  - Exercise Data - exercise names, muscle groups
  - Workout Plan - template structure
