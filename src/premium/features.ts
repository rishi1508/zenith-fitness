export type FeatureKey = 'zen' | 'analysis' | 'food-scan' | 'advanced-analytics' | 'unlimited-buddies' | 'export';

/**
 * Which tier unlocks each feature. The free app is a complete tracker:
 * logging, plans, history, progress, the nutrition diary, body weight,
 * streaks, badges, your gym's feed and check-in, and three buddies. Premium
 * is the coaching layer on top — the parts that read your data and tell you
 * something. Export stays free on principle: your data is yours to take.
 */
export const FEATURES: Record<FeatureKey, 'free' | 'premium'> = {
  zen: 'premium',
  analysis: 'premium',
  'food-scan': 'premium',
  'advanced-analytics': 'premium',
  'unlimited-buddies': 'premium',
  export: 'free',
};

/** Buddies a free account can have before Premium is asked for. */
export const FREE_BUDDY_LIMIT = 3;

/** Pure rule behind `usePremium().can()`, kept separate so it can be tested. */
export function canUse(tier: 'free' | 'premium' | 'gym' | 'admin', feature: FeatureKey, enforced: boolean): boolean {
  if (!enforced) return true;
  if (FEATURES[feature] === 'free') return true;
  return tier !== 'free';
}

/** What each locked feature says for itself — no jargon, one line each. */
export const FEATURE_COPY: Record<FeatureKey, { title: string; body: string }> = {
  zen: { title: 'Zen, your coach', body: 'Zen reads your training, food and sleep and answers in plain words.' },
  analysis: { title: 'Insights and analysis', body: 'Muscle balance, plateaus, deload timing and per-exercise trends.' },
  'food-scan': { title: 'Plate scan', body: 'Point the camera at a plate and get the items and macros in seconds.' },
  'advanced-analytics': { title: 'Weight, phase and energy', body: 'Adaptive targets from your weight trend and a daily energy model.' },
  'unlimited-buddies': { title: 'More buddies', body: `Free accounts train with up to ${FREE_BUDDY_LIMIT} buddies. Premium removes the limit.` },
  export: { title: 'Export', body: 'Take your data with you.' },
};
