import { useState } from 'react';
import type { ReactNode } from 'react';
import { Lock } from 'lucide-react';
import { Button, Card, Skeleton, CAPTION, H2, SUB } from '../ui';
import { usePremium } from './usePremium';
import { UpgradeSheet } from './UpgradeSheet';
import { FEATURE_COPY } from './features';
import type { FeatureKey } from './features';

interface PremiumGateProps {
  feature: FeatureKey;
  children: ReactNode;
  /** Lets the locked card offer "I have a gym code". */
  onJoinGym?: () => void;
  /** Back out of a screen that turned out to be locked. */
  onBack?: () => void;
}

/**
 * Wraps a premium screen. Renders `children` for anyone who can use the
 * feature; otherwise a locked card that says, in one line, what the feature
 * is and how Premium is obtained. While the tier is still resolving it shows
 * a placeholder — a lock that flashes and vanishes for a gym member is worse
 * than a moment of grey.
 */
export function PremiumGate({ feature, children, onJoinGym, onBack }: PremiumGateProps) {
  const { can, ready } = usePremium();
  const [showUpgrade, setShowUpgrade] = useState(false);

  if (can(feature)) return <>{children}</>;
  if (!ready) return <div className="space-y-3 pt-2"><Skeleton className="h-10 w-2/3" /><Skeleton className="h-[220px]" /></div>;

  const copy = FEATURE_COPY[feature];
  return (
    <div className="pt-2">
      <Card className="text-center py-8">
        <span className="mx-auto w-12 h-12 rounded-full bg-accent-soft text-accent flex items-center justify-center">
          <Lock className="w-5 h-5" strokeWidth={1.75} />
        </span>
        <div className={`${CAPTION} mt-4`}>Premium</div>
        <h2 className={`${H2} mt-1`}>{copy.title}</h2>
        <p className={`${SUB} mt-2 max-w-xs mx-auto`}>{copy.body}</p>
        <div className="mt-5 flex flex-col gap-2 max-w-xs mx-auto">
          <Button variant="primary" size="lg" full onClick={() => setShowUpgrade(true)}>See what Premium includes</Button>
          {onBack && <Button variant="secondary" size="md" full onClick={onBack}>Back</Button>}
        </div>
      </Card>
      <UpgradeSheet open={showUpgrade} onClose={() => setShowUpgrade(false)} feature={feature} onJoinGym={onJoinGym} />
    </div>
  );
}
