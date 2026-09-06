import { useMemo } from 'react';
import { Ruler, Scale, TrendingUp } from 'lucide-react';
import * as storage from '../../storage';
import { buildCoachReport } from '../../coachService';
import { ZenCard } from '../zen';
import { Card, StatTile, ListRow, CAPTION, SUB } from '../../ui';

interface HealthTabViewProps {
  onOpenZen: (prompt?: string) => void;
  onOpenBodyWeight: () => void;
  onOpenBodyMeasurements: () => void;
  onOpenInsights: () => void;
}

/** Health tab root (docs/REVAMP_SPEC.md §3, §6). */
export function HealthTabView({ onOpenZen, onOpenBodyWeight, onOpenBodyMeasurements, onOpenInsights }: HealthTabViewProps) {
  const topInsight = useMemo(() => buildCoachReport().insights[0] ?? null, []);
  const latestWeight = useMemo(() => storage.getLatestBodyWeight(), []);
  const weightChange = useMemo(() => storage.getBodyWeightChange(30), []);
  const latestMeasurement = useMemo(() => {
    const all = storage.getBodyMeasurements();
    return all.length ? all[all.length - 1] : null;
  }, []);

  return (
    <div className="space-y-4 animate-fadeIn">
      <ZenCard onAskZen={onOpenZen} />

      <StatTile
        eyebrow="Weight"
        value={latestWeight ? latestWeight.weight : '—'}
        unit={latestWeight ? 'kg' : undefined}
        sub={weightChange ? `${weightChange.change > 0 ? '+' : ''}${weightChange.change.toFixed(1)}kg · 30d` : 'No entries yet'}
        onClick={onOpenBodyWeight}
      />

      <Card padding="list">
        <ListRow
          icon={Ruler}
          iconTone="accent"
          title="Measurements"
          subtitle={latestMeasurement ? `Updated ${new Date(latestMeasurement.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : 'No entries yet'}
          onClick={onOpenBodyMeasurements}
        />
        <ListRow
          icon={TrendingUp}
          iconTone="accent"
          title="Insights"
          subtitle={topInsight ? topInsight.title : 'Muscle balance, plateaus and deload timing'}
          onClick={onOpenInsights}
        />
      </Card>

      <Card className="opacity-60">
        <div className="flex items-center gap-2 mb-1">
          <Scale className="w-4 h-4 text-subtle" strokeWidth={1.75} />
          <span className={CAPTION}>Coming soon</span>
        </div>
        <p className={SUB}>Nutrition · Activity</p>
      </Card>
    </div>
  );
}
