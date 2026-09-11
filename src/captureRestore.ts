import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';

/**
 * The half of taking a photo that happens after Android has killed us.
 *
 * `Camera.getPhoto` hands the screen to the system camera app, and on a phone
 * with much else open Android reclaims our process behind it. Capacitor saves
 * the pending call in the activity's instance state and, when we are recreated,
 * delivers the photo — but NOT to the JavaScript promise that asked for it:
 * that promise died with the old WebView. It arrives as the `App` plugin's
 * `appRestoredResult` event, retained until something listens. Nothing did, so
 * from the user's side the app "crashed", restarted on Home, and the photo was
 * gone. Every earlier fix changed how the camera was opened; this is the first
 * that handles how it comes back.
 *
 * Two pieces. Before the capture starts, `markPendingCapture` writes WHY the
 * photo was being taken (which screen, for which meal or gym) to localStorage,
 * since React state does not survive the restart either. On boot,
 * `installCaptureRestore` listens for the retained result, reads the photo
 * back into a Blob, parks it in `restored`, and tells App.tsx where to go; the
 * destination screen picks the Blob up with `consumeRestoredPhoto` on mount.
 */

export type CapturePurpose = 'food-scan' | 'gym-feed' | 'gym-announcement';

export interface PendingCapture {
  purpose: CapturePurpose;
  /** Screen-specific context: the diary date and meal, the gym id. */
  extra?: Record<string, string>;
  at: number;
}

const KEY = 'zenith_pending_capture';
/** Older than this and the marker is stale — a capture nobody is waiting on. */
const MAX_AGE_MS = 30 * 60 * 1000;

export function markPendingCapture(purpose: CapturePurpose, extra?: Record<string, string>): void {
  try {
    const marker: PendingCapture = { purpose, extra, at: Date.now() };
    localStorage.setItem(KEY, JSON.stringify(marker));
  } catch { /* storage unavailable — restore just will not know where to go */ }
}

export function clearPendingCapture(): void {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

function readPendingCapture(): PendingCapture | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const marker = JSON.parse(raw) as PendingCapture;
    if (!marker.purpose || Date.now() - marker.at > MAX_AGE_MS) return null;
    return marker;
  } catch {
    return null;
  }
}

const restored = new Map<CapturePurpose, { blob: Blob; extra?: Record<string, string> }>();

/** The photo that came back after a restart, for the screen it was meant for.
 *  One-shot: the second call returns null. */
export function consumeRestoredPhoto(purpose: CapturePurpose): { blob: Blob; extra?: Record<string, string> } | null {
  const hit = restored.get(purpose) ?? null;
  restored.delete(purpose);
  return hit;
}

export interface RestoreOutcome {
  purpose: CapturePurpose;
  extra?: Record<string, string>;
  /** False when Android brought us back but the photo did not survive. */
  ok: boolean;
}

/** Shape of the Camera plugin's result as it arrives through the App plugin. */
interface RestoredCameraData {
  webPath?: string;
  path?: string;
  format?: string;
}

/**
 * Start listening for a photo delivered to a recreated app. Returns a
 * disposer. Native only; on the web the WebView is the process.
 */
export function installCaptureRestore(onRestored: (outcome: RestoreOutcome) => void): () => void {
  if (!Capacitor.isNativePlatform()) return () => {};
  let disposed = false;
  const handle = CapApp.addListener('appRestoredResult', async (event) => {
    if (event.pluginId !== 'Camera' || event.methodName !== 'getPhoto') return;
    const marker = readPendingCapture();
    clearPendingCapture();
    // A camera result we did not ask for from any screen we know — nothing
    // to restore, and nowhere to put it.
    if (!marker) return;

    const data = (event.data ?? {}) as RestoredCameraData;
    const src = data.webPath ?? (data.path ? Capacitor.convertFileSrc(data.path) : null);
    if (!event.success || !src) {
      if (!disposed) onRestored({ purpose: marker.purpose, extra: marker.extra, ok: false });
      return;
    }
    try {
      const response = await fetch(src);
      if (!response.ok) throw new Error('unreadable');
      restored.set(marker.purpose, { blob: await response.blob(), extra: marker.extra });
      if (!disposed) onRestored({ purpose: marker.purpose, extra: marker.extra, ok: true });
    } catch {
      if (!disposed) onRestored({ purpose: marker.purpose, extra: marker.extra, ok: false });
    }
  });
  return () => {
    disposed = true;
    void handle.then((h) => h.remove());
  };
}
