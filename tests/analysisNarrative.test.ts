import { describe, it, expect, beforeEach, vi } from 'vitest';

// Node has no localStorage. The cache needs the enumerable half of the API
// too (length/key), because writing today's answer sweeps up older days.
const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
});

import {
  NARRATIVE_KEY_PREFIX, buildNarrativeContext, fetchNarrative, narrativeCacheKey,
  readNarrativeCache, writeNarrativeCache,
} from '../src/analysis/narrative';
import { buildAnalysis } from '../src/analysis/engine';
import type { AnalysisReport } from '../src/analysis/engine';
import { ZenError } from '../src/zen/client';
import type { AskZenOptions, AskZenResult } from '../src/zen/client';
import type { Exercise, Workout } from '../src/types';

const NOW = new Date(2026, 8, 16, 18, 0, 0);
const DAY = 86_400_000;

const LIBRARY: Exercise[] = [
  { id: 'bench', name: 'Bench Press', muscleGroup: 'chest', isCompound: true },
  { id: 'row', name: 'Barbell Row', muscleGroup: 'back', isCompound: true },
];

function bench(daysAgo: number, weight: number): Workout {
  const date = new Date(NOW.getTime() - daysAgo * DAY);
  return {
    id: `w${daysAgo}`,
    date: date.toISOString(),
    name: 'Push',
    type: 'push',
    completed: true,
    duration: 55,
    exercises: [{
      id: `we${daysAgo}`,
      exerciseId: 'bench',
      exerciseName: 'Bench Press',
      sets: [
        { id: 's1', weight, reps: 8, completed: true },
        { id: 's2', weight, reps: 8, completed: true },
      ],
    }],
  };
}

function report(): AnalysisReport {
  return buildAnalysis({
    workouts: [bench(3, 80), bench(7, 82.5), bench(10, 85), bench(14, 85), bench(17, 87.5)],
    exercises: LIBRARY,
    window: '12w',
    commitment: 3,
    now: NOW,
  });
}

/** A stub Zen that records what it was asked and answers once. */
function stubZen(answer = 'You are training well.') {
  const calls: AskZenOptions[] = [];
  const ask = vi.fn(async (opts: AskZenOptions): Promise<AskZenResult> => {
    calls.push(opts);
    return { text: `  ${answer}  `, model: 'test-model' };
  });
  return { ask, calls };
}

beforeEach(() => {
  store.clear();
});

describe('narrativeCacheKey', () => {
  it('is one key per window per local day', () => {
    expect(narrativeCacheKey('12w', NOW)).toBe(`${NARRATIVE_KEY_PREFIX}12w_2026-09-16`);
    expect(narrativeCacheKey('4w', NOW)).toBe(`${NARRATIVE_KEY_PREFIX}4w_2026-09-16`);
    expect(narrativeCacheKey('all', NOW)).toBe(`${NARRATIVE_KEY_PREFIX}all_2026-09-16`);
  });

  it('uses the local date, not the UTC one', () => {
    // 00:30 local on the 16th is still the 15th in UTC for anyone east of Greenwich.
    const justAfterMidnight = new Date(2026, 8, 16, 0, 30, 0);
    expect(narrativeCacheKey('12w', justAfterMidnight)).toContain('2026-09-16');
  });
});

describe('narrative cache', () => {
  it('reads back what it wrote, on the same day', () => {
    writeNarrativeCache('12w', { text: 'Solid block.', at: NOW.toISOString() }, NOW);
    expect(readNarrativeCache('12w', NOW)?.text).toBe('Solid block.');
  });

  it('expires at the day boundary', () => {
    writeNarrativeCache('12w', { text: 'Yesterday.', at: NOW.toISOString() }, NOW);
    const tomorrow = new Date(NOW.getTime() + DAY);
    expect(readNarrativeCache('12w', tomorrow)).toBeNull();
  });

  it('does not serve one window\'s read-out for another', () => {
    writeNarrativeCache('12w', { text: 'Twelve weeks.', at: NOW.toISOString() }, NOW);
    expect(readNarrativeCache('4w', NOW)).toBeNull();
  });

  it('sweeps up older days so the cache cannot grow forever', () => {
    const yesterday = new Date(NOW.getTime() - DAY);
    writeNarrativeCache('12w', { text: 'Old.', at: yesterday.toISOString() }, yesterday);
    writeNarrativeCache('4w', { text: 'Old too.', at: yesterday.toISOString() }, yesterday);
    writeNarrativeCache('12w', { text: 'New.', at: NOW.toISOString() }, NOW);

    const keys = [...store.keys()].filter((k) => k.startsWith(NARRATIVE_KEY_PREFIX));
    expect(keys).toEqual([narrativeCacheKey('12w', NOW)]);
  });

  it('survives corrupt storage', () => {
    localStorage.setItem(narrativeCacheKey('12w', NOW), 'not json');
    expect(readNarrativeCache('12w', NOW)).toBeNull();
  });
});

describe('buildNarrativeContext', () => {
  it('sends numbers, never raw workouts, and stays inside the cap', () => {
    const text = buildNarrativeContext(report());
    expect(text.length).toBeLessThanOrEqual(2000);
    expect(text).toContain('Analysis window: 12 weeks');
    expect(text).toContain('sessions/week');
    expect(text).toContain('Estimated 1RM');
    expect(text).toContain('Bench Press');
    // No set-by-set logs and no ids leaking through.
    expect(text).not.toContain('exerciseId');
    expect(text).not.toContain('"sets"');
  });
});

describe('fetchNarrative', () => {
  it('asks Zen once and caches the answer for the day', async () => {
    const { ask, calls } = stubZen();
    const first = await fetchNarrative({ report: report(), idToken: 't', now: NOW, ask });

    expect(first.cached).toBe(false);
    expect(first.text).toBe('You are training well.');
    expect(ask).toHaveBeenCalledTimes(1);
    expect(calls[0].messages).toHaveLength(1);
    expect(calls[0].context).toContain('Analysis window');

    const second = await fetchNarrative({ report: report(), idToken: 't', now: NOW, ask });
    expect(second.cached).toBe(true);
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it('bypasses the cache when the user refreshes', async () => {
    const { ask } = stubZen();
    await fetchNarrative({ report: report(), idToken: 't', now: NOW, ask });
    const refreshed = await fetchNarrative({ report: report(), idToken: 't', now: NOW, ask, force: true });

    expect(refreshed.cached).toBe(false);
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it('asks again the next day', async () => {
    const { ask } = stubZen();
    await fetchNarrative({ report: report(), idToken: 't', now: NOW, ask });
    await fetchNarrative({ report: report(), idToken: 't', now: new Date(NOW.getTime() + DAY), ask });
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it('answers the data protocol without a second round', async () => {
    const { calls } = stubZen();
    const ask = vi.fn(async (opts: AskZenOptions): Promise<AskZenResult> => {
      calls.push(opts);
      expect(await opts.resolveData({ kind: 'workouts_range' })).toBe('');
      return { text: 'ok' };
    });
    await fetchNarrative({ report: report(), idToken: 't', now: NOW, ask });
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it('lets a Zen error through and caches nothing', async () => {
    const ask = vi.fn(async () => { throw new ZenError('rate-limit', 'Too many for today.'); });
    await expect(fetchNarrative({ report: report(), idToken: 't', now: NOW, ask })).rejects.toBeInstanceOf(ZenError);
    expect(readNarrativeCache('12w', NOW)).toBeNull();
  });
});
