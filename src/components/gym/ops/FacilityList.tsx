import { useState } from 'react';
import { ChevronDown, Info } from 'lucide-react';
import type { ReactNode } from 'react';
import { Card } from '../../../ui';
import { H2 } from '../../../ui/styles';
import type { DashboardStats } from '../../../types';
import type { EquipmentHealthResult, TrainerUtilisation } from '../../../gym/gymOps';

const WEEKDAY_LABEL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function pct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

/** Green above the target, amber near it, red below — uptime has a
 *  defined goal, so the meter carries the severity. */
function uptimeTone(health: number): string {
  if (health >= 0.95) return 'bg-ok';
  if (health >= 0.85) return 'bg-warn';
  return 'bg-danger';
}

interface RowProps {
  label: string;
  value: string;
  /** 0–1; drives the meter. */
  fill: number;
  meterClass?: string;
  sub: string;
  /** When given, the row becomes a disclosure for its breakdown. */
  detail?: ReactNode;
  /** Opens the metric's explainer. */
  onInfo?: () => void;
}

function FacilityRow({ label, value, fill, meterClass = 'bg-accent', sub, detail, onInfo }: RowProps) {
  const [open, setOpen] = useState(false);
  const body = (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-semibold text-text flex items-center gap-1 min-w-0">
          <span className="truncate">{label}</span>
          {detail && <ChevronDown className={`w-3.5 h-3.5 text-subtle shrink-0 ${open ? 'rotate-180' : ''}`} strokeWidth={2} />}
        </span>
        <span className="text-sm font-bold tabular-nums text-text shrink-0">{value}</span>
      </div>
      <div className="h-1.5 rounded-full bg-accent/15 overflow-hidden">
        <div className={`h-full rounded-full ${meterClass}`} style={{ width: `${Math.max(0, Math.min(1, fill)) * 100}%` }} />
      </div>
      <span className="text-xs text-muted">{sub}</span>
    </>
  );

  return (
    <div className="py-2.5">
      <div className="flex items-start gap-1">
        {detail ? (
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex-1 min-w-0 text-left flex flex-col gap-1.5 min-h-10">
            {body}
          </button>
        ) : (
          <div className="flex-1 min-w-0 flex flex-col gap-1.5">{body}</div>
        )}
        {onInfo && (
          // A sibling of the disclosure, never inside it — a button in a button is invalid.
          <button
            type="button"
            onClick={onInfo}
            aria-label={`About ${label}`}
            className="shrink-0 -mr-2 -mt-1.5 w-9 h-9 flex items-center justify-center rounded-control text-subtle hover:text-text"
          >
            <Info className="w-4 h-4" strokeWidth={2} />
          </button>
        )}
      </div>
      {detail && open && <div className="mt-2 pl-0.5 flex flex-col gap-1.5">{detail}</div>}
    </div>
  );
}

function BreakdownRow({ name, sub, value }: { name: string; sub: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <span className="min-w-0 truncate text-text">
        {name} <span className="text-subtle">· {sub}</span>
      </span>
      <span className="tabular-nums text-muted shrink-0">{value}</span>
    </div>
  );
}

/**
 * How hard the building works: the three operational ratios an owner can
 * act on this week. Each is labelled for what it really measures — class
 * utilisation is not PT-chair occupancy, and uptime is against opening
 * hours, not the clock.
 */
export type FacilityMetric = 'trainers' | 'classFill' | 'equipment';

export function FacilityList({
  trainers,
  classFill,
  equipment,
  onInfo,
}: {
  trainers: TrainerUtilisation;
  classFill: DashboardStats['classFill'];
  equipment: EquipmentHealthResult;
  /** Opens the explainer for one of the three rows. */
  onInfo?: (metric: FacilityMetric) => void;
}) {
  const capped = classFill.filter((c) => c.capacity && c.capacity > 0);
  const fillRate = capped.length
    ? capped.reduce((sum, c) => sum + c.avgEnrolled / (c.capacity as number), 0) / capped.length
    : 0;
  const avgAttended = classFill.length
    ? classFill.reduce((sum, c) => sum + c.avgAttended, 0) / classFill.length
    : 0;

  const ranSessions = trainers.trainers.reduce((sum, t) => sum + t.ran, 0);

  return (
    <Card>
      <h2 className={`${H2} mb-1`}>Facility</h2>
      <div className="divide-y divide-border">
        <FacilityRow
          onInfo={onInfo ? () => onInfo('trainers') : undefined}
          label="Trainer class utilisation"
          value={trainers.scheduled > 0 ? pct(trainers.utilisation) : '—'}
          fill={trainers.utilisation}
          sub={
            trainers.scheduled > 0
              ? `${ranSessions} of ${trainers.scheduled} timetabled classes ran · ${trainers.hoursPerWeek.toFixed(1)} h/week scheduled`
              : 'No classes assigned to a trainer yet'
          }
          detail={
            trainers.trainers.length > 0 ? (
              trainers.trainers.map((t) => (
                <BreakdownRow
                  key={t.uid}
                  name={t.name}
                  sub={t.scheduled > 0 ? `${t.ran}/${t.scheduled} ran · ${t.hoursPerWeek.toFixed(1)} h/wk` : 'no classes'}
                  value={t.scheduled > 0 ? pct(t.utilisation) : '—'}
                />
              ))
            ) : undefined
          }
        />

        <FacilityRow
          onInfo={onInfo ? () => onInfo('classFill') : undefined}
          label="Class fill rate"
          value={capped.length ? pct(fillRate) : '—'}
          fill={fillRate}
          sub={
            classFill.length === 0
              ? 'No classes on the timetable'
              : capped.length
                ? `${capped.length} of ${classFill.length} classes have a capacity · last 4 weeks`
                : `No capacity set, so attendance only — ${avgAttended.toFixed(1)} per class on average`
          }
          detail={
            classFill.length > 0 ? (
              classFill.map(({ cls, avgEnrolled, avgAttended: attended, capacity }) => (
                <BreakdownRow
                  key={cls.id}
                  name={cls.name}
                  sub={`${WEEKDAY_LABEL[cls.weekday]} ${cls.startTime} · ${attended.toFixed(1)} attending`}
                  value={capacity ? pct(avgEnrolled / capacity) : `${avgEnrolled.toFixed(1)} enrolled`}
                />
              ))
            ) : undefined
          }
        />

        <FacilityRow
          onInfo={onInfo ? () => onInfo('equipment') : undefined}
          label="Equipment asset health"
          value={equipment.machines > 0 ? pct(equipment.health) : '—'}
          fill={equipment.machines > 0 ? equipment.health : 0}
          meterClass={uptimeTone(equipment.health)}
          sub={
            equipment.machines === 0
              ? 'No machines tracked yet'
              : `${equipment.machines} machine${equipment.machines === 1 ? '' : 's'} · ${equipment.down} down now · uptime against ${equipment.openHoursPerDay} h/day over ${equipment.windowDays} days`
          }
        />
      </div>
    </Card>
  );
}
