import { useEffect, useState } from 'react';
import { ArrowLeft, CalendarDays, Check, ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
import type { GymViewProps } from './types';
import type { GymWorkoutPlan } from '../../types';
import { useGym } from '../../gym/GymContext';
import { useAuth } from '../../auth/AuthContext';
import { isAdmin } from '../../admin';
import { adoptedCopy, adoptGymPlan, deleteGymPlan, listenToGymPlans } from '../../gymLibrary';
import { Button, Card, EmptyState, IconButton, useConfirm, useToast, H1, SUB, CAPTION } from '../../ui';

/**
 * The plans the gym publishes for its members — the notice-board
 * programmes, in the app. A member adopts one with a tap and it becomes
 * their active weekly plan; adopting again after the trainer edits it
 * refreshes their copy. Staff publish from Train → Weekly plans → Share
 * with gym, and remove from here.
 */
export function GymPlansView({ onBack }: GymViewProps) {
  const { gym, role } = useGym();
  const { user } = useAuth();
  const { showToast } = useToast();
  const { confirm } = useConfirm();
  const isStaff = role === 'trainer' || role === 'manager' || role === 'owner' || isAdmin(user?.uid);

  const [plans, setPlans] = useState<GymWorkoutPlan[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!gym?.id) return;
    return listenToGymPlans(gym.id, setPlans);
  }, [gym?.id]);

  if (!gym) return null;

  const use = (plan: GymWorkoutPlan) => {
    const had = adoptedCopy(plan.id);
    adoptGymPlan(gym.id, plan, gym.name);
    setTick((n) => n + 1);
    showToast(had ? `${plan.name} refreshed and set as your active plan.` : `${plan.name} is now your active plan.`);
  };

  const remove = async (plan: GymWorkoutPlan) => {
    const ok = await confirm({ title: `Remove ${plan.name}?`, message: 'Members who already adopted it keep their copy.', confirmLabel: 'Remove', tone: 'danger' });
    if (!ok) return;
    try { await deleteGymPlan(gym.id, plan.id); showToast('Removed.'); }
    catch (err) { showToast(err instanceof Error ? err.message : 'Could not remove.', 'error'); }
  };

  return (
    <div className="space-y-4 animate-fadeIn" data-tick={tick}>
      <div className="flex items-center gap-2">
        <button aria-label="Back" onClick={onBack} className="w-10 h-10 -ml-2 shrink-0 flex items-center justify-center rounded-control text-muted hover:text-text transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className={H1}>Workout plans</h1>
          <p className={`${CAPTION} mt-0.5`}>{gym.name}</p>
        </div>
      </div>

      {isStaff && (
        <Card>
          <p className={SUB}>To publish a plan: Train → Weekly plans → <span className="text-text font-medium">Share with gym</span> on any plan you made. Publishing the same plan again updates it for everyone.</p>
        </Card>
      )}

      {plans === null ? (
        <Card><p className={SUB}>Loading…</p></Card>
      ) : plans.length === 0 ? (
        <EmptyState icon={CalendarDays} title="No plans yet" body={isStaff ? 'Share one of your weekly plans and members can start it with a tap.' : `${gym.name} has not published a plan yet.`} />
      ) : (
        <div className="space-y-3">
          {plans.map((plan) => {
            const workoutDays = plan.days.filter((d) => !d.isRestDay);
            const mine = adoptedCopy(plan.id);
            const expanded = open === plan.id;
            return (
              <Card key={plan.id} padding="none" className="overflow-hidden">
                <div className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="text-base font-semibold text-text truncate">{plan.name}</h2>
                      <p className={`${SUB} mt-0.5`}>
                        {workoutDays.length} training day{workoutDays.length === 1 ? '' : 's'} · by {plan.createdByName}
                        {plan.useCount > 0 ? ` · ${plan.useCount} using it` : ''}
                      </p>
                      {plan.description && <p className="text-sm text-muted mt-2">{plan.description}</p>}
                    </div>
                    {isStaff && <IconButton icon={Trash2} label={`Remove ${plan.name}`} size="sm" onClick={() => { void remove(plan); }} />}
                  </div>
                  <div className="flex items-center gap-2 mt-3">
                    <Button variant={mine ? 'secondary' : 'primary'} size="md" icon={mine ? Check : undefined} onClick={() => use(plan)} className="flex-1">
                      {mine ? 'Added · refresh my copy' : 'Use this plan'}
                    </Button>
                    <IconButton icon={expanded ? ChevronUp : ChevronDown} label={expanded ? 'Hide days' : 'Show days'} onClick={() => setOpen(expanded ? null : plan.id)} />
                  </div>
                </div>
                {expanded && (
                  <div className="border-t border-border divide-y divide-border">
                    {plan.days.map((d) => (
                      <div key={d.dayNumber} className="px-4 py-2.5">
                        <div className="text-sm font-medium text-text">{d.name}</div>
                        <div className={SUB}>
                          {d.isRestDay ? 'Rest' : d.exercises.map((e) => `${e.exerciseName} ${e.defaultSets}×${e.defaultReps}`).join(' · ')}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
