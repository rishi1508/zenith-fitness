import { useMemo } from 'react';
import { Ruler, Scale, Sparkles, TrendingUp } from 'lucide-react';
import * as storage from '../../storage';
import { buildCoachReport } from '../../coachService';
import { Card, StatTile, ListRow, Pill, CAPTION, SUB } from '../../ui';

interface HealthTabViewProps {
  onOpenZen: () => void;
  onOpenBodyWeight: () => void;
  onOpenBodyMeasurements: () => void;
  onOpenInsights: () => void;
}

/** Health tab root (docs/REVAMP_SPEC.md §3). The Zen card and Insights
 *  row point at the existing coach/coach-chat screens until R3b wires
 *  the real Zen system in — see the TODOs below. */
export function HealthTabView({ onOpenZen, onOpenBodyWeight, onOpenBodyMeasurements, onOpenInsights }: HealthTabViewProps) {
  // The daily note reuses the same deterministic insight data the real
  // Zen dailyNote.ts (R3a) will read from — just without an LLM call.
  const topInsight = useMemo(() => buildCoachReport().insights[0] ?? null, []);
  const latestWeight = useMemo(() => storage.getLatestBodyWeight(), []);
  const weightChange = useMemo(() => storage.getBodyWeightChange(30), []);
  const latestMeasurement = useMemo(() => {
    const all = storage.getBodyMeasurements();
    return all.length ? all[all.length - 1] : null;
  }, []);

  return (
    <div className="space-y-4 animate-fadeIn">
      {/* TODO(R3b): replace with ZenCard + real Zen daily note / chat. */}
      <Card onClick={onOpenZen} className="text-left">
        <div className="flex items-center justify-between mb-1">
          <span className={CAPTION}>Zen</span>
          <Pill tone="accent" icon={Sparkles}>Premium</Pill>
        </div>
        <p className="text-sm text-text mb-2">
          {topInsight ? topInsight.body : 'Log a few more workouts and Zen will start noticing patterns.'}
        </p>
        <span className="text-[13px] font-bold text-accent">Ask Zen</span>
      </Card>

      <div className="grid grid-cols-2 gap-2">
        <StatTile
          eyebrow="Weight"
          value={latestWeight ? latestWeight.weight : '—'}
          unit={latestWeight ? 'kg' : undefined}
          sub={weightChange ? `${weightChange.change > 0 ? '+' : ''}${weightChange.change.toFixed(1)}kg · 30d` : 'No entries yet'}
          onClick={onOpenBodyWeight}
        />
        <ListRow
          icon={Ruler}
          iconTone="accent"
          title="Measurements"
          subtitle={latestMeasurement ? `Updated ${new Date(latestMeasurement.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : 'No entries yet'}
          onClick={onOpenBodyMeasurements}
        />
      </div>

      {/* TODO(R3b): restyle as the real InsightsView list. */}
      <ListRow
        icon={TrendingUp}
        iconTone="accent"
        title="Insights"
        subtitle={topInsight ? topInsight.title : 'Muscle balance, plateaus and deload timing'}
        onClick={onOpenInsights}
      />

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
