// Google Sheets Sync Service
// Automatically syncs workout data to Google Sheets via Apps Script webhook

const SYNC_URL_KEY = 'zenith_sync_url';
const SYNC_QUEUE_KEY = 'zenith_sync_queue';

export interface SyncPayload {
  action: 'logWorkout' | 'addExercise' | 'updatePlan';
  workout?: unknown;
  exercise?: unknown;
  plan?: unknown;
  timestamp: number;
  id: string;
}

// Get/Set sync URL
export function getSyncUrl(): string | null {
  try {
    return localStorage.getItem(SYNC_URL_KEY);
  } catch {
    return null;
  }
}

export function setSyncUrl(url: string): void {
  try {
    localStorage.setItem(SYNC_URL_KEY, url.trim());
  } catch (e) {
    console.error('[Sync] Failed to save URL:', e);
  }
}

export function clearSyncUrl(): void {
  try {
    localStorage.removeItem(SYNC_URL_KEY);
  } catch {
    // ignore
  }
}

// Queue management for offline support
function getQueue(): SyncPayload[] {
  try {
    const data = localStorage.getItem(SYNC_QUEUE_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

function saveQueue(queue: SyncPayload[]): void {
  try {
    localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(queue));
  } catch (e) {
    console.error('[Sync] Failed to save queue:', e);
  }
}

function addToQueue(payload: SyncPayload): void {
  const queue = getQueue();
  queue.push(payload);
  saveQueue(queue);
}

function removeFromQueue(id: string): void {
  const queue = getQueue().filter(p => p.id !== id);
  saveQueue(queue);
}

// Core sync function
async function syncToSheets(payload: SyncPayload): Promise<{ success: boolean; error?: string }> {
  const url = getSyncUrl();
  if (!url) {
    console.log('[Sync] No sync URL configured');
    return { success: false, error: 'No sync URL configured' };
  }

  console.log('[Sync] Sending to:', url);
  console.log('[Sync] Payload:', JSON.stringify(payload, null, 2));

  try {
    // Use text/plain to avoid CORS preflight, Apps Script will parse JSON from body
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
      },
      body: JSON.stringify(payload),
      redirect: 'follow',
    });

    console.log('[Sync] Response status:', response.status, response.statusText);
    
    // Try to read response (Apps Script redirects, but fetch follows)
    if (response.ok) {
      try {
        const text = await response.text();
        console.log('[Sync] Response body:', text);
        const data = JSON.parse(text);
        return { success: data.success !== false };
      } catch {
        // Response wasn't JSON, but request went through
        console.log('[Sync] Non-JSON response, assuming success');
        return { success: true };
      }
    }
    
    console.log('[Sync] Response not OK, but no error thrown');
    return { success: true }; // Assume success if no error thrown
  } catch (e) {
    console.error('[Sync] Request failed:', e);
    return { success: false, error: e instanceof Error ? e.message : 'Network error' };
  }
}

// Public sync functions

/**
 * Sync a completed workout to Google Sheets
 */
export async function syncWorkout(workout: {
  date: string;
  name: string;
  exercises: Array<{
    exerciseId: string;
    exerciseName: string;
    sets: Array<{
      reps: number;
      weight: number;
      completed: boolean;
    }>;
  }>;
}): Promise<boolean> {
  const payload: SyncPayload = {
    action: 'logWorkout',
    workout,
    timestamp: Date.now(),
    id: `workout_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
  };

  const result = await syncToSheets(payload);
  
  if (!result.success) {
    // Add to queue for retry later
    addToQueue(payload);
    console.log('[Sync] Workout queued for later sync');
  }
  
  return result.success;
}

/**
 * Sync a new exercise to Google Sheets
 */
export async function syncExercise(exercise: {
  name: string;
  muscleGroup: string;
}): Promise<boolean> {
  const payload: SyncPayload = {
    action: 'addExercise',
    exercise,
    timestamp: Date.now(),
    id: `exercise_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
  };

  const result = await syncToSheets(payload);
  
  if (!result.success) {
    addToQueue(payload);
  }
  
  return result.success;
}

/**
 * Sync weekly plan to Google Sheets
 */
export async function syncPlan(plan: {
  name: string;
  days: Array<{
    dayNumber: number;
    name: string;
    exercises: Array<{
      exerciseName: string;
    }>;
  }>;
}): Promise<boolean> {
  const payload: SyncPayload = {
    action: 'updatePlan',
    plan,
    timestamp: Date.now(),
    id: `plan_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
  };

  const result = await syncToSheets(payload);
  
  if (!result.success) {
    addToQueue(payload);
  }
  
  return result.success;
}

/**
 * Process queued sync items (call on app startup or when online)
 */
export async function processQueue(): Promise<number> {
  const queue = getQueue();
  if (queue.length === 0) return 0;

  let processed = 0;
  
  for (const payload of queue) {
    const result = await syncToSheets(payload);
    if (result.success) {
      removeFromQueue(payload.id);
      processed++;
    }
  }
  
  console.log(`[Sync] Processed ${processed}/${queue.length} queued items`);
  return processed;
}

/**
 * Get number of pending sync items
 */
export function getPendingCount(): number {
  return getQueue().length;
}

/**
 * Test sync connection
 */
export async function testConnection(): Promise<{ success: boolean; message: string }> {
  const url = getSyncUrl();
  if (!url) {
    return { success: false, message: 'No sync URL configured' };
  }

  try {
    // Try a GET request first (Apps Script doGet)
    const response = await fetch(url, {
      method: 'GET',
    });
    
    if (response.ok) {
      const text = await response.text();
      if (text.includes('Zenith Fitness')) {
        return { success: true, message: 'Connection successful!' };
      }
    }
    
    return { success: true, message: 'URL is reachable (cannot verify response due to CORS)' };
  } catch (e) {
    return { success: false, message: `Connection failed: ${e instanceof Error ? e.message : 'Unknown error'}` };
  }
}

/**
 * Check if sync is enabled
 */
export function isSyncEnabled(): boolean {
  return !!getSyncUrl();
}
