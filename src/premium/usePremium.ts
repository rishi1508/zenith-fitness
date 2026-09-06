import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useGym } from '../gym/GymContext';
import { getUserProfile } from '../buddyService';
import { isAdmin } from '../admin';
import type { UserProfile } from '../types';
import { PAYWALL_ENFORCED } from './config';
import { FEATURES } from './features';
import type { FeatureKey } from './features';
import { resolveTier } from './tier';
import type { Tier, TierSource } from './tier';

export interface UsePremiumResult {
  tier: Tier;
  source: TierSource;
  /** True for any tier above 'free' (premium, gym-sponsored or admin). */
  isPremium: boolean;
  can: (feature: FeatureKey) => boolean;
  enforced: boolean;
}

/**
 * Resolves the signed-in user's premium tier (docs/REVAMP_SPEC.md §5).
 * Fetches the profile once per uid (a one-shot `getDoc` via
 * `buddyService.getUserProfile`, not a listener — GYM_TIER_A_SPEC.md
 * §0's cost-discipline rule caps live listeners at the gym + membership
 * docs already open in `GymContext`) and reads gym linkage from
 * `useGym()`, which already holds that live subscription.
 */
export function usePremium(): UsePremiumResult {
  const { user } = useAuth();
  const { gym } = useGym();
  const [profile, setProfile] = useState<UserProfile | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user) {
        if (!cancelled) setProfile(null);
        return;
      }
      try {
        const p = await getUserProfile(user.uid);
        if (!cancelled) setProfile(p);
      } catch {
        if (!cancelled) setProfile(null);
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  const gymActive = gym?.subscriptionStatus === 'active' || gym?.subscriptionStatus === 'pilot';
  const { tier, source } = resolveTier({ profile, gymActive, adminGrant: isAdmin(user?.uid) });
  const enforced = PAYWALL_ENFORCED;

  const can = (feature: FeatureKey): boolean => {
    if (!enforced) return true;
    if (FEATURES[feature] === 'free') return true;
    return tier !== 'free';
  };

  return { tier, source, isPremium: tier !== 'free', can, enforced };
}
