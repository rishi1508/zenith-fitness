import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Scale, User } from 'lucide-react';
import type { ActivityLevel, HealthProfile, NutritionTargets, PhaseGoal } from '../../types';
import * as storage from '../../storage';
import {
  getHealthProfile, getPhaseSettings, getTargets, localDateISO, setHealthProfile, setPhaseSettings,
  setTargets, subscribeHealth,
} from '../../health/store';
import { computeTargets, estimateBmr, estimateMaintenanceKcal } from '../../health/targets';
import {
  Button, Card, Chip, IconButton, SegmentedControl, Sheet, StatTile, useToast, CAPTION, H2, SUB,
} from '../../ui';
import { explainTargets } from './nutritionHelpers';

export interface TargetsViewProps {
  onBack: () => void;
}

type Mode = 'auto' | 'manual';

const MODES: { value: Mode; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'manual', label: 'Manual' },
];

const ACTIVITY_LABEL: Record<ActivityLevel, string> = {
  sedentary: 'Sedentary', light: 'Light', moderate: 'Moderate', active: 'Active', 'very-active': 'Very active',
};
const ACTIVITY_LEVELS = Object.keys(ACTIVITY_LABEL) as ActivityLevel[];

const GOAL_LABEL: Record<PhaseGoal, string> = { bulk: 'Bulk', cut: 'Cut', maintain: 'Maintain' };
const GOALS: { value: PhaseGoal; label: string }[] = [
  { value: 'cut', label: 'Cut' }, { value: 'maintain', label: 'Maintain' }, { value: 'bulk', label: 'Bulk' },
];
/** Weekly rate presets per goal, as % of body weight. */
const RATES: Record<PhaseGoal, number[]> = { cut: [-0.5, -0.75, -1], maintain: [0], bulk: [0.25, 0.5] };
const DEFAULT_RATE: Record<PhaseGoal, number> = { cut: -0.5, maintain: 0, bulk: 0.25 };

/**
 * Daily calorie and macro targets (docs/HEALTH_SPEC.md §3). Auto derives
 * them from Mifflin–St Jeor + activity multiplier + the phase goal and
 * shows the derivation; Manual takes the numbers straight from the user.
 * The goal itself is owned by phase settings, not by this screen.
 */
export function TargetsView({ onBack }: TargetsViewProps) {
  const { showToast } = useToast();
  const [tick, setTick] = useState(0);
  const [profileOpen, setProfileOpen] = useState(false);

  useEffect(() => subscribeHealth(() => setTick((t) => t + 1)), []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const current = useMemo(() => getTargets(), [tick]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const profile = useMemo(() => getHealthProfile(), [tick]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const phase = useMemo(() => getPhaseSettings(), [tick]);
  const latestWeight = useMemo(() => storage.getLatestBodyWeight(), [tick]); // eslint-disable-line react-hooks/exhaustive-deps

  const [mode, setMode] = useState<Mode>(current?.mode ?? 'auto');

  const weightKg = latestWeight?.weight ?? 0;
  const goal: PhaseGoal = phase?.goal ?? 'maintain';
  const ratePct = phase?.targetRatePctPerWeek ?? 0;
  const activityLevel: ActivityLevel = profile.activityLevel ?? 'moderate';

  const bmr = weightKg > 0 ? estimateBmr(profile, weightKg) : null;
  const maintenance = weightKg > 0 ? estimateMaintenanceKcal(profile, weightKg) : null;
  const auto: NutritionTargets | null = maintenance != null
    ? computeTargets({ maintenanceKcal: maintenance, weightKg, goal, targetRatePctPerWeek: ratePct })
    : null;

  const saveAuto = () => {
    if (!auto) return;
    setTargets(auto);
    showToast('Targets updated.');
    onBack();
  };

  /** The goal lives in phase settings so this screen and Weight & phase never
   *  disagree; changing it here recomputes the numbers immediately. */
  const applyGoal = (nextGoal: PhaseGoal, nextRate = DEFAULT_RATE[nextGoal]) => {
    const existing = getPhaseSettings();
    setPhaseSettings({
      goal: nextGoal,
      targetRatePctPerWeek: nextRate,
      startDate: existing && existing.goal === nextGoal ? existing.startDate : localDateISO(),
      startWeightKg: existing && existing.goal === nextGoal ? existing.startWeightKg : (weightKg || undefined),
    });
  };

  return (
    <div className="space-y-4 animate-fadeIn">
      <div className="flex items-center gap-3">
        <IconButton icon={ArrowLeft} label="Back" onClick={onBack} />
        <h1 className={H2}>Targets</h1>
      </div>

      {current && (
        <div className="grid grid-cols-2 gap-2">
          <StatTile eyebrow="Calories" value={current.kcal} unit="kcal" sub={current.mode === 'auto' ? 'Auto' : 'Manual'} />
          <StatTile eyebrow="Protein" value={current.protein} unit="g" sub={`${current.carbs} C · ${current.fat} F`} />
        </div>
      )}

      <SegmentedControl options={MODES} value={mode} onChange={setMode} label="Target mode" />

      {mode === 'auto' ? (
        <>
          <Card padding="list">
            <SummaryRow
              icon={<User className="w-[18px] h-[18px]" strokeWidth={1.75} />}
              title="Profile"
              subtitle={
                profile.sex && profile.heightCm && profile.birthYear
                  ? `${profile.sex === 'male' ? 'Male' : 'Female'} · ${profile.heightCm} cm · born ${profile.birthYear} · ${ACTIVITY_LABEL[activityLevel]}`
                  : 'Sex, height and birth year needed'
              }
              action={{ label: 'Edit', onClick: () => setProfileOpen(true) }}
            />
            <SummaryRow
              icon={<Scale className="w-[18px] h-[18px]" strokeWidth={1.75} />}
              title="Body weight"
              subtitle={weightKg > 0 ? `${weightKg} kg` : 'Log a weigh-in first'}
            />
          </Card>

          <Card>
            <span className={CAPTION}>Goal</span>
            <div className="mt-2">
              <SegmentedControl
                options={GOALS}
                value={goal}
                onChange={(g) => applyGoal(g)}
                label="Calorie goal"
              />
            </div>
            {RATES[goal].length > 1 && (
              <div className="flex flex-wrap gap-2 mt-3">
                {RATES[goal].map((r) => (
                  <Chip key={r} on={r === ratePct} onClick={() => applyGoal(goal, r)}>
                    {r > 0 ? '+' : ''}{r} %/week
                  </Chip>
                ))}
              </div>
            )}
            <p className="text-xs text-subtle mt-2">
              {goal === 'maintain'
                ? 'Eat at maintenance — the target tracks your weight, not a deficit.'
                : `${GOAL_LABEL[goal]} at ${ratePct > 0 ? '+' : ''}${ratePct} %/week`
                  + (weightKg > 0 ? ` ≈ ${ratePct > 0 ? '+' : '−'}${Math.abs((ratePct / 100) * weightKg).toFixed(2)} kg a week.` : '.')}
            </p>
          </Card>

          <Card>
            {auto ? (
              <>
                <div className={CAPTION}>Computed target</div>
                <div className="font-display text-[32px] leading-10 font-bold tabular-nums text-text">
                  {auto.kcal} <span className="font-sans text-sm font-medium text-muted">kcal</span>
                </div>
                <p className={`${SUB} mt-1`}>
                  {auto.protein} g protein · {auto.carbs} g carbs · {auto.fat} g fat · {auto.waterMl} ml water
                </p>
                <p className="text-xs text-subtle mt-2 leading-relaxed">
                  {explainTargets({ bmr, maintenance, activityLevel, goal, ratePctPerWeek: ratePct, weightKg, kcal: auto.kcal })}
                </p>
              </>
            ) : (
              <p className={SUB}>
                {weightKg > 0
                  ? 'Add your sex, height and birth year to compute a maintenance estimate.'
                  : 'Log a body weight entry first — the estimate is built on it.'}
              </p>
            )}
          </Card>

          <Button variant="primary" size="lg" full disabled={!auto} onClick={saveAuto}>Use these targets</Button>
        </>
      ) : (
        <ManualTargets
          initial={current ?? auto}
          onSave={(t) => { setTargets(t); showToast('Targets updated.'); onBack(); }}
        />
      )}

      {profileOpen && (
        <ProfileSheet
          onClose={() => setProfileOpen(false)}
          profile={profile}
          onSave={(p) => { setHealthProfile(p); setProfileOpen(false); }}
        />
      )}
    </div>
  );
}

function SummaryRow({ icon, title, subtitle, action }: {
  icon: React.ReactNode; title: string; subtitle: string; action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex items-center gap-3 min-h-14 px-1 border-b border-border last:border-b-0">
      <span className="w-9 h-9 rounded-control flex items-center justify-center shrink-0 bg-accent-soft text-accent">{icon}</span>
      <span className="flex-1 min-w-0 flex flex-col">
        <span className="text-[15px] leading-[22px] font-semibold text-text truncate">{title}</span>
        <span className="text-[13px] leading-[18px] text-muted truncate">{subtitle}</span>
      </span>
      {action && (
        <button onClick={action.onClick} className="text-[13px] font-bold text-accent shrink-0">{action.label}</button>
      )}
    </div>
  );
}

function Field({ label, value, onChange, suffix }: {
  label: string; value: string; onChange: (v: string) => void; suffix?: string;
}) {
  return (
    <label className="flex flex-col gap-1 min-w-0">
      <span className={CAPTION}>{label}{suffix ? ` (${suffix})` : ''}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode="numeric"
        className="h-11 px-3 rounded-control border border-border bg-surface-2 text-text placeholder:text-subtle text-sm outline-none focus:border-accent/50"
      />
    </label>
  );
}

function ManualTargets({ initial, onSave }: {
  initial: NutritionTargets | null; onSave: (t: NutritionTargets) => void;
}) {
  const [kcal, setKcal] = useState(String(initial?.kcal ?? ''));
  const [protein, setProtein] = useState(String(initial?.protein ?? ''));
  const [carbs, setCarbs] = useState(String(initial?.carbs ?? ''));
  const [fat, setFat] = useState(String(initial?.fat ?? ''));
  const [water, setWater] = useState(String(initial?.waterMl ?? 3000));

  const num = (v: string) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= 0 ? n : 0; };
  const valid = num(kcal) > 0;

  return (
    <>
      <Card>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Calories" suffix="kcal" value={kcal} onChange={setKcal} />
          <Field label="Protein" suffix="g" value={protein} onChange={setProtein} />
          <Field label="Carbs" suffix="g" value={carbs} onChange={setCarbs} />
          <Field label="Fat" suffix="g" value={fat} onChange={setFat} />
          <Field label="Water" suffix="ml" value={water} onChange={setWater} />
        </div>
        <p className="text-xs text-subtle mt-3">
          Manual targets stay put — nothing recalculates them when your weight moves.
        </p>
      </Card>
      <Button
        variant="primary" size="lg" full disabled={!valid}
        onClick={() => onSave({
          kcal: num(kcal), protein: num(protein), carbs: num(carbs), fat: num(fat),
          waterMl: num(water), mode: 'manual', updatedAt: new Date().toISOString(),
        })}
      >
        Save targets
      </Button>
    </>
  );
}

/** Mounted only while open, so the fields seed from the stored profile. */
function ProfileSheet({ onClose, profile, onSave }: {
  onClose: () => void; profile: HealthProfile; onSave: (p: HealthProfile) => void;
}) {
  const [sex, setSex] = useState<HealthProfile['sex']>(profile.sex);
  const [height, setHeight] = useState(String(profile.heightCm ?? ''));
  const [birthYear, setBirthYear] = useState(String(profile.birthYear ?? ''));
  const [activity, setActivity] = useState<ActivityLevel>(profile.activityLevel ?? 'moderate');

  const num = (v: string) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : undefined; };

  return (
    <Sheet open onClose={onClose} title="Your profile">
      <p className={SUB}>Used only to estimate your maintenance calories.</p>
      <div>
        <span className={CAPTION}>Sex</span>
        <div className="flex gap-2 mt-2">
          <Chip on={sex === 'male'} onClick={() => setSex('male')}>Male</Chip>
          <Chip on={sex === 'female'} onClick={() => setSex('female')}>Female</Chip>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Height" suffix="cm" value={height} onChange={setHeight} />
        <Field label="Birth year" value={birthYear} onChange={setBirthYear} />
      </div>
      <div>
        <span className={CAPTION}>Activity level</span>
        <div className="flex flex-wrap gap-2 mt-2">
          {ACTIVITY_LEVELS.map((level) => (
            <Chip key={level} on={level === activity} onClick={() => setActivity(level)}>{ACTIVITY_LABEL[level]}</Chip>
          ))}
        </div>
      </div>
      <Button
        variant="primary" size="lg" full
        onClick={() => onSave({ sex, heightCm: num(height), birthYear: num(birthYear), activityLevel: activity })}
      >
        Save profile
      </Button>
    </Sheet>
  );
}
