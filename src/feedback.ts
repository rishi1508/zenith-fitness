import { hapticCue } from './haptics';
import { playCue } from './sound';
import type { SoundCue } from './sound';

/**
 * One moment, both channels. Sound and haptics share cue names, so a call
 * site says what happened ("setComplete") rather than how it should feel,
 * and each channel decides for itself whether the user has it switched on.
 */
export function feedback(cue: SoundCue): void {
  playCue(cue);
  hapticCue(cue);
}
