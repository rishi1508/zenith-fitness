import { Sparkles } from 'lucide-react';
import { Sheet, Button } from '../ui';

interface UpgradeSheetProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Coming-soon upgrade pitch (docs/REVAMP_SPEC.md §5) — no billing yet,
 * so the only action is closing the sheet.
 */
export function UpgradeSheet({ open, onClose }: UpgradeSheetProps) {
  return (
    <Sheet open={open} onClose={onClose} title="Zenith Premium">
      <div className="flex flex-col gap-3 pb-1">
        <div className="flex items-center gap-2 text-accent">
          <Sparkles className="w-5 h-5" strokeWidth={1.75} />
          <span className="text-sm font-bold">Coming soon</span>
        </div>
        <p className="text-sm text-muted">
          ₹99/mo or ₹599/yr unlocks analysis, the Zen AI coach, camera food scan and advanced
          analytics. Members of a paying gym get Premium free.
        </p>
        <p className="text-sm text-muted">
          Everything you use today stays unlocked in the meantime — this is just a preview of
          what's coming.
        </p>
        <Button variant="primary" size="lg" full onClick={onClose}>Got it</Button>
      </div>
    </Sheet>
  );
}
