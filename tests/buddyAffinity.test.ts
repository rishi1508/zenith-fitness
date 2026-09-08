import { describe, it, expect, beforeEach, vi } from 'vitest';
import { affinityScore, rankByAffinity, recordBuddyInteraction } from '../src/buddyAffinity';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
  });
});

const DAY = 86_400_000;
const T0 = Date.parse('2026-09-01T10:00:00Z');

describe('buddy affinity', () => {
  it('starts everyone at zero and keeps the given order', () => {
    expect(affinityScore('a', T0)).toBe(0);
    expect(rankByAffinity(['a', 'b', 'c'], T0)).toEqual(['a', 'b', 'c']);
  });

  it('weights training together above chatting above a profile visit', () => {
    recordBuddyInteraction('trainer', 'session', T0);
    recordBuddyInteraction('chatter', 'message', T0);
    recordBuddyInteraction('lurker', 'profile', T0);
    expect(rankByAffinity(['lurker', 'chatter', 'trainer'], T0)).toEqual(['trainer', 'chatter', 'lurker']);
  });

  it('accumulates repeated contact', () => {
    recordBuddyInteraction('a', 'message', T0);
    recordBuddyInteraction('a', 'message', T0);
    recordBuddyInteraction('b', 'session', T0);
    expect(affinityScore('a', T0)).toBeCloseTo(6, 1);
    expect(rankByAffinity(['a', 'b'], T0)).toEqual(['a', 'b']); // tie → original order
  });

  it('decays with a 30-day half-life', () => {
    recordBuddyInteraction('a', 'session', T0);
    expect(affinityScore('a', T0)).toBeCloseTo(6, 2);
    expect(affinityScore('a', T0 + 30 * DAY)).toBeCloseTo(3, 2);
    expect(affinityScore('a', T0 + 60 * DAY)).toBeCloseTo(1.5, 2);
  });

  it('lets a recent buddy overtake an older, once-closer one', () => {
    recordBuddyInteraction('old', 'session', T0);
    recordBuddyInteraction('old', 'session', T0);
    const later = T0 + 90 * DAY;
    recordBuddyInteraction('new', 'message', later);
    expect(rankByAffinity(['old', 'new'], later)).toEqual(['new', 'old']);
  });

  it('ignores a missing uid', () => {
    expect(() => recordBuddyInteraction(undefined, 'message', T0)).not.toThrow();
    expect(() => recordBuddyInteraction('', 'message', T0)).not.toThrow();
  });
});
