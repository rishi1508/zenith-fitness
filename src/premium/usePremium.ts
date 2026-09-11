import { useContext } from 'react';
import { PremiumCtx } from './premiumContextValue';
import type { PremiumValue } from './premiumContextValue';
import { PAYWALL_ENFORCED } from './config';

export type UsePremiumResult = PremiumValue;

/**
 * The signed-in user's tier and what it unlocks (docs/REVAMP_SPEC.md §5).
 * Reads the shared PremiumProvider; outside one (tests, isolated renders)
 * it reports a free, not-yet-ready user rather than throwing.
 */
export function usePremium(): UsePremiumResult {
  const ctx = useContext(PremiumCtx);
  if (ctx) return ctx;
  return {
    tier: 'free', source: 'free', isPremium: false,
    can: (feature) => !PAYWALL_ENFORCED || feature === 'export',
    enforced: PAYWALL_ENFORCED, ready: false,
  };
}
