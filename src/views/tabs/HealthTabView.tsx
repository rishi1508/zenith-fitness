import { useMemo } from 'react';
import { Plus, Ruler, TrendingUp } from 'lucide-react';
import * as storage from '../../storage';
import { buildCoachReport } from '../../coachService';
import { ZenCard } from '../zen';
import { NutritionRing } from '../nutrition';
import { PhaseCard } from '../phase';
import { ActivityCard } from '../activity';
import { EnergyCard } from '../energy';
import { Button, Card, StatTile, ListRow, SectionHeader } from '../../ui';

interface HealthTabViewProps {
  onOpenZen: (prompt?: string) => void;
  onOpenBodyWeight: () => void;
  onOpenBodyMeasurements: () => void;
  onOpenInsights: () => void;
  onOpenNutrition: () => void;
  onOpenPhase: () => void;
  onOpenActivity: () => void;
  onOpenEnergy: () => void;
}

/** Health tab root (docs/REVAMP_SPEC.md §3, §6). */
export function HealthTabView({ onOpenZen, onOpenBodyWeight, onOpenBodyMeasurements, onOpenInsights, onOpenNutrition, onOpenPhase, onOpenActivity, onOpenEnergy }: HealthTabViewProps) {
  const topInsight = useMemo(() => buildCoachReport().insights[0] ?? null, []);
  const latestWeight = useMemo(() => storage.getLatestBodyWeight(), []);
  const weightChange = useMemo(() => storage.getBodyWeightChange(30), []);
  const latestMeasurement = useMemo(() => {
    const all = storage.getBodyMeasurements();
    return all.length ? all[all.length - 1] : null;
  }, []);

  return (
    <div className="space-y-4 animate-fadeIn">
      <Card>
        <SectionHeader caption="Today" />
        <div className="mt-2 flex justify-center"><NutritionRing size={132} onClick={onOpenNutrition} /></div>
        <Button variant="primary" size="md" icon={Plus} full className="mt-3" onClick={onOpenNutrition}>
          Log food
        </Button>
      </Card>

      <ZenCard onAskZen={onOpenZen} />

      <EnergyCard onOpen={onOpenEnergy} />

      <ActivityCard onOpen={onOpenActivity} />

      <StatTile
        eyebrow="Weight"
        value={latestWeight ? latestWeight.weight : '—'}
        unit={latestWeight ? 'kg' : undefined}
        sub={weightChange ? `${weightChange.change > 0 ? '+' : ''}${weightChange.change.toFixed(1)}kg · 30d` : 'No entries yet'}
        onClick={onOpenBodyWeight}
      />

      <PhaseCard onOpen={onOpenPhase} />

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

    </div>
  );
}
