import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, Ruler, TrendingUp } from 'lucide-react';
import * as storage from '../../storage';
import { buildCoachReport } from '../../coachService';
import { ZenCard } from '../zen';
import { NutritionRing } from '../nutrition';
import { PhaseCard } from '../phase';
import { ActivityCard } from '../activity';
import { EnergyCard } from '../energy';
import { Button, Card, IconButton, StatTile, ListRow, SectionHeader } from '../../ui';
import { addDaysISO, localDateISO } from '../../health';

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
  // The whole tab reads one day, so yesterday's food, energy and steps are a
  // tap away instead of only reachable inside the diary.
  const today = localDateISO();
  const [date, setDate] = useState(today);
  const isToday = date === today;
  const topInsight = useMemo(() => buildCoachReport().insights[0] ?? null, []);
  const latestWeight = useMemo(() => storage.getLatestBodyWeight(), []);
  const weightChange = useMemo(() => storage.getBodyWeightChange(30), []);
  const latestMeasurement = useMemo(() => {
    const all = storage.getBodyMeasurements();
    return all.length ? all[all.length - 1] : null;
  }, []);

  return (
    <div className="space-y-4 animate-fadeIn">
      <div className="flex items-center justify-between">
        <IconButton icon={ChevronLeft} label="Previous day" size="sm" onClick={() => setDate((d) => addDaysISO(d, -1))} />
        <button
          onClick={() => setDate(today)}
          className="text-[15px] font-semibold text-text px-3 min-h-9"
          title={isToday ? undefined : 'Back to today'}
        >
          {dayLabel(date, today)}
        </button>
        <IconButton
          icon={ChevronRight} label="Next day" size="sm"
          disabled={isToday}
          className={isToday ? 'opacity-40 pointer-events-none' : ''}
          onClick={() => setDate((d) => addDaysISO(d, 1))}
        />
      </div>

      <Card>
        <SectionHeader caption={isToday ? 'Today' : dayLabel(date, today)} />
        <div className="mt-2 flex justify-center"><NutritionRing size={132} date={date} onClick={onOpenNutrition} /></div>
        <Button variant="primary" size="md" icon={Plus} full className="mt-3" onClick={onOpenNutrition}>
          Log food
        </Button>
      </Card>

      <ZenCard onAskZen={onOpenZen} />

      <EnergyCard onOpen={onOpenEnergy} date={isToday ? undefined : date} />

      <ActivityCard onOpen={onOpenActivity} date={isToday ? undefined : date} />

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

/** "Today" / "Yesterday" / "Mon, 8 Sept". */
function dayLabel(date: string, today: string): string {
  if (date === today) return 'Today';
  if (date === addDaysISO(today, -1)) return 'Yesterday';
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}
