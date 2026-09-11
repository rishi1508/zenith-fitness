import { useMemo, useState } from 'react';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import type { GymViewProps } from './types';
import type { GymEquipment } from '../../types';
import { useGym } from '../../gym/GymContext';
import { useAuth } from '../../auth/AuthContext';
import { isAdmin } from '../../admin';
import { computeDashboard } from '../../gymService';
import { useGymOps, type GymOpsData } from '../../gym/useGymOps';
import {
  acquisitionChurnSeries, clvCac, computeMrr, equipmentHealth, formatInr, revenueSplit,
  slippingAway, trainerUtilisation,
} from '../../gym/gymOps';
import { Card, IconButton, Skeleton } from '../../ui';
import { CAPTION, H1 } from '../../ui/styles';
import { KpiTile } from '../../components/gym/ops/KpiTile';
import { AcquisitionChurnChart } from '../../components/gym/ops/AcquisitionChurnChart';
import { RevenueDonut } from '../../components/gym/ops/RevenueDonut';
import { FacilityList } from '../../components/gym/ops/FacilityList';
import { EquipmentSection } from '../../components/gym/ops/EquipmentSection';

/** The healthy band the industry quotes for CLV:CAC. */
function ratioTone(ratio: number): 'ok' | 'warn' | 'danger' {
  if (ratio >= 3) return 'ok';
  return ratio >= 1 ? 'warn' : 'danger';
}

/**
 * GymOps analytics — the owner's business screen: what recurs, what it
 * costs to win a member, who is drifting, where the money comes from and
 * how hard the building works. One load per open (useGymOps), every
 * number from a pure function in gymOps.ts.
 */
export function GymOpsView({ onBack, onNavigate }: GymViewProps) {
  const { gym, role } = useGym();
  const { user } = useAuth();
  // Everyone who can open this screen can also flip a machine — rules
  // grant equipment writes to the same manager-and-up set.
  const canView = role === 'owner' || role === 'manager' || isAdmin(user?.uid);

  const { data, loading, error, refresh } = useGymOps(gym?.id, canView);

  // Equipment is the one thing this screen writes. Local edits are kept
  // against the load they came from, so a refresh drops them for the
  // server's copy without an effect chasing the data.
  const [edits, setEdits] = useState<{ from: GymOpsData; list: GymEquipment[] } | null>(null);
  const equipment = useMemo(
    () => (edits && edits.from === data ? edits.list : data?.equipment ?? []),
    [edits, data],
  );
  const setEquipment = (next: GymEquipment[]) => { if (data) setEdits({ from: data, list: next }); };

  const metrics = useMemo(() => {
    if (!gym || !data) return null;
    const now = new Date();
    return {
      mrr: computeMrr(data.members, gym.plans, now),
      series: acquisitionChurnSeries(data.members, now),
      slipping: slippingAway(data.checkins, data.members, now),
      value: clvCac({
        members: data.members,
        payments90d: data.payments,
        marketingSpendMonthly: gym.marketingSpendMonthly,
        now,
      }),
      split: revenueSplit(data.payments, now),
      trainers: trainerUtilisation({
        classes: data.classes,
        sessions: data.sessions,
        members: data.members,
        staff: gym.staff,
        now,
      }),
      classFill: computeDashboard({
        members: data.members,
        dailyStats: [],
        payments90d: [],
        classes: data.classes,
        sessions7d: data.sessions,
        now,
      }).classFill,
    };
  }, [gym, data]);

  const health = useMemo(() => equipmentHealth(equipment), [equipment]);

  const header = (
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-center gap-2 min-w-0">
        <button
          aria-label="Back"
          onClick={onBack}
          className="w-10 h-10 -ml-2 shrink-0 flex items-center justify-center rounded-control text-muted hover:text-text transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="min-w-0">
          <h1 className={H1}>Analytics</h1>
          <p className={`${CAPTION} mt-0.5`}>Business health · last 12 months</p>
        </div>
      </div>
      {canView && <IconButton icon={RefreshCw} label="Refresh" onClick={refresh} disabled={loading} />}
    </div>
  );

  if (!canView) {
    return (
      <div className="space-y-4 animate-fadeIn">
        {header}
        <Card><p className="text-sm text-muted">Owners and managers only.</p></Card>
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-fadeIn">
      {header}

      {error && <Card tone="danger"><p className="text-sm text-danger">{error}</p></Card>}

      {!metrics && !error && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-[92px]" />)}
          </div>
          <Skeleton className="h-[248px]" />
          <Skeleton className="h-[300px]" />
        </div>
      )}

      {metrics && gym && (
        <>
          <div className="grid grid-cols-3 gap-2">
            <KpiTile
              eyebrow="MRR"
              value={formatInr(metrics.mrr.mrr)}
              changePct={metrics.mrr.changePct}
              changeLabel="vs 30d"
              sub="no prior month"
            />
            <KpiTile
              eyebrow={metrics.value.ratio ? 'CLV : CAC' : 'CLV'}
              value={metrics.value.ratio ? `${metrics.value.ratio.toFixed(1)}×` : formatInr(metrics.value.clv)}
              tone={metrics.value.ratio ? ratioTone(metrics.value.ratio) : 'default'}
              onClick={metrics.value.ratio ? undefined : () => onNavigate('gym-settings')}
              sub={
                metrics.value.ratio
                  ? 'ideal 3–5×'
                  : <span className="text-accent font-semibold">Add spend</span>
              }
            />
            <KpiTile
              eyebrow="Slipping"
              value={metrics.slipping.members.length}
              tone={metrics.slipping.members.length > 0 ? 'warn' : 'default'}
              sub={`of ${metrics.slipping.activeCount} active`}
            />
          </div>

          <p className="text-xs text-muted px-0.5">
            Change is against 30 days ago. Slipping counts members whose visits in the last 30 days
            fell under half the 30 days before — nothing stores that index, so it reports a count
            rather than a change.
            {metrics.value.ratio ? '' : ' Add a monthly marketing spend in gym settings to get CLV against CAC.'}
          </p>

          <AcquisitionChurnChart series={metrics.series} />

          <RevenueDonut split={metrics.split} />

          <FacilityList trainers={metrics.trainers} classFill={metrics.classFill} equipment={health} />

          <EquipmentSection gymId={gym.id} equipment={equipment} canEdit={canView} onChange={setEquipment} />
        </>
      )}
    </div>
  );
}
