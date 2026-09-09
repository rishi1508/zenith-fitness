import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { getHapticSettings } from './storage';

export async function hapticImpact(style: 'light' | 'medium' | 'heavy' = 'medium') {
  try {
    if (Capacitor.isNativePlatform()) {
      await Haptics.impact({ style: { light: ImpactStyle.Light, medium: ImpactStyle.Medium, heavy: ImpactStyle.Heavy }[style] });
    } else {
      navigator.vibrate?.({ light: 30, medium: 50, heavy: 100 }[style]);
    }
  } catch { /* ignore */ }
}

export async function hapticNotification(type: 'success' | 'warning' | 'error' = 'success') {
  try {
    if (Capacitor.isNativePlatform()) {
      await Haptics.notification({ type: { success: NotificationType.Success, warning: NotificationType.Warning, error: NotificationType.Error }[type] });
    } else {
      navigator.vibrate?.([100, 50, 100]);
    }
  } catch { /* ignore */ }
}

export async function hapticSelection() {
  try {
    if (Capacitor.isNativePlatform()) {
      await Haptics.selectionStart();
      await Haptics.selectionChanged();
      await Haptics.selectionEnd();
    } else {
      navigator.vibrate?.(10);
    }
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------- cues

/**
 * Named haptic cues, one per sound cue in `src/sound.ts`, so a moment in the
 * app can fire both and they stay in step (see `src/feedback.ts`).
 *
 * A cue is a short score of taps: each beat has a strength and a gap after
 * it. Strength is real on Android — Capacitor's impact styles map to the
 * platform's amplitude levels — and approximated by duration on the web,
 * where the Vibration API only lets us choose how long the motor runs.
 */
export type HapticCue =
  | 'tap' | 'selection' | 'setComplete' | 'restStart' | 'restEnding' | 'restDone'
  | 'prCelebration' | 'workoutComplete' | 'levelUp' | 'error';

type Strength = 'light' | 'medium' | 'heavy';

interface Beat {
  strength: Strength;
  /** Silence after this beat, ms. Ignored on the last beat. */
  gap?: number;
}

/** Web fallback: how long the motor runs for each strength. */
const WEB_MS: Record<Strength, number> = { light: 12, medium: 28, heavy: 55 };

/**
 * Keep these rhythmic and short. A celebration is allowed to be a little
 * pattern; everything routine is one beat, because a phone buzzing on every
 * tap is the fastest way to get haptics switched off for good.
 */
export const HAPTIC_CUES: Record<HapticCue, Beat[]> = {
  tap: [{ strength: 'light' }],
  selection: [{ strength: 'light' }],
  setComplete: [{ strength: 'medium' }],
  restStart: [{ strength: 'light' }],
  restEnding: [{ strength: 'light', gap: 90 }, { strength: 'light' }],
  restDone: [{ strength: 'medium', gap: 80 }, { strength: 'heavy' }],
  prCelebration: [{ strength: 'medium', gap: 70 }, { strength: 'medium', gap: 70 }, { strength: 'heavy' }],
  workoutComplete: [{ strength: 'heavy', gap: 110 }, { strength: 'medium', gap: 70 }, { strength: 'heavy' }],
  levelUp: [{ strength: 'light', gap: 60 }, { strength: 'medium', gap: 60 }, { strength: 'heavy', gap: 90 }, { strength: 'heavy' }],
  error: [{ strength: 'medium', gap: 60 }, { strength: 'medium' }],
};

/** Every cue's total run time, ms. Pure — the tests hold it under 700 ms. */
export function cueDurationMs(cue: HapticCue): number {
  return HAPTIC_CUES[cue].reduce((total, beat, i, all) => {
    const gap = i === all.length - 1 ? 0 : beat.gap ?? 0;
    return total + WEB_MS[beat.strength] + gap;
  }, 0);
}

/** Pure gate: would this cue fire, given these settings? */
export function shouldVibrate(settings: { enabled: boolean }): boolean {
  return settings.enabled;
}

/** The `navigator.vibrate` pattern for a cue: [on, off, on, …]. */
export function webPattern(cue: HapticCue): number[] {
  const out: number[] = [];
  HAPTIC_CUES[cue].forEach((beat, i, all) => {
    out.push(WEB_MS[beat.strength]);
    if (i < all.length - 1) out.push(beat.gap ?? 40);
  });
  return out;
}

/**
 * Fire a cue. Silent no-op when the device has no motor or the user has
 * haptics off; never throws, never awaits anything the caller cares about.
 */
export function hapticCue(cue: HapticCue): void {
  try {
    if (!shouldVibrate(getHapticSettings())) return;
    if (!Capacitor.isNativePlatform()) {
      // Browsers refuse (and log) a vibration before the page has been
      // touched. Nothing is lost by skipping it — there is nobody holding
      // the phone yet.
      const activated = navigator.userActivation?.hasBeenActive ?? true;
      if (activated) navigator.vibrate?.(webPattern(cue));
      return;
    }
    // Native: real amplitude, so play the beats as spaced impacts.
    let delay = 0;
    for (const beat of HAPTIC_CUES[cue]) {
      const fire = () => { void hapticImpact(beat.strength); };
      if (delay === 0) fire(); else setTimeout(fire, delay);
      delay += WEB_MS[beat.strength] + (beat.gap ?? 40);
    }
  } catch { /* haptics are a nicety */ }
}
