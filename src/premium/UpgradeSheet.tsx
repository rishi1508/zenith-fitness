import { Camera, LineChart, MessageSquareText, Scale, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Sheet, Button, CAPTION, SUB } from '../ui';
import type { FeatureKey } from './features';

interface UpgradeSheetProps {
  open: boolean;
  onClose: () => void;
  /** Where the user was trying to go — named first in the list. */
  feature?: FeatureKey;
  /** Opens the gym join screen (enter a join code). */
  onJoinGym?: () => void;
}

const INCLUDED: Array<{ key: FeatureKey; icon: LucideIcon; label: string }> = [
  { key: 'zen', icon: MessageSquareText, label: 'Zen, a coach that reads your data' },
  { key: 'food-scan', icon: Camera, label: 'Plate scan for food logging' },
  { key: 'analysis', icon: LineChart, label: 'Insights and per-exercise analysis' },
  { key: 'advanced-analytics', icon: Scale, label: 'Weight, phase and energy engine' },
  { key: 'unlimited-buddies', icon: Users, label: 'Unlimited buddies' },
];

/**
 * What Premium is and how you get it. There is nothing to buy here on
 * purpose: Premium comes with a gym that runs on Zenith, so the one real
 * action is entering the gym's join code. Individual plans are a later
 * decision (docs/DEMO_AND_PRICING.md), and no price is shown until it is.
 */
export function UpgradeSheet({ open, onClose, feature, onJoinGym }: UpgradeSheetProps) {
  const ordered = feature ? [...INCLUDED.filter((i) => i.key === feature), ...INCLUDED.filter((i) => i.key !== feature)] : INCLUDED;
  return (
    <Sheet open={open} onClose={onClose} title="Zenith Premium">
      <div className="flex flex-col gap-4 pb-1">
        <p className="text-[15px] leading-[22px] text-text">
          Everything you log is free and stays yours. Premium is the coaching layer on top.
        </p>

        <ul className="space-y-2">
          {ordered.map(({ key, icon: Icon, label }) => (
            <li key={key} className="flex items-center gap-3">
              <span className="w-8 h-8 rounded-control bg-accent-soft text-accent flex items-center justify-center shrink-0">
                <Icon className="w-4 h-4" strokeWidth={1.75} />
              </span>
              <span className={`text-sm ${key === feature ? 'font-semibold text-text' : 'text-muted'}`}>{label}</span>
            </li>
          ))}
        </ul>

        <div className="rounded-card border border-border bg-surface-2 p-3">
          <div className={`${CAPTION} mb-1`}>Included with your gym</div>
          <p className={SUB}>
            If your gym runs on Zenith, Premium is already part of your membership. The front desk adds you by your mobile number — sign in with the same number's account and it is all here.
          </p>
        </div>

        {onJoinGym ? (
          <Button variant="primary" size="lg" full onClick={() => { onClose(); onJoinGym(); }}>My gym uses Zenith</Button>
        ) : null}
        <p className="text-xs text-subtle text-center">Individual plans are coming. Nothing you use today will be taken away.</p>
        {!onJoinGym && <Button variant="secondary" size="lg" full onClick={onClose}>Got it</Button>}
      </div>
    </Sheet>
  );
}
