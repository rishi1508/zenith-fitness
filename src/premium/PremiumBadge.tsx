import { Sparkles } from 'lucide-react';
import { Pill } from '../ui';

/**
 * Small "Premium" pill with a star — shown next to premium entry points
 * (docs/REVAMP_SPEC.md §5). Purely cosmetic: nothing is gated while
 * `PAYWALL_ENFORCED` is false.
 */
export function PremiumBadge({ className = '' }: { className?: string }) {
  return (
    <Pill tone="accent" icon={Sparkles} className={className}>
      Premium
    </Pill>
  );
}
