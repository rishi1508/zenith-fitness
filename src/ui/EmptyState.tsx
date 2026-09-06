import type { LucideIcon } from 'lucide-react';
import { Button } from './Button';
import { Card } from './Card';
import { H2 } from './styles';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  body?: string;
  action?: { label: string; onClick: () => void };
}

/** Centred "nothing here yet" card with an optional single action. */
export function EmptyState({ icon: Icon, title, body, action }: EmptyStateProps) {
  return (
    <Card className="flex flex-col items-center text-center gap-3 py-6">
      <span className="w-11 h-11 rounded-control bg-accent-soft text-accent flex items-center justify-center">
        <Icon className="w-[22px] h-[22px]" strokeWidth={1.75} />
      </span>
      <div className="flex flex-col gap-1">
        <h2 className={H2}>{title}</h2>
        {body && <p className="text-sm text-muted max-w-xs">{body}</p>}
      </div>
      {action && (
        <Button variant="secondary" size="md" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </Card>
  );
}
