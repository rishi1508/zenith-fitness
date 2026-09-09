import { describe, it, expect } from 'vitest';
import { CUES, SOUND_CUES, cueDurationMs as soundDurationMs, shouldPlayCue } from '../src/sound';
import { HAPTIC_CUES, cueDurationMs as hapticDurationMs, shouldVibrate, webPattern } from '../src/haptics';
import type { HapticCue } from '../src/haptics';

const HAPTIC_NAMES = Object.keys(HAPTIC_CUES) as HapticCue[];

describe('sound cues', () => {
  it('every cue is short enough to feel like feedback, not a jingle', () => {
    for (const cue of SOUND_CUES) expect(soundDurationMs(cue)).toBeLessThanOrEqual(700);
  });

  it('stays in the band a phone speaker reproduces', () => {
    for (const cue of SOUND_CUES) {
      for (const v of CUES[cue].voices) {
        expect(v.freq).toBeGreaterThanOrEqual(329);   // E4, the lowest note any cue uses
        expect(v.freq).toBeLessThanOrEqual(2100);
        expect(['sine', 'triangle']).toContain(v.type);
      }
    }
  });

  it('respects the channel switches', () => {
    const on = { enabled: true, celebration: true, timer: true };
    expect(shouldPlayCue('tap', on)).toBe(true);
    expect(shouldPlayCue('tap', { ...on, enabled: false })).toBe(false);
    expect(shouldPlayCue('restDone', { ...on, timer: false })).toBe(false);
    expect(shouldPlayCue('prCelebration', { ...on, celebration: false })).toBe(false);
    // A muted celebration must not mute the rest timer, and vice versa.
    expect(shouldPlayCue('restDone', { ...on, celebration: false })).toBe(true);
    expect(shouldPlayCue('prCelebration', { ...on, timer: false })).toBe(true);
  });
});

describe('haptic cues', () => {
  it('pairs one haptic cue with every sound cue', () => {
    expect(HAPTIC_NAMES.sort()).toEqual([...SOUND_CUES].sort());
  });

  it('never runs the motor long enough to annoy', () => {
    for (const cue of HAPTIC_NAMES) expect(hapticDurationMs(cue)).toBeLessThanOrEqual(700);
  });

  it('keeps routine cues to a single beat', () => {
    for (const cue of ['tap', 'selection', 'setComplete', 'restStart'] as HapticCue[]) {
      expect(HAPTIC_CUES[cue]).toHaveLength(1);
    }
  });

  it('builds an alternating on/off pattern for the web', () => {
    expect(webPattern('setComplete')).toEqual([28]);
    expect(webPattern('restDone')).toEqual([28, 80, 55]);
    // Odd length: a pattern must always end on a buzz, never a pause.
    for (const cue of HAPTIC_NAMES) expect(webPattern(cue).length % 2).toBe(1);
  });

  it('is off when the user turned it off', () => {
    expect(shouldVibrate({ enabled: true })).toBe(true);
    expect(shouldVibrate({ enabled: false })).toBe(false);
  });
});
