import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useGym } from '../gym/GymContext';
import { getUserProfile } from '../buddyService';
import { isAdmin } from '../admin';
import type { UserProfile } from '../types';
import { PAYWALL_ENFORCED } from './config';
import { canUse } from './features';
import { resolveTier } from './tier';
import { PremiumCtx } from './premiumContextValue';
import type { PremiumValue } from './premiumContextValue';

/**
 * One tier resolution per signed-in user, shared by every gate and badge.
 * Before this each `usePremium()` call did its own profile read, which was
 * fine for one badge and wrong for a dozen gates. The gym half is live
 * (GymContext already listens); the profile half is one read per uid.
 */
export function PremiumProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading, isGuest } = useAuth();
  const { gym, loading: gymLoading } = useGym();
  const [profile, setProfile] = useState<{ uid: string; data: UserProfile | null } | null>(null);

  useEffect(() => {
    if (!user) { return; }
    let cancelled = false;
    getUserProfile(user.uid)
      .then((p) => { if (!cancelled) setProfile({ uid: user.uid, data: p }); })
      .catch(() => { if (!cancelled) setProfile({ uid: user.uid, data: null }); });
    return () => { cancelled = true; };
  }, [user]);

  const value = useMemo<PremiumValue>(() => {
    const gymActive = gym?.subscriptionStatus === 'active' || gym?.subscriptionStatus === 'pilot';
    const profileForUser = user && profile?.uid === user.uid ? profile.data : null;
    const { tier, source } = resolveTier({ profile: profileForUser, gymActive, adminGrant: isAdmin(user?.uid) });
    // Guests and signed-out visitors are free and known to be so at once.
    const ready = !authLoading && (!user || isGuest || ((profile?.uid === user.uid) && !gymLoading));
    return {
      tier, source,
      isPremium: tier !== 'free',
      can: (feature) => canUse(tier, feature, PAYWALL_ENFORCED),
      enforced: PAYWALL_ENFORCED,
      ready,
    };
  }, [user, isGuest, authLoading, gym, gymLoading, profile]);

  return <PremiumCtx.Provider value={value}>{children}</PremiumCtx.Provider>;
}
