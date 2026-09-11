import { useMemo, useState } from 'react';
import { ArrowLeft, ChevronRight, RefreshCw } from 'lucide-react';
import type { GymViewProps } from './types';
import type { GymEquipment } from '../../types';
import { useGym } from '../../gym/GymContext';
import { useAuth } from '../../auth/AuthContext';
import { isAdmin } from '../../admin';
import { computeDashboard } from '../../gymService';
import { useGymOps, type GymOpsData } from '../../gym/useGymOps';
import {
  acquisitionChurnSeries, clvCac, computeMrr, equipmentHealth, formatInr, mrrSeries, revenueByMonth,
  revenueSplit, slippingAway, trainerUtilisation,
} from '../../gym/gymOps';
import { Avatar } from '../../components';
import { Button, Card, IconButton, Skeleton } from '../../ui';
import { CAPTION, H1, SUB } from '../../ui/styles';
import { HistoryBars, MetricSheet } from '../../components/gym/ops/MetricSheet';
import type { MetricExplainer } from '../../components/gym/ops/MetricSheet';
import type { FacilityMetric } from '../../components/gym/ops/FacilityList';
import { KpiTile } from '../../components/gym/ops/KpiTile';
import { AcquisitionChurnChart } from '../../components/gym/ops/AcquisitionChurnChart';
import { RevenueDonut } from '../../components/gym/ops/RevenueDonut';
import { FacilityList } from '../../components/gym/ops/FacilityList';
import { EquipmentSection } from '../../components/gym/ops/EquipmentSection';

type Metric = 'mrr' | 'clv' | 'slipping' | 'acquisition' | 'revenue' | FacilityMetric;

/**
 * Plain-language cards for every number on the screen. Written for an owner
 * who has never read a SaaS dashboard: what it means, how we counted it,
 * what to aim for. Copy, not code — keep it honest about our data.
 */
const EXPLAINERS: Record<Metric, Omit<MetricExplainer, 'value'>> = {
  mrr: {
    title: 'Monthly recurring revenue',
    meaning: 'The money your current memberships bring in per month. A ₹6,000 three-month plan counts as ₹2,000 a month. It is the size of the business today, before any new joins.',
    method: 'Every member on a live plan contributes their plan price divided by its months. The change compares that total with the same sum for the roster as it stood 30 days ago.',
    good: 'Steady or rising month on month. A dip means plans are ending faster than they are renewed — check Slipping and the churn chart.',
  },
  clv: {
    title: 'Customer lifetime value',
    meaning: 'What one member is worth to you over the whole time they stay, and — once you enter what you spend on marketing — how that compares with what it costs to win each new member.',
    method: 'Average monthly revenue per active member (last 90 days) × how long members stay on average, in months. Cost per new member is your monthly marketing spend ÷ members joined in the last 30 days.',
    good: 'Lifetime value should be 3–5× the cost to acquire. Under 1× you are paying more to win members than they bring in; over 5× you could grow faster by spending more.',
  },
  slipping: {
    title: 'Members slipping away',
    meaning: 'People who were coming regularly and have dropped to less than half their usual visits. They have not left yet — this is the window to call them.',
    method: 'For every active member we compare check-ins in the last 30 days with the 30 days before. Fewer than half, with at least two visits in the earlier month, counts as slipping. Exactly half does not.',
    good: 'Zero. Each name here is a renewal at risk; a message this week usually brings them back.',
  },
  acquisition: {
    title: 'Acquisition vs churn',
    meaning: 'How many members joined each month, against how many let their plan lapse. Orange above the line is growth, red below is loss; the net figure is the difference.',
    method: 'Joined is by sign-up date. Churned is members whose plan ended in that month, more than a week ago, and who have not renewed — so somebody who lapsed last Friday is not written off yet. Staff are not counted.',
    good: 'Orange taller than red every month. When red starts catching up, look at who is slipping before they lapse.',
  },
  revenue: {
    title: 'Revenue split',
    meaning: 'Where the money actually came from over the last 90 days: memberships, personal training, and everything else (merchandise, supplements, day passes).',
    method: 'Every payment recorded in the window, grouped by its category. Payments recorded before categories existed count as membership. Advance renewals dated in the future are left out until they fall due.',
    good: 'Most gyms live on memberships; growing the other two slices is how revenue grows without adding members. Set the category when you record a payment to see it here.',
  },
  trainers: {
    title: 'Trainer class utilisation',
    meaning: 'Of the classes on the timetable in the last four weeks, how many actually ran with someone attending — per trainer.',
    method: 'Sessions where at least one member was marked attended, divided by sessions the timetable scheduled. Only classes assigned to a trainer are counted. This is class utilisation, not personal-training hours.',
    good: 'Above 80%. A class that keeps running empty is a slot to move or a trainer to redeploy.',
  },
  classFill: {
    title: 'Class fill rate',
    meaning: 'How full your classes are: average enrolment against capacity, over the last four weeks.',
    method: 'For each class with a capacity, average enrolled ÷ capacity across its sessions. Classes without a capacity show attendance only.',
    good: 'Around 80–90%. Consistently full classes are a signal to add a second slot; consistently half-empty ones to merge or reschedule.',
  },
  equipment: {
    title: 'Equipment asset health',
    meaning: 'How much of your opening time the machines you track were usable. Mark a machine down when it breaks and back up when it is fixed; the time in between counts against uptime.',
    method: 'Uptime is 1 − downtime ÷ (30 days × 16 opening hours) across the machines you have added. Downtime is cumulative since a machine was added, capped at one window per machine.',
    good: 'Above 95%. Anything under 85% is a machine members notice.',
  },
};

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

  /** Which explainer is open. */
  const [openMetric, setOpenMetric] = useState<Metric | null>(null);
  // The same average FacilityList draws, so the sheet's headline matches the row.
  const classFillRate = useMemo(() => {
    const capped = (metrics?.classFill ?? []).filter((c) => c.capacity && c.capacity > 0);
    return capped.length ? capped.reduce((sum, c) => sum + c.avgEnrolled / (c.capacity as number), 0) / capped.length : null;
  }, [metrics]);
  const history = useMemo(() => {
    if (!gym || !data) return null;
    const now = new Date();
    return { mrr: mrrSeries(data.members, gym.plans, now), revenue: revenueByMonth(data.payments, now) };
  }, [gym, data]);

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
              onClick={() => setOpenMetric('mrr')}
            />
            <KpiTile
              eyebrow={metrics.value.ratio ? 'CLV : CAC' : 'CLV'}
              value={metrics.value.ratio ? `${metrics.value.ratio.toFixed(1)}×` : formatInr(metrics.value.clv)}
              tone={metrics.value.ratio ? ratioTone(metrics.value.ratio) : 'default'}
              onClick={() => setOpenMetric('clv')}
              sub={metrics.value.ratio ? 'ideal 3–5×' : 'per member'}
            />
            <KpiTile
              eyebrow="Slipping"
              value={metrics.slipping.members.length}
              tone={metrics.slipping.members.length > 0 ? 'warn' : 'default'}
              sub={`of ${metrics.slipping.activeCount} active`}
              onClick={() => setOpenMetric('slipping')}
            />
          </div>

          <p className={`${SUB} px-0.5`}>Tap any number for what it means and where it came from.</p>

          <AcquisitionChurnChart series={metrics.series} onInfo={() => setOpenMetric('acquisition')} />

          <RevenueDonut split={metrics.split} onInfo={() => setOpenMetric('revenue')} />

          <FacilityList trainers={metrics.trainers} classFill={metrics.classFill} equipment={health} onInfo={setOpenMetric} />

          <EquipmentSection gymId={gym.id} equipment={equipment} canEdit={canView} onChange={setEquipment} />

          {openMetric && history && (
            <MetricSheet
              open
              onClose={() => setOpenMetric(null)}
              explainer={{
                ...EXPLAINERS[openMetric],
                value:
                  openMetric === 'mrr' ? formatInr(metrics.mrr.mrr)
                  : openMetric === 'clv' ? (metrics.value.ratio ? `${metrics.value.ratio.toFixed(1)}×` : formatInr(metrics.value.clv))
                  : openMetric === 'slipping' ? `${metrics.slipping.members.length} of ${metrics.slipping.activeCount}`
                  : openMetric === 'trainers' && metrics.trainers.scheduled > 0 ? `${Math.round(metrics.trainers.utilisation * 100)}%`
                  : openMetric === 'classFill' && classFillRate != null ? `${Math.round(classFillRate * 100)}%`
                  : openMetric === 'equipment' && health.machines > 0 ? `${Math.round(health.health * 100)}%`
                  : undefined,
              }}
            >
              {openMetric === 'mrr' && (
                <HistoryBars caption="Month by month" points={history.mrr.map((p) => ({ label: p.month, value: p.value }))} format={formatInr} />
              )}

              {openMetric === 'clv' && (
                <div className="rounded-card border border-border bg-surface-2 p-3 space-y-2">
                  <Factor label="Revenue per member per month" value={formatInr(metrics.value.arpu)} />
                  <Factor label="Average stay" value={`${metrics.value.tenureMonths.toFixed(1)} months`} />
                  <Factor label="Lifetime value" value={formatInr(metrics.value.clv)} strong />
                  <div className="border-t border-border pt-2">
                    {metrics.value.cac != null ? (
                      <Factor label={`Cost per new member · ${metrics.value.newMembers30d} joined in 30 days`} value={formatInr(metrics.value.cac)} />
                    ) : (
                      <>
                        <p className={SUB}>Enter your monthly marketing spend and this becomes lifetime value against the cost of winning a member.</p>
                        <Button variant="secondary" size="sm" className="mt-2" onClick={() => onNavigate('gym-settings')}>Add marketing spend</Button>
                      </>
                    )}
                  </div>
                </div>
              )}

              {openMetric === 'slipping' && (
                metrics.slipping.rows.length === 0 ? (
                  <p className={SUB}>Nobody is slipping right now.</p>
                ) : (
                  <div className="rounded-card border border-border divide-y divide-border">
                    {metrics.slipping.rows.map(({ member, recent, earlier }) => (
                      <button
                        key={member.uid}
                        type="button"
                        onClick={() => onNavigate('gym-member', { memberUid: member.uid })}
                        className="w-full flex items-center gap-3 px-3 min-h-14 text-left hover:bg-surface-2/40"
                      >
                        <Avatar name={member.name} photoURL={member.photoURL} size="sm" />
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm font-semibold text-text truncate">{member.name}</span>
                          <span className="block text-xs text-muted">{recent} visit{recent === 1 ? '' : 's'} this month · {earlier} the month before</span>
                        </span>
                        <ChevronRight className="w-4 h-4 text-subtle shrink-0" strokeWidth={1.75} />
                      </button>
                    ))}
                  </div>
                )
              )}

              {openMetric === 'revenue' && (
                <HistoryBars caption="Paid in, month by month" points={history.revenue.map((p) => ({ label: p.month, value: p.total }))} format={formatInr} />
              )}

              {/* Joined, not net: bars cannot go below the line, and a month that
                  lost members must not read as a small gain. The chart itself
                  already shows both directions. */}
              {openMetric === 'acquisition' && (
                <HistoryBars caption="Joined, month by month" points={metrics.series.map((p) => ({ label: p.month, value: p.new }))} format={(v) => `${Math.round(v)} joined`} />
              )}

              {openMetric === 'equipment' && health.machines > 0 && (
                <p className={SUB}>{health.machines} machine{health.machines === 1 ? '' : 's'} tracked · {health.down} down now · {Math.round(health.downtimeMin / 60)} h of downtime counted.</p>
              )}
            </MetricSheet>
          )}
        </>
      )}
    </div>
  );
}

function Factor({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs text-muted min-w-0">{label}</span>
      <span className={`tabular-nums shrink-0 ${strong ? 'text-[15px] font-bold text-text' : 'text-sm font-semibold text-text'}`}>{value}</span>
    </div>
  );
}
