import { useEffect, useMemo, useState } from 'react';
import { TrendingUp } from 'lucide-react';
import * as storage from '../../storage';
import { getPhaseSettings, subscribeHealth } from '../../health';
import { classifyPhase, evaluateGoal, weeksElapsed, weightTrend } from '../../phase';
import { Card, Pill, CAPTION, SUB } from '../../ui';
import { GOAL_LABEL, STATUS_LABEL, STATUS_TONE, rateBadge } from './status';

const RATE_WINDOW_DAYS = 14;

/**
 * Compact phase row for the Health tab (docs/HEALTH_SPEC.md §5):
 * current phase · weekly rate · status pill. Reads only localStorage.
 */
export function PhaseCard({ onOpen }: { onOpen: () => void }) {
  const [settings, setSettings] = useState(getPhaseSettings);
  useEffect(() => subscribeHealth(() => setSettings(getPhaseSettings())), []);

  const trend = useMemo(() => weightTrend(storage.getBodyWeightEntries(), { days: RATE_WINDOW_DAYS }), []);
  const evaluation = settings ? evaluateGoal(settings, trend, weeksElapsed(settings)) : null;
  const phase = settings?.goal ?? (trend.status === 'ok' ? classifyPhase(trend.ratePctPerWeek) : null);
  const subLine = trend.status !== 'ok'
    ? 'Log a few weigh-ins to read your trend'
    : evaluation ? evaluation.headline : 'Set a goal to track it';

  return (
    <Card onClick={onOpen}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <span className={CAPTION}>Weight &amp; phase</span>
          <p className="text-[15px] leading-[22px] font-semibold text-text mt-1 truncate">
            {phase ? GOAL_LABEL[phase] : 'No phase set'}
            {trend.status === 'ok' && ` · ${rateBadge(trend.rateKgPerWeek, trend.ratePctPerWeek)} /week`}
          </p>
          <p className={`${SUB} truncate`}>{subLine}</p>
        </div>
        {evaluation ? (
          <Pill tone={STATUS_TONE[evaluation.status]}>{STATUS_LABEL[evaluation.status]}</Pill>
        ) : (
          <Pill tone="neutral" icon={TrendingUp}>Set up</Pill>
        )}
      </div>
    </Card>
  );
}
