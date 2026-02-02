# Google Sheets Auto-Sync Setup

This guide explains how to set up automatic two-way sync between Zenith Fitness and Google Sheets.

## How It Works

1. **Read**: App fetches data from your Google Sheet (already working)
2. **Write**: App sends completed workouts to a Google Apps Script webhook that writes to your sheet

## Setup Instructions

### Step 1: Open Your Google Sheet

Open your workout tracking sheet:
https://docs.google.com/spreadsheets/d/1WvpNhL-CNxFet5VvN_iTtYcDwh3ehCNwv9oYRGFXu1s/

### Step 2: Create the Apps Script

1. In your Google Sheet, go to **Extensions → Apps Script**
2. Delete any existing code and paste this:

```javascript
// Zenith Fitness Sync Script
// This script receives workout data from the app and writes it to your sheet

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action;
    
    if (action === 'logWorkout') {
      return logWorkout(data.workout);
    } else if (action === 'addExercise') {
      return addExercise(data.exercise);
    } else if (action === 'updatePlan') {
      return updatePlan(data.plan);
    }
    
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: 'Unknown action' }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function logWorkout(workout) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const logSheet = ss.getSheetByName('Log Sheet');
  
  if (!logSheet) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: 'Log Sheet not found' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  // Format date as DD-MMM-YY
  const date = new Date(workout.date);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const dateStr = date.getDate() + '-' + months[date.getMonth()] + '-' + String(date.getFullYear()).slice(-2);
  
  // Add each exercise as a row
  let firstRow = true;
  for (const exercise of workout.exercises) {
    const sets = exercise.sets.filter(s => s.completed);
    if (sets.length === 0) continue;
    
    const volume = sets.reduce((sum, s) => sum + (s.weight * s.reps), 0);
    
    const row = [
      firstRow ? dateStr : '', // Only show date on first row
      exercise.exerciseName,
      sets[0]?.reps || '',
      sets[0]?.weight || '',
      sets[1]?.reps || '',
      sets[1]?.weight || '',
      sets[2]?.reps || '',
      sets[2]?.weight || '',
      volume
    ];
    
    logSheet.appendRow(row);
    firstRow = false;
  }
  
  return ContentService.createTextOutput(JSON.stringify({ success: true }))
    .setMimeType(ContentService.MimeType.JSON);
}

function addExercise(exercise) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const exerciseSheet = ss.getSheetByName('Exercise Data Transpose');
  
  if (!exerciseSheet) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: 'Exercise Data sheet not found' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  // Check if exercise already exists
  const data = exerciseSheet.getDataRange().getValues();
  for (let i = 0; i < data.length; i++) {
    if (data[i][0] && data[i][0].toString().toLowerCase() === exercise.name.toLowerCase()) {
      return ContentService.createTextOutput(JSON.stringify({ success: true, message: 'Exercise already exists' }))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }
  
  // Add new exercise
  exerciseSheet.appendRow([exercise.name]);
  
  return ContentService.createTextOutput(JSON.stringify({ success: true }))
    .setMimeType(ContentService.MimeType.JSON);
}

function updatePlan(plan) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const planSheet = ss.getSheetByName('Workout Plan');
  
  if (!planSheet) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: 'Workout Plan sheet not found' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  // Clear existing data (except header)
  const lastRow = planSheet.getLastRow();
  if (lastRow > 1) {
    planSheet.getRange(2, 1, lastRow - 1, planSheet.getLastColumn()).clearContent();
  }
  
  // Write header row (day names)
  const headers = plan.days.map(d => d.name);
  planSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  
  // Find max exercises in any day
  const maxExercises = Math.max(...plan.days.map(d => d.exercises.length));
  
  // Write exercises for each day
  for (let row = 0; row < maxExercises; row++) {
    const rowData = plan.days.map(day => {
      return day.exercises[row]?.exerciseName || '';
    });
    planSheet.getRange(row + 2, 1, 1, rowData.length).setValues([rowData]);
  }
  
  return ContentService.createTextOutput(JSON.stringify({ success: true }))
    .setMimeType(ContentService.MimeType.JSON);
}

// Test function
function doGet() {
  return ContentService.createTextOutput('Zenith Fitness Sync API is running!')
    .setMimeType(ContentService.MimeType.TEXT);
}
```

### Step 3: Deploy as Web App

1. Click **Deploy → New deployment**
2. Click the gear icon → Select **Web app**
3. Settings:
   - Description: "Zenith Fitness Sync"
   - Execute as: **Me**
   - Who has access: **Anyone**
4. Click **Deploy**
5. **Copy the Web App URL** (looks like: `https://script.google.com/macros/s/ABC.../exec`)

### Step 4: Add URL to Zenith Fitness

1. Open Zenith Fitness app
2. Go to **Settings**
3. Paste your Web App URL in the **Sync URL** field
4. Tap **Test Connection** to verify

## What Gets Synced

| Action | Syncs To |
|--------|----------|
| Complete a workout | Log Sheet (new rows) |
| Add custom exercise | Exercise Data Transpose |
| Modify weekly plan | Workout Plan sheet |

## Troubleshooting

- **"Script not authorized"**: Re-deploy and authorize when prompted
- **"CORS error"**: Make sure "Who has access" is set to "Anyone"
- **Data not appearing**: Check the correct sheet names exist

## Security Note

The web app URL is like a password — anyone with it can write to your sheet. Don't share it publicly.
