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

### 3. ✅ Template Selection Dropdown — FIXED
- [x] Added dropdown selector to choose template
- [x] Shows exercise preview of selected template
- [x] Big "Start Workout" button
- [x] Remembers last used template as default selection

### 4. ✅ Remove "Log Rest Day" Button — FIXED
- [x] Deleted the manual rest day button
- [x] Rest days are auto-detected (no workout = rest day)

### 5. ✅ Google Sheets Import - Exercise Auto-Population — FIXED
- [x] Now reads "Exercise Data" sheet
- [x] Extracts exercise names from first row
- [x] Auto-adds to exercise database with guessed muscle groups
- **Note:** Run import again to populate exercises

### 6. ✅ Google Sheets Import - Template Creation — FIXED
- [x] Now reads "Workout Plan" sheet
- [x] Creates "Imported Workout Plan" template
- [x] Collects exercises from all days
- **Note:** Run import again to create template

### 7. ❌ Templates Page - Edit Existing Templates
- [ ] Add dropdown to SELECT which template to edit
- [ ] Currently only shows list with no edit option for defaults
- [ ] Allow editing any template (including imported ones)

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

## Deferred (Later)
- [ ] Two-way Google Sheets sync (needs OAuth)

---

## Google Sheet Reference
- **Sheet ID:** `1WvpNhL-CNxFet5VvN_iTtYcDwh3ehCNwv9oYRGFXu1s`
- **Sheets:**
  - Log Sheet - workout history data
  - Exercise Data - exercise names, muscle groups
  - Workout Plan - template structure
