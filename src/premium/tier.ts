import type { UserProfile } from '../types';

export type Tier = 'free' | 'premium' | 'gym' | 'admin';
export type TierSource = 'admin' | 'premium' | 'gym' | 'free';

export interface ResolveTierInput {
  profile: UserProfile | null | undefined;
  /** The signed-in user's linked gym has an active (or pilot) subscription. */
  gymActive: boolean;
  /** The signed-in user is a Zenith admin (`src/admin.ts` `isAdmin`) —
   *  outranks everything else. */
  adminGrant: boolean;
}

export interface ResolvedTier {
  tier: Tier;
  source: TierSource;
}

/**
 * Precedence: admin > premium (paid) > gym > free (docs/REVAMP_SPEC.md
 * §5). No billing yet — "paid" just means
 * `profile.subscriptionTier === 'premium'`, which is set either directly
 * or by an admin's Grant/Revoke premium action (api/admin.ts).
 */
export function resolveTier({ profile, gymActive, adminGrant }: ResolveTierInput): ResolvedTier {
  if (adminGrant) return { tier: 'admin', source: 'admin' };
  if (profile?.subscriptionTier === 'premium') return { tier: 'premium', source: 'premium' };
  if (gymActive) return { tier: 'gym', source: 'gym' };
  return { tier: 'free', source: 'free' };
}
