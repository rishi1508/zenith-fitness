import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ChevronRight, RefreshCw, Sparkles } from 'lucide-react';
import type { Workout, UserStats } from '../types';
import * as storage from '../storage';
import { useAuth } from '../auth/AuthContext';
import { usePremium } from '../premium';
import { ZenError } from '../zen/client';
import type { ZenErrorKind } from '../zen/client';
import { fmtShort, fmtVolume, num, signed } from '../zen/format';
import { Button, Card, EmptyState, IconButton, SectionHeader, SegmentedControl, Skeleton } from '../ui';
import { CAPTION, H1, SUB } from '../ui/styles';
import { HistoryBars, MetricSheet } from '../components/gym/ops/MetricSheet';
import type { MetricExplainer } from '../components/gym/ops/MetricSheet';
import { KpiTile } from '../components/gym/ops/KpiTile';
import { ANALYSIS_WINDOWS, WINDOW_LABEL, buildAnalysis } from '../analysis/engine';
import type { Actionable, AnalysisReport, AnalysisWindow, ExerciseStrength, GroupShare } from '../analysis/engine';
import { fetchNarrative, readNarrativeCache } from '../analysis/narrative';
import { renderZenMarkdown } from './zen/zenMarkdown';

interface AnalysisViewProps {
  stats: UserStats | null;
  workouts: Workout[];
  /** Unused — the screen is built from the token-themed UI kit. Kept because
   *  App.tsx still passes it to every legacy view. */
  isDark?: boolean;
  onBack: () => void;
  onStartDay: (dayIndex: number) => void;
  /** Opens Zen with the composer pre-filled. Optional so the screen still
   *  renders (without the hand-off) wherever it is not wired. */
  onAskZen?: (prompt: string) => void;
}

type SheetState =
  | { kind: 'metric'; metric: MetricKey }
  | { kind: 'exercise'; key: string }
  | { kind: 'action'; id: string };

type MetricKey = 'volume' | 'sessions' | 'prs' | 'strength' | 'balance' | 'consistency' | 'recovery';

/**
 * Plain-language cards for every number on this screen, written for someone
 * who lifts but has never read a training spreadsheet. Copy, not code —
 * keep it honest about what the app can actually see.
 */
const EXPLAINERS: Record<MetricKey, Omit<MetricExplainer, 'value'>> = {
  volume: {
    title: 'Volume and where it is heading',
    meaning: 'Volume is the total weight you moved: every completed set\'s weight times its reps, added up. It is the single best measure of how much work a block of training actually contained.',
    method: 'Weekly totals across the window. The trend splits the window down the middle and compares the older half\'s weekly average with the newer half\'s. Rest days and deload weeks are left out, so a planned easy week never reads as a slump.',
    good: 'Flat or slowly rising. A change under 7.5% either way is normal week-to-week noise. A sharp climb for three weeks running is when a lighter week starts paying for itself.',
  },
  sessions: {
    title: 'Sessions a week',
    meaning: 'How many days a week you actually trained, against the days a week you committed to. Turning up is the part of training that everything else depends on.',
    method: 'Distinct days with a completed workout, divided by the number of finished weeks in the window. The week in progress is left out until it ends, so a Monday does not drag the figure down.',
    good: 'At or above your commitment. Landing four weeks in five is enough to keep progressing; dropping under three quarters of the plan is where results start to stall.',
  },
  prs: {
    title: 'Personal bests',
    meaning: 'Sets that imply you are stronger on a lift than you have ever been. A best does not need to be a single: five reps at a new weight counts, because it points at a heavier one-rep max than anything before it.',
    method: 'Every set is turned into an estimated one-rep max with the Epley formula — weight × (1 + reps ÷ 30). When a session\'s best beats every session before it, on that exercise, in your whole history, it is a personal best. Only the ones inside this window are counted here.',
    good: 'A handful per block. They come often in the first year and then slow down — that is the lift getting harder to move, not you getting worse.',
  },
  strength: {
    title: 'Estimated one-rep max',
    meaning: 'The heaviest single your best set of the day suggests you could lift. It lets 5 × 80 kg and 3 × 90 kg be compared on the same line, which is what makes a strength trend readable at all.',
    method: 'Epley: weight × (1 + reps ÷ 30), taken from the best set of each session. Sets above 12 reps are only used when an exercise was never trained heavier, because the formula flatters high-rep work. Deload weeks are left out.',
    good: 'Rising, or flat while you add reps. Three or more sessions with no new best is a plateau — usually a signal to change the rep range for a few weeks, not to push harder at the same one.',
  },
  balance: {
    title: 'Muscle balance',
    meaning: 'Where your lifting actually went. Most people train what they can see: the share here is the honest version of that, and it is what keeps the shoulders and lower back out of trouble.',
    method: 'Weight lifted per muscle group, from the group set on each exercise in your library, matched by exercise and then by name. Exercises that are not in your library cannot be grouped and are left out of the shares.',
    good: 'Push (chest, shoulders, triceps) and pull (back, biceps) within reach of each other — the lighter side at 60% of the heavier at worst. Every main group above 5% of your volume.',
  },
  consistency: {
    title: 'Sticking to the plan',
    meaning: 'How much of the training you committed to actually happened, week by week, and the longest stretch you went without a session.',
    method: 'Distinct training days against your committed days a week, over the finished weeks in this window. Your commitment comes from your streak setting, or from the number of training days in your active plan.',
    good: 'Above 80% of the plan, with no gap longer than about four days. Strength holds for roughly a week off; past that the next session goes on catching up rather than progressing.',
  },
  recovery: {
    title: 'Recovery signals',
    meaning: 'Two quiet warnings: volume that has climbed several weeks in a row, and sessions that came in far under what you normally do on those exercises. Neither is a verdict — together they usually mean the block has run long enough.',
    method: 'Rising weeks come from total weekly volume over the last four weeks. A light session is one where the typical exercise landed at 70% or less of its usual volume for this window, judged per exercise so a leg day is compared with leg days.',
    good: 'No more than two or three rising weeks before a lighter one. The odd light session is life; several in a row is fatigue, food or sleep.',
  },
};

/**
 * Analysis — the one screen that reads a lifter's history back to them.
 *
 * Everything numeric comes from `src/analysis/engine.ts`, a pure function
 * of (workouts, exercise library, window, commitment). The AI layer is one
 * short read-out from Zen on top of those numbers, cached for the day, and
 * the screen is complete and correct without it.
 */
export function AnalysisView({ stats, workouts, onBack, onStartDay, onAskZen }: AnalysisViewProps) {
  const [window, setWindow] = useState<AnalysisWindow>('12w');
  const [sheet, setSheet] = useState<SheetState | null>(null);

  const exercises = useMemo(() => storage.getExercises(), []);
  const commitment = useMemo(() => storage.getStreakCommitment(), []);
  const report = useMemo(
    () => buildAnalysis({ workouts, exercises, window, commitment }),
    [workouts, exercises, window, commitment],
  );

  const nextDay = useMemo(() => findNextDay(), []);

  const header = (
    <div className="flex items-center gap-2 min-w-0">
      <IconButton icon={ArrowLeft} label="Back" size="sm" onClick={onBack} />
      <div className="min-w-0">
        <h1 className={H1}>Analysis</h1>
        <p className={`${CAPTION} mt-0.5`}>
          {report.sessions} session{report.sessions === 1 ? '' : 's'} · {WINDOW_LABEL[window].toLowerCase()}
        </p>
      </div>
    </div>
  );

  const windowPicker = (
    <SegmentedControl
      label="Window"
      value={window}
      onChange={setWindow}
      options={ANALYSIS_WINDOWS.map((w) => ({ value: w, label: WINDOW_LABEL[w] }))}
    />
  );

  if (!report.hasEnoughData) {
    return (
      <div className="space-y-4 animate-fadeIn">
        {header}
        {windowPicker}
        <EmptyState
          icon={Sparkles}
          title="Not enough to read yet"
          body={`Three finished sessions in this window is the floor for saying anything useful. You have ${report.sessions}. Keep logging — the analysis fills in on its own.`}
        />
        {stats && stats.totalWorkouts > 0 && (
          <p className={SUB}>{stats.totalWorkouts} workouts logged all time. Try the all-time window.</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-fadeIn">
      {header}
      {windowPicker}

      <div className="grid grid-cols-3 gap-2">
        <KpiTile
          eyebrow="Volume"
          value={`${fmtVolume(report.load.totalVolume)} kg`}
          changePct={report.load.trend.changePct}
          changeLabel="vs first half"
          sub="too few weeks to compare"
          tone={report.load.trend.direction === 'falling' ? 'warn' : 'default'}
          onClick={() => setSheet({ kind: 'metric', metric: 'volume' })}
        />
        <KpiTile
          eyebrow="Sessions/week"
          value={num(report.load.sessionsPerWeek)}
          sub={`of ${report.consistency.commitment} planned`}
          tone={report.load.sessionsPerWeek >= report.consistency.commitment ? 'ok'
            : report.consistency.adherencePct < 75 ? 'warn' : 'default'}
          onClick={() => setSheet({ kind: 'metric', metric: 'sessions' })}
        />
        <KpiTile
          eyebrow="Personal bests"
          value={report.strength.prs.length}
          sub="in this window"
          tone={report.strength.prs.length > 0 ? 'accent' : 'default'}
          onClick={() => setSheet({ kind: 'metric', metric: 'prs' })}
        />
      </div>

      <p className={`${SUB} px-0.5`}>Tap any number for what it means and where it came from.</p>

      <CoachRead report={report} window={window} onAskZen={onAskZen} />

      <StrengthSection
        report={report}
        onOpenExercise={(key) => setSheet({ kind: 'exercise', key })}
        onInfo={() => setSheet({ kind: 'metric', metric: 'strength' })}
      />

      <BalanceSection report={report} onInfo={() => setSheet({ kind: 'metric', metric: 'balance' })} />

      <ConsistencySection
        report={report}
        nextDay={nextDay}
        onStartDay={onStartDay}
        onInfo={() => setSheet({ kind: 'metric', metric: 'consistency' })}
      />

      <RecoverySection report={report} onInfo={() => setSheet({ kind: 'metric', metric: 'recovery' })} />

      <ActionablesSection report={report} onOpen={(id) => setSheet({ kind: 'action', id })} />

      <AnalysisSheet
        sheet={sheet}
        report={report}
        onClose={() => setSheet(null)}
        onAskZen={onAskZen}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Coach's read — the AI layer
 * ------------------------------------------------------------------ */

type NarrativeState =
  | { status: 'ready'; text: string; at: string }
  | { status: 'error'; message: string };

function CoachRead({ report, window, onAskZen }: {
  report: AnalysisReport;
  window: AnalysisWindow;
  onAskZen?: (prompt: string) => void;
}) {
  const { user } = useAuth();
  const { can } = usePremium();
  const canZen = can('zen');
  // Kept per window so switching back and forth never buys a second answer,
  // and seeded from today's cache so opening the screen again costs nothing.
  const [states, setStates] = useState<Partial<Record<AnalysisWindow, NarrativeState>>>(seedFromCache);
  const [busy, setBusy] = useState(false);
  /** The window the user asked to re-read — the only thing that bypasses the day's cache. */
  const [forced, setForced] = useState<AnalysisWindow | null>(null);
  const state = states[window];

  // Same shape as `useGymOps`: one load per open, cancelled on unmount, and
  // an explicit refresh rather than anything that could fire twice.
  useEffect(() => {
    if (!canZen || !user) return;
    const force = forced === window;
    if (!force && states[window]) return;

    let cancelled = false;
    (async () => {
      setBusy(true);
      try {
        const idToken = await user.getIdToken();
        const result = await fetchNarrative({
          report,
          idToken,
          tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
          force,
        });
        if (!cancelled) setStates((prev) => ({ ...prev, [window]: { status: 'ready', text: result.text, at: result.at } }));
      } catch (err) {
        const kind: ZenErrorKind = err instanceof ZenError ? err.kind : 'unknown';
        if (!cancelled) setStates((prev) => ({ ...prev, [window]: { status: 'error', message: errorCopy(kind) } }));
      } finally {
        if (!cancelled) { setBusy(false); setForced(null); }
      }
    })();
    return () => { cancelled = true; };
  }, [canZen, user, window, report, forced, states]);

  const refresh = () => setForced(window);
  const loading = busy || (!state && !!user);
  const topAction = report.actionables[0];

  return (
    <Card>
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className={CAPTION}>Coach&apos;s read</span>
        {canZen && user && (
          <IconButton icon={RefreshCw} label="Refresh the read-out" size="sm" onClick={refresh} disabled={loading} />
        )}
      </div>

      {!canZen && (
        <p className="text-sm text-muted">Zen writes this read-out for you. The numbers below are yours either way.</p>
      )}

      {canZen && !user && <p className="text-sm text-muted">{errorCopy('auth')}</p>}

      {canZen && user && loading && (
        <div className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-10/12" />
          <Skeleton className="h-4 w-8/12" />
        </div>
      )}

      {canZen && user && !loading && state?.status === 'error' && (
        <p className="text-sm text-muted">{state.message}</p>
      )}

      {canZen && user && !loading && state?.status === 'ready' && (
        <div className="text-sm leading-relaxed text-text">{renderZenMarkdown(state.text)}</div>
      )}

      {onAskZen && topAction && (
        <Button
          variant="secondary"
          size="sm"
          className="mt-3"
          onClick={() => onAskZen(askPrompt(topAction))}
        >
          Ask Zen about this
        </Button>
      )}
    </Card>
  );
}

/** Today's cached read-outs, for every window, read once at mount. */
function seedFromCache(): Partial<Record<AnalysisWindow, NarrativeState>> {
  const out: Partial<Record<AnalysisWindow, NarrativeState>> = {};
  for (const w of ANALYSIS_WINDOWS) {
    const cached = readNarrativeCache(w);
    if (cached) out[w] = { status: 'ready', text: cached.text, at: cached.at };
  }
  return out;
}

/** The question the hand-off arrives with: the top action, in the user's voice. */
function askPrompt(action: Actionable): string {
  return `${action.ask} (From my analysis: ${action.detail})`;
}

function errorCopy(kind: ZenErrorKind): string {
  switch (kind) {
    case 'auth': return 'Sign in again to get your coach read-out. Every number below is still yours.';
    case 'rate-limit': return 'Zen has answered a lot today. Your analysis is all here — try the read-out again later.';
    case 'busy': return 'Zen is busy right now. Your analysis is all here — try the read-out again in a moment.';
    case 'network': return 'No connection to Zen. The numbers below come from your phone and are up to date.';
    default: return 'The read-out did not come through this time. Nothing below is affected — tap refresh to try again.';
  }
}

/* ------------------------------------------------------------------ *
 * Sections
 * ------------------------------------------------------------------ */

function StrengthSection({ report, onOpenExercise, onInfo }: {
  report: AnalysisReport;
  onOpenExercise: (key: string) => void;
  onInfo: () => void;
}) {
  const { exercises } = report.strength;
  if (exercises.length === 0) return null;

  return (
    <section className="space-y-2">
      <SectionHeader caption="Strength" trailing={{ label: 'What this means', onClick: onInfo }} />
      <Card padding="none">
        <div className="divide-y divide-border">
          {exercises.map((ex) => (
            <button
              key={ex.key}
              type="button"
              onClick={() => onOpenExercise(ex.key)}
              className="w-full text-left px-4 py-3 flex items-center gap-3 transition-colors hover:bg-surface-2"
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm font-bold text-text truncate">{ex.name}</div>
                <div className="text-xs text-muted">
                  {num(ex.latest)} kg estimated max · {ex.sessions} sessions
                  {ex.plateau ? ' · plateau' : ''}
                </div>
              </div>
              <Sparkline values={ex.points.map((p) => p.e1rm)} status={ex.status} />
              <span className={`text-[13px] font-bold tabular-nums shrink-0 ${
                ex.status === 'improving' ? 'text-ok' : ex.status === 'declining' ? 'text-danger' : 'text-muted'
              }`}>
                {ex.changePct == null ? '—' : `${signed(ex.changePct)}%`}
              </span>
              <ChevronRight className="w-4 h-4 shrink-0 text-subtle" />
            </button>
          ))}
        </div>
      </Card>
    </section>
  );
}

function BalanceSection({ report, onInfo }: { report: AnalysisReport; onInfo: () => void }) {
  const { groups, flags, unmatchedVolume } = report.balance;
  if (groups.length === 0) return null;

  return (
    <section className="space-y-2">
      <SectionHeader caption="Muscle balance" trailing={{ label: 'What this means', onClick: onInfo }} />
      <Card>
        <BalanceBars groups={groups} />
        {flags.length > 0 && (
          <div className="mt-3 pt-3 border-t border-border space-y-1.5">
            {flags.map((f) => (
              <p key={`${f.kind}-${f.tag}`} className="text-[13px] leading-[18px] text-warn">
                <span className="font-bold">{f.title}.</span> <span className="text-muted">{f.detail}</span>
              </p>
            ))}
          </div>
        )}
        {unmatchedVolume > 0 && (
          <p className="text-[11px] text-subtle mt-3">
            {fmtVolume(unmatchedVolume)} kg came from exercises that are not in your library, so they have no muscle group to count towards.
          </p>
        )}
      </Card>
    </section>
  );
}

function ConsistencySection({ report, nextDay, onStartDay, onInfo }: {
  report: AnalysisReport;
  nextDay: { index: number; name: string } | null;
  onStartDay: (dayIndex: number) => void;
  onInfo: () => void;
}) {
  const c = report.consistency;
  return (
    <section className="space-y-2">
      <SectionHeader caption="Consistency" trailing={{ label: 'What this means', onClick: onInfo }} />
      <Card>
        <HistoryBars
          caption="Days trained each week"
          points={lastFew(c.weeks).map((w) => ({ label: fmtShort(`${w.start}T00:00:00`), value: w.days }))}
          format={(v) => `${v} day${v === 1 ? '' : 's'}`}
          tone={c.adherencePct >= 80 ? 'ok' : 'accent'}
        />
        <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2">
          <Fact label="Kept to the plan" value={`${c.adherencePct}%`} />
          <Fact label="Weeks on target" value={`${c.weeksMet} of ${c.weeksCounted}`} />
          <Fact label="Longest gap" value={`${c.longestGapDays} day${c.longestGapDays === 1 ? '' : 's'}`} />
          <Fact
            label="Usual days"
            value={c.topDays.length ? c.topDays.map((d) => d.label.slice(0, 3)).join(', ') : '—'}
          />
        </div>
        {c.topHour != null && (
          <p className={`${SUB} mt-3`}>Most sessions start around {formatHour(c.topHour)}.</p>
        )}
        {nextDay && (
          <Button variant="secondary" size="sm" full className="mt-3" onClick={() => onStartDay(nextDay.index)}>
            Start {nextDay.name}
          </Button>
        )}
      </Card>
    </section>
  );
}

function RecoverySection({ report, onInfo }: { report: AnalysisReport; onInfo: () => void }) {
  const r = report.recovery;
  if (r.risingStreak === 0 && r.lightSessions.length === 0) return null;

  return (
    <section className="space-y-2">
      <SectionHeader caption="Recovery" trailing={{ label: 'What this means', onClick: onInfo }} />
      <Card tone={r.recommendDeload ? 'warn' : 'default'}>
        <p className="text-sm text-text">
          {r.recommendDeload
            ? `Your weekly volume has risen ${r.risingStreak} weeks in a row. A week at about ${fmtVolume(r.targetVolume)} kg lets the block land.`
            : r.risingStreak > 0
              ? `Weekly volume has risen ${r.risingStreak} week${r.risingStreak === 1 ? '' : 's'} in a row. Nothing to act on yet.`
              : 'Weekly volume is steady.'}
        </p>
        {r.lightSessions.length > 0 && (
          <div className="mt-3 pt-3 border-t border-border space-y-1.5">
            <p className={CAPTION}>Sessions well under your usual</p>
            {r.lightSessions.map((s) => (
              <div key={`${s.date}-${s.name}`} className="flex items-center justify-between gap-2 text-[13px]">
                <span className="text-muted truncate">{s.name} · {fmtShort(`${s.date}T00:00:00`)}</span>
                <span className="font-bold tabular-nums text-warn shrink-0">{Math.round(s.ratio * 100)}%</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </section>
  );
}

function ActionablesSection({ report, onOpen }: { report: AnalysisReport; onOpen: (id: string) => void }) {
  const actions = report.actionables;

  return (
    <section className="space-y-2">
      <SectionHeader caption="What to do next" />
      {actions.length === 0 ? (
        <Card><p className="text-sm text-muted">Nothing is out of place in this window. Keep the plan and keep turning up.</p></Card>
      ) : (
        <Card padding="none">
          <div className="divide-y divide-border">
            {actions.map((a, i) => (
              <button
                key={a.id}
                type="button"
                onClick={() => onOpen(a.id)}
                className="w-full text-left px-4 py-3 flex items-start gap-3 transition-colors hover:bg-surface-2"
              >
                <span className="w-6 h-6 shrink-0 mt-0.5 rounded-full bg-accent-soft text-accent text-xs font-bold flex items-center justify-center tabular-nums">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold text-text">{a.title}</span>
                  <span className="block text-[13px] leading-[18px] text-muted mt-0.5">{a.detail}</span>
                </span>
                <ChevronRight className="w-4 h-4 shrink-0 mt-1 text-subtle" />
              </button>
            ))}
          </div>
        </Card>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Sheets
 * ------------------------------------------------------------------ */

function AnalysisSheet({ sheet, report, onClose, onAskZen }: {
  sheet: SheetState | null;
  report: AnalysisReport;
  onClose: () => void;
  onAskZen?: (prompt: string) => void;
}) {
  if (!sheet) return null;

  if (sheet.kind === 'action') {
    const action = report.actionables.find((a) => a.id === sheet.id);
    if (!action) return null;
    return (
      <MetricSheet
        open
        onClose={onClose}
        explainer={{ title: action.title, meaning: action.detail, method: action.method, good: action.good }}
      >
        {onAskZen && (
          <Button
            variant="primary"
            size="md"
            full
            onClick={() => { onClose(); onAskZen(askPrompt(action)); }}
          >
            Ask Zen about this
          </Button>
        )}
      </MetricSheet>
    );
  }

  if (sheet.kind === 'exercise') {
    const ex = report.strength.exercises.find((e) => e.key === sheet.key);
    if (!ex) return null;
    return (
      <MetricSheet
        open
        onClose={onClose}
        explainer={{ ...EXPLAINERS.strength, title: ex.name, value: `${num(ex.latest)} kg` }}
      >
        <ExerciseDetail ex={ex} />
      </MetricSheet>
    );
  }

  const metric = sheet.metric;
  return (
    <MetricSheet
      open
      onClose={onClose}
      explainer={{ ...EXPLAINERS[metric], value: metricValue(metric, report) }}
    >
      {metric === 'volume' && (
        <HistoryBars
          caption="Weight lifted each week"
          points={lastFew(report.load.weeks).map((w) => ({ label: fmtShort(`${w.start}T00:00:00`), value: w.volume }))}
          format={(v) => `${fmtVolume(v)} kg`}
        />
      )}
      {metric === 'sessions' && (
        <div className="rounded-card border border-border bg-surface-2 p-3 space-y-2">
          <Fact label="Training days counted" value={String(report.consistency.trainingDays)} />
          <Fact label="Finished weeks" value={String(report.consistency.weeksCounted)} />
          <Fact label="Committed days a week" value={String(report.consistency.commitment)} />
          {report.load.avgDurationMin != null && (
            <Fact label="Average session" value={`${report.load.avgDurationMin} min`} />
          )}
        </div>
      )}
      {metric === 'prs' && (
        report.strength.prs.length === 0 ? (
          <p className={SUB}>No new bests in this window.</p>
        ) : (
          <div className="rounded-card border border-border bg-surface-2 p-3 space-y-2">
            {report.strength.prs.slice(0, 10).map((pr) => (
              <Fact
                key={`${pr.key}-${pr.date}`}
                label={`${pr.name} · ${fmtShort(`${pr.date}T00:00:00`)}`}
                value={`${num(pr.weight)} kg × ${pr.reps}`}
              />
            ))}
          </div>
        )
      )}
      {metric === 'balance' && <BalanceBars groups={report.balance.groups} />}
      {metric === 'consistency' && (
        <div className="rounded-card border border-border bg-surface-2 p-3 space-y-2">
          <Fact label="Kept to the plan" value={`${report.consistency.adherencePct}%`} strong />
          <Fact label="Weeks on target" value={`${report.consistency.weeksMet} of ${report.consistency.weeksCounted}`} />
          <Fact label="Longest gap without training" value={`${report.consistency.longestGapDays} days`} />
          {report.consistency.daysSinceLast != null && (
            <Fact label="Since your last session" value={`${report.consistency.daysSinceLast} days`} />
          )}
        </div>
      )}
      {metric === 'recovery' && (
        <HistoryBars
          caption="Weight lifted, last four weeks"
          points={report.recovery.weeklyVolumes.map((v, i, all) => ({
            label: i === all.length - 1 ? 'This week' : `${all.length - 1 - i}w ago`,
            value: v,
          }))}
          format={(v) => `${fmtVolume(v)} kg`}
          tone={report.recovery.recommendDeload ? 'accent' : 'ok'}
        />
      )}
    </MetricSheet>
  );
}

function metricValue(metric: MetricKey, report: AnalysisReport): string | undefined {
  switch (metric) {
    case 'volume': return `${fmtVolume(report.load.totalVolume)} kg`;
    case 'sessions': return `${num(report.load.sessionsPerWeek)} a week`;
    case 'prs': return String(report.strength.prs.length);
    case 'consistency': return `${report.consistency.adherencePct}%`;
    case 'balance': return report.balance.groups[0] ? `${report.balance.groups[0].label} leads` : undefined;
    case 'recovery': return report.recovery.risingStreak > 0 ? `${report.recovery.risingStreak} weeks up` : 'Steady';
    default: return undefined;
  }
}

function ExerciseDetail({ ex }: { ex: ExerciseStrength }) {
  return (
    <div className="space-y-3">
      <HistoryBars
        caption="Estimated one-rep max per session"
        points={lastFew(ex.points).map((p) => ({ label: fmtShort(`${p.date}T00:00:00`), value: p.e1rm }))}
        format={(v) => `${num(v)} kg`}
        tone={ex.status === 'declining' ? 'accent' : 'ok'}
      />
      <div className="rounded-card border border-border bg-surface-2 p-3 space-y-2">
        <Fact label="First session in window" value={`${num(ex.first)} kg`} />
        <Fact label="Best" value={`${num(ex.best)} kg`} strong />
        <Fact label="Latest" value={`${num(ex.latest)} kg`} />
        <Fact label="Sessions since that best" value={String(ex.sessionsSinceBest)} />
      </div>
      {ex.plateau && (
        <p className="text-[13px] leading-[18px] text-warn">
          No new best in {ex.sessionsSinceBest} sessions. Three weeks in a different rep range usually gets it moving again.
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Small parts
 * ------------------------------------------------------------------ */

/** Bars thinner than a fingertip say nothing. All-time history gets its
 *  most recent stretch drawn rather than every week since day one. */
const MAX_BARS = 16;
function lastFew<T>(items: T[]): T[] {
  return items.length > MAX_BARS ? items.slice(-MAX_BARS) : items;
}

function Fact({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2 min-w-0">
      <span className="text-[13px] text-muted truncate">{label}</span>
      <span className={`text-[13px] tabular-nums shrink-0 ${strong ? 'font-bold text-text' : 'font-semibold text-text'}`}>{value}</span>
    </div>
  );
}

function BalanceBars({ groups }: { groups: GroupShare[] }) {
  const max = Math.max(1, ...groups.map((g) => g.share));
  return (
    <div className="space-y-2">
      {groups.map((g) => (
        <div key={g.group} className="flex items-center gap-2.5">
          <span className="w-20 shrink-0 text-[13px] text-muted truncate">{g.label}</span>
          <span className="flex-1 h-2 rounded-full bg-surface-2 overflow-hidden">
            <span
              className="block h-full rounded-full bg-accent"
              style={{ width: `${Math.max((g.share / max) * 100, 2)}%` }}
            />
          </span>
          <span className="w-9 shrink-0 text-right text-[13px] font-bold tabular-nums text-text">
            {Math.round(g.share)}%
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * The strength trend, 64 × 20. Hand-rolled rather than pulling a chart
 * library in for one polyline — the same call `InsightCard` made.
 */
function Sparkline({ values, status }: { values: number[]; status: ExerciseStrength['status'] }) {
  if (values.length < 2) return <span className="w-16 shrink-0" />;
  const w = 64;
  const h = 20;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values
    .map((v, i) => `${(i / (values.length - 1)) * w},${h - ((v - min) / span) * (h - 2) - 1}`)
    .join(' ');
  const stroke = status === 'improving' ? 'text-ok' : status === 'declining' ? 'text-danger' : 'text-subtle';

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className={`shrink-0 ${stroke}`} aria-hidden>
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** "7 pm" / "6:30 am" — an hour a person would say out loud. */
function formatHour(hour: number): string {
  const suffix = hour < 12 ? 'am' : 'pm';
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve} ${suffix}`;
}

/**
 * The plan day the app would start next — the same "Next" day the old
 * schedule list marked, skipping rest days. Keeps this screen's one
 * direct action (`onStartDay`) working now that the day-by-day schedule
 * has moved off it.
 */
function findNextDay(): { index: number; name: string } | null {
  const plan = storage.getActivePlan();
  if (!plan || plan.days.length === 0) return null;
  const start = storage.getLastUsedDay() ?? 0;
  for (let step = 0; step < plan.days.length; step++) {
    const index = (start + step) % plan.days.length;
    const day = plan.days[index];
    if (!day.isRestDay && day.exercises.length > 0) return { index, name: day.name };
  }
  return null;
}
