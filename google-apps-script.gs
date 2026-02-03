/**
 * Zenith Fitness - Google Apps Script
 * 
 * This script receives workout data from the Zenith Fitness app
 * and logs it to your Google Sheets.
 * 
 * SETUP INSTRUCTIONS:
 * 1. Open your Google Sheet: https://docs.google.com/spreadsheets/d/1WvpNhL-CNxFet5VvN_iTtYcDwh3ehCNwv9oYRGFXu1s
 * 2. Go to Extensions > Apps Script
 * 3. Delete any existing code and paste this entire script
 * 4. Click "Deploy" > "New deployment"
 * 5. Select type: "Web app"
 * 6. Set "Execute as": Me
 * 7. Set "Who has access": Anyone
 * 8. Click "Deploy"
 * 9. Copy the Web App URL (looks like: https://script.google.com/macros/s/xxx/exec)
 * 10. In Zenith Fitness app: Settings > Google Sheets Sync > Paste the URL
 * 
 * That's it! Your workouts will now auto-sync.
 */

// Sheet names (must match your spreadsheet)
const LOG_SHEET = 'Log Sheet';
const EXERCISE_SHEET = 'Exercise Data Transpose';
const PLAN_SHEET = 'Workout Plan';

/**
 * Handle GET requests (for testing connection)
 */
function doGet(e) {
  return ContentService.createTextOutput('Zenith Fitness Sync API is running!')
    .setMimeType(ContentService.MimeType.TEXT);
}

/**
 * Handle POST requests from the app
 */
function doPost(e) {
  try {
    // Log for debugging
    console.log('Received POST:', e.postData?.contents);
    
    // Parse JSON from body (works with text/plain or application/json)
    const data = JSON.parse(e.postData.contents || '{}');
    
    switch (data.action) {
      case 'logWorkout':
        return logWorkout(data.workout);
      case 'addExercise':
        return addExercise(data.exercise);
      case 'updatePlan':
        return updatePlan(data.plan);
      default:
        return createResponse(false, 'Unknown action: ' + data.action);
    }
  } catch (error) {
    return createResponse(false, 'Error: ' + error.message);
  }
}

/**
 * Log a completed workout to the Log Sheet
 * Format: Date | Exercise | Set1 Reps | Set1 Weight | Set2 Reps | Set2 Weight | Set3 Reps | Set3 Weight | Volume
 */
function logWorkout(workout) {
  if (!workout || !workout.exercises) {
    return createResponse(false, 'Invalid workout data');
  }
  
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(LOG_SHEET);
  if (!sheet) {
    return createResponse(false, 'Log Sheet not found');
  }
  
  const date = formatDate(new Date(workout.date));
  let isFirstExercise = true;
  
  for (const exercise of workout.exercises) {
    const sets = exercise.sets.filter(s => s.completed);
    if (sets.length === 0) continue;
    
    // Calculate volume
    const volume = sets.reduce((sum, s) => sum + (s.weight * s.reps), 0);
    
    // Build row data
    const row = [
      isFirstExercise ? date : '', // Only show date on first exercise
      exercise.exerciseName,
      sets[0]?.reps || '',
      sets[0]?.weight || '',
      sets[1]?.reps || '',
      sets[1]?.weight || '',
      sets[2]?.reps || '',
      sets[2]?.weight || '',
      volume
    ];
    
    sheet.appendRow(row);
    isFirstExercise = false;
  }
  
  return createResponse(true, 'Workout logged successfully');
}

/**
 * Add a new exercise to the Exercise Data sheet
 */
function addExercise(exercise) {
  if (!exercise || !exercise.name) {
    return createResponse(false, 'Invalid exercise data');
  }
  
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(EXERCISE_SHEET);
  if (!sheet) {
    return createResponse(false, 'Exercise Data sheet not found');
  }
  
  // Check if exercise already exists (first column)
  const existingData = sheet.getRange('A:A').getValues();
  const exists = existingData.some(row => 
    row[0] && row[0].toString().toLowerCase() === exercise.name.toLowerCase()
  );
  
  if (!exists) {
    // Find the next empty row in column A
    const lastRow = sheet.getLastRow();
    sheet.getRange(lastRow + 1, 1).setValue(exercise.name);
  }
  
  return createResponse(true, 'Exercise added');
}

/**
 * Update the Workout Plan sheet
 */
function updatePlan(plan) {
  if (!plan || !plan.days) {
    return createResponse(false, 'Invalid plan data');
  }
  
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PLAN_SHEET);
  if (!sheet) {
    return createResponse(false, 'Workout Plan sheet not found');
  }
  
  // Clear existing content (except header row)
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, plan.days.length).clearContent();
  }
  
  // Write headers (Day names)
  const headers = plan.days.map(d => d.name);
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  
  // Find max exercises across all days
  const maxExercises = Math.max(...plan.days.map(d => d.exercises?.length || 0));
  
  // Write exercises for each day
  for (let row = 0; row < maxExercises; row++) {
    const rowData = plan.days.map(day => {
      const ex = day.exercises?.[row];
      return ex ? ex.exerciseName : '';
    });
    sheet.getRange(row + 2, 1, 1, rowData.length).setValues([rowData]);
  }
  
  return createResponse(true, 'Plan updated');
}

/**
 * Format date as DD-MMM-YY (e.g., 03-Feb-26)
 */
function formatDate(date) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = date.getDate();
  const month = months[date.getMonth()];
  const year = date.getFullYear().toString().slice(-2);
  return `${day}-${month}-${year}`;
}

/**
 * Create JSON response
 */
function createResponse(success, message) {
  return ContentService.createTextOutput(JSON.stringify({
    success: success,
    message: message,
    timestamp: new Date().toISOString()
  })).setMimeType(ContentService.MimeType.JSON);
}
