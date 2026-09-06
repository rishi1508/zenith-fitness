import { useState } from 'react';
import { Calculator, CalendarDays, Clock, Dumbbell, Layers, Pencil, Trophy, Wrench } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { WorkoutTemplate } from '../../types';
import type { Theme } from '../../App';
import * as storage from '../../storage';
import { PlateCalculator, OneRMCalculator } from '../../components';
import { Card, Button, Chip, IconButton, ListRow, Sheet, SectionHeader, StatTile, EmptyState, CAPTION } from '../../ui';

interface TrainTabViewProps {
  theme: Theme;
  onStartWorkout: (template: WorkoutTemplate) => void;
  onOpenWeeklyPlans: () => void;
  onOpenExercises: () => void;
  onOpenCommonTemplates: () => void;
  onOpenHistory: () => void;
  onOpenProgress: () => void;
}

/** Train tab root (docs/REVAMP_SPEC.md §3): active plan card with day
 *  chips, quick rows to the plan/library/history screens, recent PRs,
 *  and a Tools sheet for the plate/1RM calculators. */
export function TrainTabView({
  theme, onStartWorkout, onOpenWeeklyPlans, onOpenExercises, onOpenCommonTemplates, onOpenHistory, onOpenProgress,
}: TrainTabViewProps) {
  const isDark = theme === 'dark';
  const [plans] = useState(() => storage.getWeeklyPlans());
  const [activePlanId] = useState(() => storage.getActivePlanId() || plans[0]?.id);
  const [selectedDayNum, setSelectedDayNum] = useState(() => storage.getLastUsedDay() || 1);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [activeCalc, setActiveCalc] = useState<'plate' | '1rm' | null>(null);

  const activePlan = plans.find((p) => p.id === activePlanId);
  const workoutDays = activePlan?.days.filter((d) => !d.isRestDay) ?? [];
  const selectedDay = activePlan?.days.find((d) => d.dayNumber === selectedDayNum) ?? workoutDays[0];

  const selectDay = (dayNumber: number) => {
    setSelectedDayNum(dayNumber);
    storage.setLastUsedDay(dayNumber);
  };

  const startSelectedDay = () => {
    if (!activePlan || !selectedDay || selectedDay.isRestDay) return;
    onStartWorkout({
      id: `${activePlan.id}_day_${selectedDay.dayNumber}`,
      name: `${activePlan.name} - ${selectedDay.name}`,
      type: 'custom',
      exercises: selectedDay.exercises,
      weeklyPlanId: activePlan.id,
    });
  };

  const recentPRs = [...storage.getPersonalRecords()]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 2);

  const rows: Array<{ label: string; sub: string; icon: LucideIcon; onClick: () => void }> = [
    { label: 'Weekly plans', sub: `${plans.length} plan${plans.length === 1 ? '' : 's'}`, icon: CalendarDays, onClick: onOpenWeeklyPlans },
    { label: 'Exercise library', sub: 'Browse and edit all exercises', icon: Dumbbell, onClick: onOpenExercises },
    { label: 'Community templates', sub: 'Import a shared plan', icon: Layers, onClick: onOpenCommonTemplates },
    { label: 'Workout history', sub: 'Every logged session', icon: Clock, onClick: onOpenHistory },
  ];

  return (
    <div className="space-y-4 animate-fadeIn">
      {activePlan ? (
        <Card>
          <div className="flex items-center justify-between mb-1">
            <span className={CAPTION}>Active plan</span>
            <Chip>{workoutDays.length} days / week</Chip>
          </div>
          <h2 className="font-display text-lg font-bold mb-3">{activePlan.name}</h2>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {workoutDays.map((d) => (
              <Chip key={d.dayNumber} on={d.dayNumber === selectedDayNum} onClick={() => selectDay(d.dayNumber)}>
                Day {d.dayNumber} · {d.name}
              </Chip>
            ))}
          </div>
          <div className="flex gap-2">
            <Button variant="primary" size="lg" full onClick={startSelectedDay} disabled={!selectedDay}>
              Start Day {selectedDay?.dayNumber ?? ''}
            </Button>
            <IconButton icon={Pencil} label="Edit plan" onClick={onOpenWeeklyPlans} className="shrink-0 h-[52px] w-[52px]" />
          </div>
        </Card>
      ) : (
        <EmptyState icon={CalendarDays} title="No weekly plans yet" body="Create one to get day-by-day workouts here." action={{ label: 'Create a plan', onClick: onOpenWeeklyPlans }} />
      )}

      <Card padding="list">
        {rows.map((r) => (
          <ListRow key={r.label} icon={r.icon} title={r.label} subtitle={r.sub} onClick={r.onClick} />
        ))}
      </Card>

      <ListRow icon={Wrench} iconTone="accent" title="Tools" subtitle="Plate and 1RM calculators" trailing="chevron" onClick={() => setToolsOpen(true)} />

      {recentPRs.length > 0 && (
        <div className="space-y-2">
          <SectionHeader caption="Recent PRs" trailing={{ label: 'All records', onClick: onOpenProgress }} />
          <div className="grid grid-cols-2 gap-2">
            {recentPRs.map((pr) => (
              <StatTile
                key={pr.exerciseId}
                eyebrow={pr.exerciseName}
                value={pr.weight}
                unit={`kg × ${pr.reps}`}
                sub={new Date(pr.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
              />
            ))}
          </div>
        </div>
      )}

      <Sheet open={toolsOpen} onClose={() => setToolsOpen(false)} title="Tools">
        <div className="flex flex-col gap-2 pb-1">
          <Button variant="secondary" size="lg" icon={Calculator} onClick={() => { setToolsOpen(false); setActiveCalc('plate'); }}>
            Plate calculator
          </Button>
          <Button variant="secondary" size="lg" icon={Trophy} onClick={() => { setToolsOpen(false); setActiveCalc('1rm'); }}>
            1RM calculator
          </Button>
        </div>
      </Sheet>

      {activeCalc === 'plate' && <PlateCalculator isDark={isDark} onClose={() => setActiveCalc(null)} />}
      {activeCalc === '1rm' && <OneRMCalculator isDark={isDark} onClose={() => setActiveCalc(null)} />}
    </div>
  );
}
