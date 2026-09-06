import { useState } from 'react';
import type { ReactNode } from 'react';
import { Lock } from 'lucide-react';
import { EmptyState } from '../ui';
import { usePremium } from './usePremium';
import { UpgradeSheet } from './UpgradeSheet';
import type { FeatureKey } from './features';

interface PremiumGateProps {
  feature: FeatureKey;
  children: ReactNode;
}

/**
 * Wraps a feature's screen: renders `children` normally unless the
 * paywall is enforced and the user can't access `feature`, in which
 * case it shows a locked card + the upgrade sheet (docs/REVAMP_SPEC.md
 * §5). A no-op today since `PAYWALL_ENFORCED` is false.
 */
export function PremiumGate({ feature, children }: PremiumGateProps) {
  const { can } = usePremium();
  const [showUpgrade, setShowUpgrade] = useState(false);

  if (can(feature)) return <>{children}</>;

  return (
    <>
      <EmptyState
        icon={Lock}
        title="Premium feature"
        body="Upgrade to Zenith Premium to unlock this."
        action={{ label: 'See Premium', onClick: () => setShowUpgrade(true) }}
      />
      <UpgradeSheet open={showUpgrade} onClose={() => setShowUpgrade(false)} />
    </>
  );
}
