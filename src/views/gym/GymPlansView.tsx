import { useEffect, useState } from 'react';
import { ArrowLeft, CalendarDays, Check, ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
import type { GymViewProps } from './types';
import type { Gym, GymWorkoutPlan } from '../../types';
import { useGym } from '../../gym/GymContext';
import { useAuth } from '../../auth/AuthContext';
import { isAdmin } from '../../admin';
import { adoptedCopy, adoptGymPlan, deleteGymPlan, listenToGymPlans } from '../../gymLibrary';
import { Button, Card, EmptyState, IconButton, useConfirm, useToast, H1, SUB, CAPTION } from '../../ui';

/**
 * The plans the gym publishes for its members — the notice-board
 * programmes, in the app. Members get a consumption-first `MemberPlans`:
 * browse, adopt, no clutter. Staff get a management `StaffPlans`: usage,
 * remove, and the reminder for how to publish. Staff can still adopt a
 * plan for their own training, just as a secondary action there.
 */
export function GymPlansView({ onBack }: GymViewProps) {
  const { gym, role } = useGym();
  const { user } = useAuth();
  const isStaff = role === 'trainer' || role === 'manager' || role === 'owner' || isAdmin(user?.uid);

  const [plans, setPlans] = useState<GymWorkoutPlan[] | null>(null);

  useEffect(() => {
    if (!gym?.id) return;
    return listenToGymPlans(gym.id, setPlans);
  }, [gym?.id]);

  if (!gym) return null;

  return isStaff
    ? <StaffPlans gym={gym} plans={plans} onBack={onBack} />
    : <MemberPlans gym={gym} plans={plans} onBack={onBack} />;
}

// ----- member: browse and adopt -----------------------------------------------

function MemberPlans({ gym, plans, onBack }: { gym: Gym; plans: GymWorkoutPlan[] | null; onBack: () => void }) {
  const { showToast } = useToast();
  const [open, setOpen] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const use = (plan: GymWorkoutPlan) => {
    const had = adoptedCopy(plan.id);
    adoptGymPlan(gym.id, plan, gym.name);
    setTick((n) => n + 1);
    showToast(had ? `${plan.name} refreshed and set as your active plan.` : `${plan.name} is now your active plan.`);
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

      {plans === null ? (
        <Card><p className={SUB}>Loading…</p></Card>
      ) : plans.length === 0 ? (
        <EmptyState icon={CalendarDays} title="No plans yet" body={`${gym.name} has not published a plan yet.`} />
      ) : (
        <div className="space-y-3">
          {plans.map((plan) => {
            const workoutDays = plan.days.filter((d) => !d.isRestDay);
            const mine = adoptedCopy(plan.id);
            const expanded = open === plan.id;
            return (
              <Card key={plan.id} padding="none" className="overflow-hidden">
                <div className="p-4">
                  <div className="min-w-0">
                    <h2 className="text-base font-semibold text-text truncate">{plan.name}</h2>
                    <p className={`${SUB} mt-0.5`}>
                      {workoutDays.length} training day{workoutDays.length === 1 ? '' : 's'} · by {plan.createdByName}
                    </p>
                    {plan.description && <p className="text-sm text-muted mt-2">{plan.description}</p>}
                  </div>
                  <div className="flex items-center gap-2 mt-3">
                    <Button variant={mine ? 'secondary' : 'primary'} size="md" icon={mine ? Check : undefined} onClick={() => use(plan)} className="flex-1">
                      {mine ? 'Added · refresh my copy' : 'Use this plan'}
                    </Button>
                    <IconButton icon={expanded ? ChevronUp : ChevronDown} label={expanded ? 'Hide days' : 'Show days'} onClick={() => setOpen(expanded ? null : plan.id)} />
                  </div>
                </div>
                {expanded && <PlanDays plan={plan} />}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ----- staff: manage, adopting is secondary -----------------------------------

function StaffPlans({ gym, plans, onBack }: { gym: Gym; plans: GymWorkoutPlan[] | null; onBack: () => void }) {
  const { showToast } = useToast();
  const { confirm } = useConfirm();
  const [open, setOpen] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

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

      <Card>
        <p className={SUB}>To publish a plan: Train → Weekly plans → <span className="text-text font-medium">Share with gym</span> on any plan you made. Publishing the same plan again updates it for everyone.</p>
      </Card>

      {plans === null ? (
        <Card><p className={SUB}>Loading…</p></Card>
      ) : plans.length === 0 ? (
        <EmptyState icon={CalendarDays} title="No plans yet" body="Share one of your weekly plans and members can start it with a tap." />
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
                        {workoutDays.length} training day{workoutDays.length === 1 ? '' : 's'} · by {plan.createdByName} · {plan.useCount} member{plan.useCount === 1 ? '' : 's'} using it
                      </p>
                      <p className={`${SUB} mt-0.5`}>
                        Updated {new Date(plan.updatedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                      </p>
                      {plan.description && <p className="text-sm text-muted mt-2">{plan.description}</p>}
                    </div>
                    <IconButton icon={Trash2} label={`Remove ${plan.name}`} size="sm" onClick={() => { void remove(plan); }} />
                  </div>
                  <div className="flex items-center gap-2 mt-3">
                    <Button variant="secondary" size="sm" icon={mine ? Check : undefined} onClick={() => use(plan)}>
                      {mine ? 'Added · refresh my copy' : 'Use this plan'}
                    </Button>
                    <IconButton
                      icon={expanded ? ChevronUp : ChevronDown}
                      label={expanded ? 'Hide days' : 'Show days'}
                      onClick={() => setOpen(expanded ? null : plan.id)}
                      className="ml-auto"
                    />
                  </div>
                </div>
                {expanded && <PlanDays plan={plan} />}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ----- shared -------------------------------------------------------------

function PlanDays({ plan }: { plan: GymWorkoutPlan }) {
  return (
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
  );
}
