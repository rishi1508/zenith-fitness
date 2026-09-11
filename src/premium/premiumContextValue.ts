import { createContext } from 'react';
import type { FeatureKey } from './features';
import type { Tier, TierSource } from './tier';

export interface PremiumValue {
  tier: Tier;
  source: TierSource;
  /** True for any tier above 'free' (premium, gym-sponsored or admin). */
  isPremium: boolean;
  can: (feature: FeatureKey) => boolean;
  enforced: boolean;
  /** False until the profile and gym have both answered — gates show a
   *  placeholder rather than a lock that might be wrong. */
  ready: boolean;
}

/** Filled by PremiumProvider; read through usePremium(). */
export const PremiumCtx = createContext<PremiumValue | null>(null);
