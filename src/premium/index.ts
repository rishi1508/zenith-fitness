// Premium scaffolding barrel — docs/REVAMP_SPEC.md §5.
export { PAYWALL_ENFORCED } from './config';
export { resolveTier } from './tier';
export type { Tier, TierSource, ResolveTierInput, ResolvedTier } from './tier';
export { FEATURES } from './features';
export type { FeatureKey } from './features';
export { usePremium } from './usePremium';
export type { UsePremiumResult } from './usePremium';
export { PremiumBadge } from './PremiumBadge';
export { UpgradeSheet } from './UpgradeSheet';
export { PremiumGate } from './PremiumGate';
