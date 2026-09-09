/**
 * Zenith's UI sound engine.
 *
 * Every cue is *synthesised* with the Web Audio API rather than shipped as
 * an audio file: zero KB in the bundle, nothing to fetch offline, no
 * licence to honour, and each cue stays tweakable as data. The recipes
 * below are plain descriptions of oscillator "voices" (`CUES`), so the
 * pure parts — which cue exists, how long it runs, whether the user's
 * settings allow it — are testable without a DOM.
 *
 * Design rules, all enforced by `tests/sound.test.ts`:
 *   - every cue is under 700 ms;
 *   - notes sit in 330–2100 Hz, the band a phone speaker actually
 *     reproduces without either vanishing or turning shrill;
 *   - sine/triangle only, with an attack/decay envelope on every voice, so
 *     nothing clicks and nothing buzzes;
 *   - a single shared context behind a master gain and a soft low-pass,
 *     because "harsh" in UI audio is nearly always high-frequency grit.
 */
import { getSoundSettings } from './storage';

export type SoundCue =
  | 'tap'
  | 'selection'
  | 'setComplete'
  | 'restStart'
  | 'restEnding'
  | 'restDone'
  | 'prCelebration'
  | 'workoutComplete'
  | 'levelUp'
  | 'error';

/**
 * Which settings switch mutes a cue. `ui` follows the master toggle only —
 * the existing `celebration` / `timer` keys keep their meaning.
 */
export type SoundChannel = 'ui' | 'timer' | 'celebration';

interface Voice {
  type: 'sine' | 'triangle';
  /** Hz. */
  freq: number;
  /** Seconds from the start of the cue. */
  at: number;
  /** Seconds. */
  dur: number;
  /** Peak linear gain before the master stage. */
  gain: number;
  /** Seconds; default 6 ms. Longer = softer, gentler onset. */
  attack?: number;
  /** Cents. Layers a second, slightly detuned oscillator for warmth. */
  detune?: number;
}

interface CueSpec {
  channel: SoundChannel;
  /** One line on what it should sound like — this is the spec, keep it true. */
  description: string;
  voices: Voice[];
}

// Note frequencies used below (equal temperament):
// E4 329.63  G4 392.00  B4 493.88  C5 523.25  E5 659.25  G5 783.99
// A5 880.00  C6 1046.50 D6 1174.66 E6 1318.51 G6 1567.98 C7 2093.00

export const CUES: Record<SoundCue, CueSpec> = {
  tap: {
    channel: 'ui',
    description: 'Barely-there 28 ms click.',
    voices: [{ type: 'sine', freq: 1046.5, at: 0, dur: 0.028, gain: 0.045, attack: 0.002 }],
  },

  selection: {
    channel: 'ui',
    description: 'Soft two-partial tick for tabs and chips.',
    voices: [
      { type: 'sine', freq: 880, at: 0, dur: 0.035, gain: 0.05, attack: 0.002 },
      { type: 'sine', freq: 1318.51, at: 0.012, dur: 0.04, gain: 0.022, attack: 0.002 },
    ],
  },

  setComplete: {
    channel: 'ui',
    description: 'Crisp upward flick, G5 → D6 with a G6 shimmer.',
    voices: [
      { type: 'triangle', freq: 783.99, at: 0, dur: 0.075, gain: 0.13, attack: 0.004, detune: 7 },
      { type: 'sine', freq: 1174.66, at: 0.05, dur: 0.13, gain: 0.1, attack: 0.004 },
      { type: 'sine', freq: 1567.98, at: 0.05, dur: 0.09, gain: 0.03, attack: 0.003 },
    ],
  },

  restStart: {
    channel: 'timer',
    description: 'Falling E5 → B4 — "stand down".',
    voices: [
      { type: 'sine', freq: 659.25, at: 0, dur: 0.09, gain: 0.085 },
      { type: 'sine', freq: 493.88, at: 0.065, dur: 0.15, gain: 0.075 },
    ],
  },

  restEnding: {
    channel: 'timer',
    description: 'One soft 45 ms tick; fire it at 3, 2 and 1.',
    voices: [
      { type: 'triangle', freq: 1046.5, at: 0, dur: 0.045, gain: 0.06, attack: 0.003 },
      { type: 'sine', freq: 1567.98, at: 0, dur: 0.035, gain: 0.018, attack: 0.002 },
    ],
  },

  restDone: {
    channel: 'timer',
    description: 'Clear rising two-tone, A5 → D6. Reads across a gym.',
    voices: [
      { type: 'sine', freq: 880, at: 0, dur: 0.15, gain: 0.15, detune: 6 },
      { type: 'sine', freq: 1174.66, at: 0.13, dur: 0.28, gain: 0.15, detune: 6 },
    ],
  },

  prCelebration: {
    channel: 'celebration',
    description: 'Bright ascending arpeggio G5-C6-E6-G6 with a ringing top note.',
    voices: [
      { type: 'triangle', freq: 783.99, at: 0, dur: 0.12, gain: 0.1, attack: 0.004 },
      { type: 'triangle', freq: 1046.5, at: 0.055, dur: 0.12, gain: 0.1, attack: 0.004 },
      { type: 'triangle', freq: 1318.51, at: 0.11, dur: 0.13, gain: 0.1, attack: 0.004 },
      { type: 'triangle', freq: 1567.98, at: 0.165, dur: 0.3, gain: 0.11, attack: 0.005, detune: 8 },
      { type: 'sine', freq: 2093, at: 0.165, dur: 0.18, gain: 0.03, attack: 0.005 },
    ],
  },

  workoutComplete: {
    channel: 'celebration',
    description: 'Little fanfare: C5-E5-G5 run into a held C major chord.',
    voices: [
      { type: 'triangle', freq: 523.25, at: 0, dur: 0.1, gain: 0.11, attack: 0.005 },
      { type: 'triangle', freq: 659.25, at: 0.075, dur: 0.1, gain: 0.11, attack: 0.005 },
      { type: 'triangle', freq: 783.99, at: 0.15, dur: 0.1, gain: 0.11, attack: 0.005 },
      { type: 'triangle', freq: 1046.5, at: 0.225, dur: 0.38, gain: 0.12, attack: 0.006, detune: 7 },
      { type: 'sine', freq: 1318.51, at: 0.225, dur: 0.38, gain: 0.07, attack: 0.008 },
      { type: 'sine', freq: 1567.98, at: 0.225, dur: 0.38, gain: 0.055, attack: 0.01 },
    ],
  },

  levelUp: {
    channel: 'celebration',
    description: 'Magical rising sparkle A5-D6-G6 landing on a ringing C7.',
    voices: [
      { type: 'sine', freq: 880, at: 0, dur: 0.09, gain: 0.09, attack: 0.004 },
      { type: 'sine', freq: 1174.66, at: 0.06, dur: 0.09, gain: 0.09, attack: 0.004 },
      { type: 'sine', freq: 1567.98, at: 0.12, dur: 0.11, gain: 0.1, attack: 0.004 },
      { type: 'sine', freq: 2093, at: 0.18, dur: 0.34, gain: 0.07, attack: 0.005, detune: 9 },
      { type: 'triangle', freq: 1046.5, at: 0.18, dur: 0.34, gain: 0.05, attack: 0.01 },
    ],
  },

  error: {
    channel: 'ui',
    description: 'Gentle falling G4 → E4 with a slow onset. A shrug, not a buzzer.',
    voices: [
      { type: 'triangle', freq: 392, at: 0, dur: 0.15, gain: 0.1, attack: 0.018 },
      { type: 'triangle', freq: 329.63, at: 0.12, dur: 0.24, gain: 0.1, attack: 0.018 },
    ],
  },
};

export const SOUND_CUES = Object.keys(CUES) as SoundCue[];

/** Longest voice tail, in milliseconds. Pure — used by the tests. */
export function cueDurationMs(cue: SoundCue): number {
  return Math.round(1000 * Math.max(...CUES[cue].voices.map((v) => v.at + v.dur)));
}

/** Master trim. Individual voice gains are mixed against this. */
const MASTER_GAIN = 0.6;
/** Shaves the high grit off the triangle harmonics. */
const TONE_CUTOFF_HZ = 6500;

/** Pure gate: would this cue play, given these settings? */
export function shouldPlayCue(
  cue: SoundCue,
  settings: { enabled: boolean; celebration: boolean; timer: boolean },
): boolean {
  if (!settings.enabled) return false;
  const { channel } = CUES[cue];
  return channel === 'ui' ? true : settings[channel];
}

let ctx: AudioContext | null = null;
let bus: GainNode | null = null;
let unavailable = false;

function ensureContext(): AudioContext | null {
  if (ctx) {
    // Android parks the context whenever the app backgrounds; nudge it awake.
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
    return ctx;
  }
  if (unavailable || typeof window === 'undefined') return null;
  try {
    const Ctor =
      window.AudioContext
      || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) { unavailable = true; return null; }
    ctx = new Ctor();
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = TONE_CUTOFF_HZ;
    tone.Q.value = 0.7;
    bus = ctx.createGain();
    bus.gain.value = MASTER_GAIN;
    bus.connect(tone);
    tone.connect(ctx.destination);
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
    return ctx;
  } catch {
    unavailable = true;
    return null;
  }
}

function scheduleVoice(audio: AudioContext, out: GainNode, v: Voice, t0: number) {
  const start = t0 + v.at;
  const end = start + v.dur;
  const attack = Math.min(v.attack ?? 0.006, v.dur * 0.5);
  // Two oscillators sum into the same node, so halve the peak when detuned.
  const peak = Math.max(v.detune ? v.gain / 2 : v.gain, 0.0002);

  const env = audio.createGain();
  env.connect(out);
  env.gain.setValueAtTime(0.0001, start);
  env.gain.exponentialRampToValueAtTime(peak, start + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, end);

  const spawn = (cents: number) => {
    const osc = audio.createOscillator();
    osc.type = v.type;
    osc.frequency.setValueAtTime(v.freq, start);
    osc.detune.value = cents;
    osc.connect(env);
    osc.start(start);
    osc.stop(end + 0.02);
  };
  spawn(0);
  if (v.detune) spawn(v.detune);
}

/**
 * Play a named cue. Silent no-op when the platform has no Web Audio, when
 * the context cannot start, or when the user has the cue's channel off —
 * never throws, never logs.
 */
export function playCue(cue: SoundCue): void {
  try {
    if (!shouldPlayCue(cue, getSoundSettings())) return;
    const audio = ensureContext();
    if (!audio || !bus) return;
    const t0 = audio.currentTime + 0.005;
    for (const voice of CUES[cue].voices) scheduleVoice(audio, bus, voice, t0);
  } catch {
    /* audio is a nicety; never let it break a screen */
  }
}

/**
 * Create and resume the context from inside a user gesture. Browsers only
 * allow that transition on a real interaction, so we hook the first one and
 * everything after it plays instantly.
 */
export function primeAudio(): void {
  if (typeof window === 'undefined') return;
  try {
    if (!getSoundSettings().enabled) return;
    ensureContext();
  } catch {
    /* ignore */
  }
}

if (typeof window !== 'undefined') {
  const unlock = () => primeAudio();
  window.addEventListener('pointerdown', unlock, { once: true, capture: true, passive: true });
  window.addEventListener('keydown', unlock, { once: true, capture: true });
}
