import { useEffect, useState } from 'react';
import { Footprints } from 'lucide-react';
import { getActivityDay, localDateISO, subscribeHealth } from '../../health/store';
import { formatSleep } from '../../activity';
import { Card, CAPTION, STAT, SUB } from '../../ui';

/** Compact today's-activity row for the Health tab. Cache only — no Firestore read. */
export function ActivityCard({ onOpen }: { onOpen: () => void }) {
  const [, bumpVersion] = useState(0);
  useEffect(() => subscribeHealth(() => bumpVersion((n) => n + 1)), []);

  const day = getActivityDay(localDateISO());
  const empty = day.steps === undefined && day.sleepMin === undefined && day.activeKcal === undefined;

  return (
    <Card onClick={onOpen}>
      <div className="flex items-center gap-2 mb-2">
        <Footprints className="w-4 h-4 text-accent" strokeWidth={1.75} />
        <span className={CAPTION}>Activity today</span>
      </div>
      {empty ? (
        <p className={SUB}>Connect Health Connect or log steps, sleep and calories by hand.</p>
      ) : (
        <div className="flex items-end gap-5">
          <Metric value={day.steps?.toLocaleString('en-IN') ?? '—'} label="steps" />
          <Metric value={day.sleepMin !== undefined ? formatSleep(day.sleepMin) : '—'} label="sleep" />
          <Metric value={day.activeKcal !== undefined ? String(day.activeKcal) : '—'} label="kcal" />
        </div>
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
