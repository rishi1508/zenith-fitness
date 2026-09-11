import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
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
}

function FacilityRow({ label, value, fill, meterClass = 'bg-accent', sub, detail }: RowProps) {
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
      {detail ? (
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="w-full text-left flex flex-col gap-1.5 min-h-10">
          {body}
        </button>
      ) : (
        <div className="flex flex-col gap-1.5">{body}</div>
      )}
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
export function FacilityList({
  trainers,
  classFill,
  equipment,
}: {
  trainers: TrainerUtilisation;
  classFill: DashboardStats['classFill'];
  equipment: EquipmentHealthResult;
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
