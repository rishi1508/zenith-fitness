import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, Flame, Footprints, Dumbbell, Moon, Utensils } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import * as storage from '../../storage';
import { energyForDay, energyRange, workoutsOn } from '../../health/energyDay';
import { buildEnergyInsights, targetDailyBalance } from '../../health/energyInsights';
import type { EnergyInsight } from '../../health/energyInsights';
import { addDaysISO, getPhaseSettings, getTargets, listNutritionDays, localDateISO, subscribeHealth, sumMacros } from '../../health/store';
import { Card, EmptyState, IconButton, SectionHeader, StatTile, H2, SUB } from '../../ui';

const WINDOW_DAYS = 7;

function dayLabel(date: string): string {
  const today = localDateISO();
  if (date === today) return 'Today';
  if (date === addDaysISO(today, -1)) return 'Yesterday';
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}

const kcal = (n: number) => n.toLocaleString('en-IN');

/**
 * The energy ledger (docs/HEALTH_SPEC.md §13): what your body spends today
 * and what you ate against it, with the three layers kept apart so nothing
 * is counted twice — resting, training, and everything else you moved.
 */
export function EnergyView({ onBack, onAskZen }: { onBack: () => void; onAskZen?: (prompt: string) => void }) {
  const today = localDateISO();
  const [date, setDate] = useState(today);
  const [, bumpVersion] = useState(0);
  useEffect(() => subscribeHealth(() => bumpVersion((n) => n + 1)), []);

  const day = useMemo(() => energyForDay(date), [date]);
  const week = useMemo(() => energyRange(WINDOW_DAYS, today), [today]);
  const weightKg = storage.getLatestBodyWeight()?.weight ?? 0;

  const insights = useMemo<EnergyInsight[]>(() => {
    const targets = getTargets();
    const nutritionDays = listNutritionDays(addDaysISO(today, -(WINDOW_DAYS - 1)), today);
    const proteinLogged = nutritionDays.map((n) => sumMacros(n)).filter((m) => m.kcal > 0);
    return buildEnergyInsights({
      days: week,
      phase: getPhaseSettings(),
      targets,
      weightKg,
      proteinTargetG: targets?.protein,
      avgProteinG: proteinLogged.length
        ? proteinLogged.reduce((s, m) => s + m.protein, 0) / proteinLogged.length
        : undefined,
    });
  }, [week, weightKg, today]);

  const target = targetDailyBalance(getPhaseSettings(), weightKg);
  const balance = day.balanceKcal;

  return (
    <div className="space-y-4 animate-fadeIn">
      <div className="flex items-center gap-3">
        <IconButton icon={ArrowLeft} label="Back" onClick={onBack} />
        <h1 className={H2}>Energy</h1>
      </div>

      {/* Day picker */}
      <div className="flex items-center justify-between">
        <IconButton icon={ChevronLeft} label="Previous day" size="sm" onClick={() => setDate(addDaysISO(date, -1))} />
        <span className="text-[15px] font-semibold text-text">{dayLabel(date)}</span>
        <IconButton
          icon={ChevronRight} label="Next day" size="sm"
          disabled={date >= today}
          className={date >= today ? 'opacity-40 pointer-events-none' : ''}
          onClick={() => setDate(addDaysISO(date, 1))}
        />
      </div>

      {day.totalKcal == null ? (
        <EmptyState
          icon={Flame}
          title="We need a few numbers first"
          body="Your height, age and sex (health profile) plus a recent weigh-in let us work out what you burn at rest. Everything else builds on that."
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <StatTile eyebrow="Burned" value={kcal(day.totalKcal)} unit="kcal" sub="resting + active" tone="accent" />
            <StatTile
              eyebrow="Eaten"
              value={day.intakeKcal ? kcal(day.intakeKcal) : '—'}
              unit={day.intakeKcal ? 'kcal' : undefined}
              sub={day.intakeKcal ? 'from your diary' : 'nothing logged yet'}
            />
          </div>

          <StatTile
            eyebrow="Balance"
            value={balance == null || !day.intakeKcal ? '—' : `${balance > 0 ? '+' : ''}${kcal(balance)}`}
            unit={balance != null && day.intakeKcal ? 'kcal' : undefined}
            tone={balance == null || !day.intakeKcal ? 'default' : balanceTone(balance, target)}
            sub={target ? `Your phase wants ${target > 0 ? '+' : '−'}${kcal(Math.abs(target))} kcal a day` : 'Set a phase to get a target'}
          />

          {/* Where the burn comes from. */}
          <Card padding="list">
            <SectionHeader caption="Where it goes" />
            <Line icon={Moon} label="Resting" value={day.restingKcal ?? 0} hint="Just being alive, over 24 hours" />
            <Line
              icon={Dumbbell} label="Training" value={day.workoutKcal}
              hint={workoutHint(date)}
            />
            <Line
              icon={Footprints}
              label="Moving"
              value={day.activeSource === 'device' ? Math.max(0, day.activeKcal - day.workoutKcal) : day.stepsKcal}
              hint={day.activeSource === 'device'
                ? 'Measured by your phone or watch'
                : day.stepsKcal > 0 ? 'Estimated from your steps' : 'No steps recorded'}
            />
            <Line icon={Utensils} label="Eaten" value={day.intakeKcal} hint="Everything in the diary" negative />
          </Card>

          {/* Seven-day strip. */}
          <Card>
            <SectionHeader caption="Last 7 days" />
            <div className="mt-3 flex items-end justify-between gap-1.5 h-24">
              {week.map((d) => {
                const max = Math.max(...week.map((x) => Math.max(x.totalKcal ?? 0, x.intakeKcal)), 1);
                const outH = Math.round(((d.totalKcal ?? 0) / max) * 100);
                const inH = Math.round((d.intakeKcal / max) * 100);
                return (
                  <button
                    key={d.date}
                    onClick={() => setDate(d.date)}
                    className="flex-1 min-w-0 flex flex-col items-center gap-1"
                    aria-label={`${dayLabel(d.date)}: ${kcal(d.totalKcal ?? 0)} burned, ${kcal(d.intakeKcal)} eaten`}
                  >
                    <span className="w-full flex items-end justify-center gap-0.5 h-20">
                      <span className="w-1/3 rounded-sm bg-accent/70" style={{ height: `${outH}%` }} />
                      <span className="w-1/3 rounded-sm bg-info/60" style={{ height: `${inH}%` }} />
                    </span>
                    <span className={`text-[10px] ${d.date === date ? 'text-accent font-semibold' : 'text-subtle'}`}>
                      {new Date(d.date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'narrow' })}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className={`${SUB} mt-2`}>
              <span className="text-accent">▮</span> burned · <span className="text-info">▮</span> eaten
            </p>
          </Card>
        </>
      )}

      {/* What to do about it. */}
      {insights.length > 0 && (
        <div className="space-y-2">
          <SectionHeader caption="What this means" />
          {insights.map((i) => (
            <Card key={i.id}>
              <div className="flex items-start gap-2">
                <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${TONE_DOT[i.tone]}`} aria-hidden="true" />
                <div className="min-w-0">
                  <p className="text-[15px] leading-[22px] font-semibold text-text">{i.headline}</p>
                  <p className={`${SUB} mt-1`}>{i.detail}</p>
                </div>
              </div>
            </Card>
          ))}
          {onAskZen && (
            <button
              onClick={() => onAskZen('Look at my energy balance this week and tell me what to change.')}
              className="w-full min-h-11 rounded-control border border-border text-sm font-semibold text-accent"
            >
              Ask Zen about this
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const TONE_DOT = { good: 'bg-ok', warn: 'bg-warn', info: 'bg-info' } as const;

function balanceTone(balance: number, target: number): 'ok' | 'warn' {
  // Within 250 kcal of what the phase asks for is "on plan".
  return Math.abs(balance - target) <= 250 ? 'ok' : 'warn';
}

/** "Push Day · 62 min" for the day's sessions, or a nudge when there were none. */
function workoutHint(date: string): string {
  const sessions = workoutsOn(date);
  if (sessions.length === 0) return 'No session logged';
  return sessions.map((w) => (w.duration ? `${w.name} · ${w.duration} min` : w.name)).join(' · ');
}

function Line({ icon: Icon, label, value, hint, negative }: {
  icon: LucideIcon; label: string; value: number; hint: string; negative?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 min-h-14 px-1">
      <span className="w-9 h-9 rounded-control bg-surface-2 flex items-center justify-center shrink-0">
        <Icon className="w-[18px] h-[18px] text-subtle" strokeWidth={1.75} />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-[15px] leading-[22px] font-semibold text-text">{label}</span>
        <span className={`${SUB} block truncate`}>{hint}</span>
      </span>
      <span className={`text-[15px] font-bold tabular-nums shrink-0 ${negative ? 'text-info' : 'text-text'}`}>
        {negative ? '−' : ''}{kcal(value)}
      </span>
    </div>
  );
}
