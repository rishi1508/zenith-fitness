export type FeatureKey = 'zen' | 'analysis' | 'food-scan' | 'advanced-analytics' | 'unlimited-buddies' | 'export';

/**
 * Which tier unlocks each feature (docs/REVAMP_SPEC.md §5, ROADMAP.md
 * §5.2). Consulted only when `PAYWALL_ENFORCED` is true.
 */
export const FEATURES: Record<FeatureKey, 'free' | 'premium'> = {
  zen: 'premium',
  analysis: 'premium',
  'food-scan': 'premium',
  'advanced-analytics': 'premium',
  'unlimited-buddies': 'premium',
  export: 'premium',
};
