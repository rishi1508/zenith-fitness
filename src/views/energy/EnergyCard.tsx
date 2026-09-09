import { useEffect, useState } from 'react';
import { Flame } from 'lucide-react';
import { energyForDay } from '../../health/energyDay';
import { subscribeHealth } from '../../health/store';
import { Card, CAPTION, STAT, SUB } from '../../ui';

/**
 * Today's energy in one line: out, in, and the gap. Cache only — the whole
 * ledger is computed from localStorage, so this costs no reads.
 */
export function EnergyCard({ onOpen }: { onOpen: () => void }) {
  const [, bumpVersion] = useState(0);
  useEffect(() => subscribeHealth(() => bumpVersion((n) => n + 1)), []);

  const day = energyForDay();
  const balance = day.balanceKcal;

  return (
    <Card onClick={onOpen}>
      <div className="flex items-center gap-2 mb-2">
        <Flame className="w-4 h-4 text-accent" strokeWidth={1.75} />
        <span className={CAPTION}>Energy today</span>
      </div>
      {day.totalKcal == null ? (
        <p className={SUB}>Add your height, age and sex in the health profile and we can work out what you burn.</p>
      ) : (
        <>
          <div className="flex items-end gap-5">
            <Metric value={day.totalKcal.toLocaleString('en-IN')} label="burned" />
            <Metric value={day.intakeKcal ? day.intakeKcal.toLocaleString('en-IN') : '—'} label="eaten" />
            <Metric
              value={balance == null || !day.intakeKcal ? '—' : `${balance > 0 ? '+' : ''}${balance.toLocaleString('en-IN')}`}
              label="balance"
            />
          </div>
          <p className={`${SUB} mt-2`}>
            {day.restingKcal?.toLocaleString('en-IN')} resting
            {day.workoutKcal > 0 && ` · ${day.workoutKcal} training`}
            {day.activeSource === 'device' ? ' · active from your phone' : day.stepsKcal > 0 ? ` · ${day.stepsKcal} moving` : ''}
          </p>
        </>
      )}
    </Card>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col min-w-0">
      <span className={`${STAT} text-text truncate`}>{value}</span>
      <span className="text-xs text-muted">{label}</span>
    </div>
  );
}
