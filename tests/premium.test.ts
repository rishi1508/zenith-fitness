import { describe, it, expect } from 'vitest';
import { resolveTier } from '../src/premium/tier';
import { canUse, FEATURES, FREE_BUDDY_LIMIT } from '../src/premium/features';
import { PAYWALL_ENFORCED } from '../src/premium/config';
import type { UserProfile } from '../src/types';

const profile = (over: Partial<UserProfile> = {}): UserProfile => ({ uid: 'u', displayName: 'U', ...over } as UserProfile);

describe('resolveTier', () => {
  it('ranks admin over paid over gym over free', () => {
    expect(resolveTier({ profile: profile({ subscriptionTier: 'premium' }), gymActive: true, adminGrant: true }).tier).toBe('admin');
    expect(resolveTier({ profile: profile({ subscriptionTier: 'premium' }), gymActive: true, adminGrant: false }).tier).toBe('premium');
    expect(resolveTier({ profile: profile(), gymActive: true, adminGrant: false }).tier).toBe('gym');
    expect(resolveTier({ profile: profile(), gymActive: false, adminGrant: false }).tier).toBe('free');
    expect(resolveTier({ profile: null, gymActive: false, adminGrant: false })).toEqual({ tier: 'free', source: 'free' });
  });
});

describe('canUse', () => {
  it('is enforced in this build', () => {
    expect(PAYWALL_ENFORCED).toBe(true);
  });

  it('keeps the tracker free and gates the coaching layer', () => {
    for (const feature of ['zen', 'analysis', 'food-scan', 'advanced-analytics', 'unlimited-buddies'] as const) {
      expect(FEATURES[feature]).toBe('premium');
      expect(canUse('free', feature, true)).toBe(false);
      expect(canUse('gym', feature, true)).toBe(true);
      expect(canUse('premium', feature, true)).toBe(true);
      expect(canUse('admin', feature, true)).toBe(true);
    }
    // Your data is yours to take, whatever the tier.
    expect(FEATURES.export).toBe('free');
    expect(canUse('free', 'export', true)).toBe(true);
  });

  it('opens everything when enforcement is off', () => {
    expect(canUse('free', 'zen', false)).toBe(true);
  });

  it('gives a free account a few buddies before asking', () => {
    expect(FREE_BUDDY_LIMIT).toBeGreaterThanOrEqual(3);
  });
});
