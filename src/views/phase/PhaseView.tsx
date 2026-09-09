import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Scale } from 'lucide-react';
import type {
  BodyWeightEntry, HealthProfile, NutritionDay, NutritionTargets, PhaseGoal, PhaseSettings,
} from '../../types';
import * as storage from '../../storage';
import {
  addDaysISO, computeTargets, estimateMaintenanceKcal, fetchNutritionRange, getHealthProfile,
  getPhaseSettings, getTargets, listNutritionDays, localDateISO, setPhaseSettings, setTargets, subscribeHealth,
} from '../../health';
import {
  adaptiveMaintenance, evaluateGoal, planDrift, plannedWeights, weeksElapsed, weightTrend, MIN_TREND_POINTS,
} from '../../phase';
import { InteractiveLineChart } from '../../components';
import type { ChartPoint } from '../../components';
import { Button, Card, Chip, EmptyState, IconButton, Pill, SegmentedControl, StatTile, useToast, CAPTION, H1, SUB } from '../../ui';
import { PremiumBadge } from '../../premium';
import { GOAL_LABEL, STATUS_LABEL, STATUS_TONE, rateBadge, signed } from './status';

/** Window the rate, status and adaptive maintenance are read over. */
const RATE_WINDOW_DAYS = 14;
const RAW_COLOR = '#a855f7';
const EMA_COLOR = '#f97316';
/** Dashed green: distinct from the raw line (purple), the trend (orange) and
 *  the chart's own moving average (cyan), and never reads as measured data. */
const PLAN_COLOR = '#22c55e';
const INPUT_CLS = 'rounded-control px-3 h-11 text-sm bg-surface-2 border border-border text-text focus:outline-none focus:border-accent';

const RATE_PRESETS: Record<PhaseGoal, number[]> = { cut: [-0.5, -0.75], bulk: [0.25, 0.5], maintain: [0] };

const BASIS_NOTE: Record<'adaptive' | 'formula' | 'none', string> = {
  adaptive: 'from your logged intake and weight trend',
  formula: 'estimated from your profile (Mifflin–St Jeor)',
  none: 'add your sex, height and birth year in Targets to estimate it',
};

interface PhaseData {
  entries: BodyWeightEntry[];
  settings: PhaseSettings | null;
  profile: HealthProfile;
  nutrition: NutritionDay[];
  /** Shown on this page, so "Recalculate targets" has somewhere to land. */
  targets: NutritionTargets | null;
}

function readPhaseData(): PhaseData {
  const today = localDateISO();
  return {
    entries: storage.getBodyWeightEntries(),
    settings: getPhaseSettings(),
    profile: getHealthProfile(),
    nutrition: listNutritionDays(addDaysISO(today, -(RATE_WINDOW_DAYS - 1)), today),
    targets: getTargets(),
  };
}

export interface PhaseViewProps {
  /** `InteractiveLineChart` is a legacy component and still takes the theme flag. */
  isDark: boolean;
  onBack: () => void;
  /** Body-weight logging lives in its own view; the empty states link there. */
  onOpenBodyWeight: () => void;
}

/**
 * Weight & phase (docs/HEALTH_SPEC.md §5): what the scale is actually doing
 * over the last two weeks, whether that matches the bulk/cut the user asked
 * for, and the maintenance number their calorie targets come from. All maths
 * lives in `src/phase/engine.ts` — this view only reads, formats and saves.
 */
export function PhaseView({ isDark, onBack, onOpenBodyWeight }: PhaseViewProps) {
  const { showToast } = useToast();
  const [data, setData] = useState<PhaseData>(readPhaseData);
  const [rangeDays, setRangeDays] = useState(30);

  useEffect(() => subscribeHealth(() => setData(readPhaseData())), []);

  // One range read per visit warms the nutrition cache the adaptive
  // maintenance estimate needs (no listener — docs/COST_CONTROLS.md).
  useEffect(() => {
    const today = localDateISO();
    void fetchNutritionRange(addDaysISO(today, -(RATE_WINDOW_DAYS - 1)), today).then(() => setData(readPhaseData()));
  }, []);

  const { entries, settings, profile, nutrition, targets } = data;
  const trend = useMemo(() => weightTrend(entries, { days: RATE_WINDOW_DAYS }), [entries]);
  const chartTrend = useMemo(() => weightTrend(entries, { days: rangeDays }), [entries, rangeDays]);
  const weightKg = trend.latestEma ?? entries[0]?.weight ?? null;

  const maintenance = useMemo(
    () => adaptiveMaintenance({
      nutritionDays: nutrition,
      trend,
      fallbackKcal: weightKg ? estimateMaintenanceKcal(profile, weightKg) : null,
    }),
    [nutrition, trend, profile, weightKg],
  );

  const weeks = settings ? weeksElapsed(settings) : 0;
  const evaluation = settings ? evaluateGoal(settings, trend, weeks) : null;
  const missingWeighIns = Math.max(0, MIN_TREND_POINTS - trend.points.length);
  const pillTone = evaluation ? STATUS_TONE[evaluation.status] : 'neutral';
  const tileTone = pillTone === 'neutral' ? 'default' : pillTone;

  const chartPoints = useMemo<ChartPoint[]>(
    () => chartTrend.points.map((p) => ({ date: p.date, value: p.weight })),
    [chartTrend],
  );
  const emaOverlay = useMemo(
    () => ({ values: chartTrend.points.map((p) => p.ema), color: EMA_COLOR, label: 'Trend' }),
    [chartTrend],
  );

  /** What the plan asks for, drawn beside what actually happened. Anchored to
   *  the weight the phase started at, compounding at the target rate. */
  const planOverlay = useMemo(() => {
    if (!settings) return null;
    const anchor = settings.startWeightKg ?? chartTrend.points[0]?.ema ?? null;
    if (anchor == null) return null;
    const values = plannedWeights(settings, chartTrend.points.map((p) => p.date), anchor);
    return values.some((v) => v !== null)
      ? { values, color: PLAN_COLOR, label: 'Plan', dashed: true }
      : null;
  }, [settings, chartTrend]);

  /** How far off the plan the scale is today, and what that means. */
  const drift = useMemo(() => {
    const last = chartTrend.points[chartTrend.points.length - 1];
    if (!settings || !last || settings.startWeightKg == null) return null;
    const kg = planDrift(settings, last.date, last.ema, settings.startWeightKg);
    if (kg === null) return null;
    const off = Math.abs(kg) >= 0.7;
    const heavier = kg > 0;
    const wanted = settings.goal;
    const behind = wanted === 'cut' ? heavier : wanted === 'bulk' ? !heavier : off;
    return {
      kg,
      off,
      line: !off
        ? `On the line — within ${Math.abs(kg).toFixed(1)} kg of where the plan puts you today.`
        : behind
          ? `${Math.abs(kg).toFixed(1)} kg ${heavier ? 'above' : 'below'} the plan's line for today — the gap is going the wrong way.`
          : `${Math.abs(kg).toFixed(1)} kg ${heavier ? 'above' : 'below'} the plan's line, and ahead of schedule.`,
    };
  }, [settings, chartTrend]);

  const startPhase = (goal: PhaseGoal) => {
    setPhaseSettings({
      goal,
      targetRatePctPerWeek: RATE_PRESETS[goal][0],
      startDate: localDateISO(),
      startWeightKg: weightKg ? Number(weightKg.toFixed(1)) : undefined,
    });
  };
  const saveRate = (targetRatePctPerWeek: number) => {
    if (settings) setPhaseSettings({ ...settings, targetRatePctPerWeek });
  };
  const saveStartDate = (startDate: string) => {
    if (settings && startDate) setPhaseSettings({ ...settings, startDate });
  };

  const recalculate = () => {
    if (!settings || !weightKg || maintenance.kcal === null) return;
    const next = computeTargets({
      maintenanceKcal: maintenance.kcal,
      weightKg,
      goal: settings.goal,
      targetRatePctPerWeek: settings.targetRatePctPerWeek,
      maintenanceBasis: maintenance.basis,
    });
    const before = data.targets;
    setTargets(next);
    setData(readPhaseData());
    const delta = before ? next.kcal - before.kcal : null;
    showToast(
      delta === null || delta === 0
        ? `Targets set — ${next.kcal} kcal, ${next.protein} g protein`
        : `Targets ${delta > 0 ? 'raised' : 'lowered'} by ${Math.abs(delta)} kcal — now ${next.kcal} kcal, ${next.protein} g protein`,
    );
  };

  return (
    <div className="space-y-4 animate-fadeIn">
      <div className="flex items-center gap-2">
        <IconButton icon={ArrowLeft} label="Back" onClick={onBack} />
        <h1 className={`${H1} flex-1 truncate`}>Weight &amp; phase</h1>
        <PremiumBadge />
      </div>

      <Card>
        <div className="flex items-center justify-between gap-3 mb-3">
          <span className={CAPTION}>Your phase</span>
          {settings && <span className="text-xs text-muted">Week {Math.floor(weeks) + 1}</span>}
        </div>
        <SegmentedControl
          label="Phase goal"
          options={(['cut', 'maintain', 'bulk'] as PhaseGoal[]).map((g) => ({ value: g, label: GOAL_LABEL[g] }))}
          value={settings?.goal ?? 'maintain'}
          onChange={(goal) => { if (goal !== settings?.goal) startPhase(goal); }}
        />
        {!settings && <p className={`${SUB} mt-3`}>Pick a goal to start a phase. Today becomes day one.</p>}

        {settings && settings.goal !== 'maintain' && (
          <div className="flex flex-wrap items-center gap-2 mt-3">
            {RATE_PRESETS[settings.goal].map((rate) => (
              <Chip key={rate} on={settings.targetRatePctPerWeek === rate} onClick={() => saveRate(rate)}>
                {signed(rate)} %/week
              </Chip>
            ))}
            {weightKg && (
              <span className="text-xs text-muted">
                ≈ {signed((settings.targetRatePctPerWeek / 100) * weightKg)} kg a week
              </span>
            )}
          </div>
        )}

        {settings && (
          <div className="flex items-center justify-between gap-3 mt-3">
            <label htmlFor="phase-start" className="text-sm text-muted">Started</label>
            <input
              id="phase-start"
              type="date"
              value={settings.startDate}
              max={localDateISO()}
              onChange={(e) => saveStartDate(e.target.value)}
              className={INPUT_CLS}
            />
          </div>
        )}
        {settings?.startWeightKg !== undefined && weightKg && (
          <p className={`${SUB} mt-2`}>
            Start weight {settings.startWeightKg.toFixed(1)} kg · now {weightKg.toFixed(1)} kg
            {' '}({signed(weightKg - settings.startWeightKg, 1)} kg)
          </p>
        )}
      </Card>

      {entries.length === 0 ? (
        <EmptyState
          icon={Scale}
          title="No weigh-ins yet"
          body={`Weigh yourself first thing in the morning. ${MIN_TREND_POINTS} weigh-ins across a week are enough to read a trend.`}
          action={{ label: 'Log weight', onClick: onOpenBodyWeight }}
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <StatTile
              eyebrow="Trend weight"
              value={trend.latestEma ? trend.latestEma.toFixed(1) : '—'}
              unit={trend.latestEma ? 'kg' : undefined}
              sub="Smoothed, 7-day half-life"
            />
            <StatTile
              eyebrow="Rate"
              value={trend.status === 'ok' ? signed(trend.rateKgPerWeek) : '—'}
              unit={trend.status === 'ok' ? 'kg/week' : undefined}
              tone={tileTone}
              sub={
                trend.status === 'ok'
                  ? `${signed(trend.ratePctPerWeek)} %/week`
                  : missingWeighIns > 0
                    ? `${missingWeighIns} more weigh-in${missingWeighIns === 1 ? '' : 's'} over the next week`
                    : 'Keep logging — the trend needs a full week'
              }
            />
          </div>

          <SegmentedControl
            label="Chart range"
            options={[{ value: '30', label: '30 days' }, { value: '90', label: '90 days' }]}
            value={String(rangeDays)}
            onChange={(v) => setRangeDays(Number(v))}
          />

          <InteractiveLineChart
            points={chartPoints}
            isDark={isDark}
            accent={RAW_COLOR}
            gradientId="phaseWeightGradient"
            title={`Weight · ${rangeDays} days`}
            formatValue={(v) => v.toFixed(1)}
            unit="kg"
            minPoints={2}
            emptyMessage={`Log at least 2 weigh-ins in the last ${rangeDays} days.`}
            overlay={chartPoints.length >= 2
              ? (planOverlay ? [emaOverlay, planOverlay] : [emaOverlay])
              : undefined}
            headerExtra={
              trend.status === 'ok' ? (
                <span className="text-xs font-bold tabular-nums" style={{ color: EMA_COLOR }}>
                  {rateBadge(trend.rateKgPerWeek, trend.ratePctPerWeek)} / week
                </span>
              ) : undefined
            }
          />

          {planOverlay && weightKg && settings && (
            <Card>
              <span className={CAPTION}>Against the plan</span>
              <p className="text-[15px] leading-[22px] font-semibold text-text mt-1">
                {GOAL_LABEL[settings.goal]} at {signed(settings.targetRatePctPerWeek)} %/week —{' '}
                {signed((settings.targetRatePctPerWeek / 100) * weightKg)} kg a week,{' '}
                {signed((settings.targetRatePctPerWeek / 100) * weightKg * 4.345, 1)} kg a month.
              </p>
              <p className={`${SUB} mt-1`}>
                {drift ? drift.line : 'The dashed line is where the plan puts you; the orange one is the trend.'}
              </p>
              {drift?.off && (
                <p className={`${SUB} mt-1`}>
                  A kilo is about 7,700 kcal, so closing that over four weeks is roughly{' '}
                  {Math.abs(Math.round((drift.kg * 7700) / 28 / 25) * 25)} kcal a day.
                </p>
              )}
            </Card>
          )}

          {evaluation && (
            <Card tone={pillTone === 'warn' || pillTone === 'danger' ? 'warn' : 'default'}>
              <div className="flex items-center justify-between gap-3 mb-2">
                <span className={CAPTION}>Status</span>
                <Pill tone={pillTone}>{STATUS_LABEL[evaluation.status]}</Pill>
              </div>
              <p className="text-[15px] leading-[22px] font-semibold text-text">{evaluation.headline}</p>
              <p className={`${SUB} mt-1`}>{evaluation.guidance}</p>
            </Card>
          )}

          <Card>
            <span className={CAPTION}>Maintenance</span>
            <p className="text-[15px] leading-[22px] font-semibold text-text mt-1">
              {maintenance.kcal !== null ? `${maintenance.kcal.toLocaleString('en-IN')} kcal a day` : 'Not enough to estimate'}
            </p>
            <p className={`${SUB} mt-1`}>
              {BASIS_NOTE[maintenance.basis]}
              {maintenance.basis === 'adaptive' && ` · ${maintenance.loggedDays} logged days`}
              {maintenance.basis === 'formula' && maintenance.loggedDays > 0
                && ` · ${maintenance.loggedDays} of 10 logged days towards a measured number`}
            </p>
            <Button
              className="mt-3"
              variant="secondary"
              full
              disabled={!settings || maintenance.kcal === null || !weightKg}
              onClick={recalculate}
            >
              Recalculate targets
            </Button>
            {!settings && <p className={`${SUB} mt-2`}>Pick a goal above first.</p>}

            {/* Where "Recalculate" lands. Without this the button changed
                something the user could not see from here. */}
            {targets && (
              <div className="mt-3 pt-3 border-t border-border">
                <div className="flex items-baseline justify-between gap-2">
                  <span className={CAPTION}>Your daily targets</span>
                  <span className="text-[11px] text-subtle">
                    {targets.mode === 'manual' ? 'set by hand' : `updated ${new Date(targets.updatedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`}
                  </span>
                </div>
                <p className="text-[15px] leading-[22px] font-semibold text-text mt-1 tabular-nums">
                  {targets.kcal.toLocaleString('en-IN')} kcal · P{targets.protein} C{targets.carbs} F{targets.fat} g
                </p>
                {targets.mode === 'manual' && (
                  <p className={`${SUB} mt-1`}>
                    These are manual, so recalculating replaces them with the figures above.
                  </p>
                )}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
