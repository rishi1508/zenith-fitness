import { useMemo, useState } from 'react';
import {
  ArrowLeft, ChevronDown, ChevronUp, Search, Dumbbell, BookOpen, TrendingUp, TrendingDown, Minus, Sparkles,
} from 'lucide-react';
import type { WeeklySummary } from '../../coachService';
import { buildCoachReport } from '../../coachService';
import { InsightCard } from '../../components';
import { findFormCues, listFormCuesByGroup, type FormCueEntry } from '../../coachFormCues';
import { useAuth } from '../../auth/AuthContext';
import { Card, IconButton, Chip, SectionHeader, EmptyState, H2, STAT, CAPTION, SUB } from '../../ui';

interface InsightsViewProps {
  isDark: boolean;
  onBack: () => void;
}

/**
 * Restyled `CoachView` — deterministic insights only (no chat/BYOK
 * parts, see `ZenChatView` for that). Runs `buildCoachReport()` over
 * local data: weekly summary, ranked insight feed, form cues lookup.
 */
export function InsightsView({ isDark, onBack }: InsightsViewProps) {
  const { user } = useAuth();
  const [report] = useState(() => buildCoachReport());

  return (
    <div className="space-y-4 animate-fadeIn">
      <div className="flex items-center gap-3">
        <IconButton icon={ArrowLeft} label="Back" onClick={onBack} />
        <h1 className={H2}>Insights</h1>
      </div>

      <Greeting userName={user?.displayName?.split(' ')[0]} />

      <WeeklySummaryCard summary={report.weekly} />

      {!report.hasEnoughData ? (
        <EmptyState
          icon={Dumbbell}
          title="Log a few sessions first"
          body="I need at least 3 completed workouts before I can spot trends. Get a few sessions in and check back — I'll have plenty to say."
        />
      ) : report.insights.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="Nothing flagged today"
          body="Your training looks balanced and on-track. Keep going. New insights appear as patterns develop."
        />
      ) : (
        <div className="space-y-2.5">
          <SectionHeader caption="Insights" />
          {report.insights.map((insight) => (
            <InsightCard key={insight.id} insight={insight} isDark={isDark} />
          ))}
        </div>
      )}

      <FormCuesSection />

      <p className="text-[11px] leading-relaxed text-center px-4 text-subtle">
        These are rule-based guidelines, not medical or coaching advice. If something hurts, consult a professional.
      </p>
    </div>
  );
}

function Greeting({ userName }: { userName?: string }) {
  const hour = new Date().getHours();
  const tod = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
  return (
    <p className={SUB}>
      Good {tod}{userName ? `, ${userName}` : ''}. Here's what your last few weeks of training are telling me.
    </p>
  );
}

function WeeklySummaryCard({ summary }: { summary: WeeklySummary }) {
  const VolumeTrendIcon = summary.volumeDelta > 0 ? TrendingUp : summary.volumeDelta < 0 ? TrendingDown : Minus;
  const trendTone = summary.volumeDelta > 0 ? 'text-ok' : summary.volumeDelta < 0 ? 'text-danger' : 'text-subtle';
  const deltaPct = (() => {
    const lastWeek = summary.weeklyVolumes[6] || 0;
    if (lastWeek === 0) return null;
    return Math.round((summary.volumeDelta / lastWeek) * 100);
  })();

  return (
    <Card>
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className={`${CAPTION} mb-1`}>This week</div>
          <div className="flex items-baseline gap-2">
            <div className={STAT}>{summary.sessions}</div>
            <div className={SUB}>session{summary.sessions === 1 ? '' : 's'}</div>
          </div>
        </div>
        <SummarySparkline values={summary.weeklyVolumes} />
      </div>
      <div className="grid grid-cols-3 gap-3 pt-3 border-t border-border">
        <SummaryStat label="Volume" value={formatVolumeShort(summary.volume)} hint={summary.volume > 0 ? 'kg' : undefined} />
        <SummaryStat
          label="vs last wk"
          value={summary.volumeDelta === 0 ? '±0' : (summary.volumeDelta > 0 ? '+' : '−') + formatVolumeShort(Math.abs(summary.volumeDelta))}
          hint={deltaPct !== null && summary.volumeDelta !== 0 ? `${deltaPct > 0 ? '+' : ''}${deltaPct}%` : undefined}
          icon={<VolumeTrendIcon className={`w-3.5 h-3.5 ${trendTone}`} />}
        />
        <SummaryStat label="PRs" value={String(summary.prsThisWeek)} hint={summary.prsThisWeek > 0 ? 'this week' : '—'} />
      </div>
    </Card>
  );
}

function SummaryStat({ label, value, hint, icon }: { label: string; value: string; hint?: string; icon?: React.ReactNode }) {
  return (
    <div>
      <div className={`${CAPTION} mb-0.5`}>{label}</div>
      <div className="flex items-center gap-1.5">
        <div className="text-base font-bold text-text">{value}</div>
        {icon}
      </div>
      {hint && <div className={SUB}>{hint}</div>}
    </div>
  );
}

function SummarySparkline({ values }: { values: number[] }) {
  const w = 100;
  const h = 32;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  if (max === 0) return <div style={{ width: w, height: h }} aria-hidden="true" />;

  const stepX = w / (values.length - 1);
  const points = values.map((v, i) => {
    const x = i * stepX;
    const y = h - ((v - min) / range) * (h - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const path = `M ${points.join(' L ')}`;
  const last = points[points.length - 1].split(',');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" className="text-accent">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r="2.2" fill="currentColor" />
      <line x1="0" y1={h - 1} x2={w} y2={h - 1} className="text-border" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

function FormCuesSection() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const grouped = useMemo(() => listFormCuesByGroup(), []);
  const totalCues = useMemo(() => Object.values(grouped).reduce((n, g) => n + g.length, 0), [grouped]);
  const matched = useMemo<FormCueEntry | null>(() => {
    if (selectedKey) {
      const found = findFormCues(selectedKey);
      if (found) return found;
    }
    if (query.trim().length === 0) return null;
    return findFormCues(query);
  }, [query, selectedKey]);

  const groupOrder: FormCueEntry['group'][] = ['chest', 'back', 'legs', 'shoulders', 'arms', 'core'];

  return (
    <div className="space-y-2.5">
      <Card padding="none" onClick={() => setOpen((o) => !o)} className="px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="w-9 h-9 rounded-control bg-accent-soft text-accent flex items-center justify-center shrink-0">
            <BookOpen className="w-[18px] h-[18px]" strokeWidth={1.75} />
          </span>
          <div className="text-left flex-1 min-w-0">
            <div className="font-semibold text-sm text-text">Form cues</div>
            <div className={SUB}>Quick reminders for {totalCues} common lifts</div>
          </div>
          {open ? <ChevronUp className="w-5 h-5 text-subtle shrink-0" /> : <ChevronDown className="w-5 h-5 text-subtle shrink-0" />}
        </div>
      </Card>

      {open && (
        <Card className="space-y-3">
          <div className="flex items-center gap-2 px-3 h-11 rounded-control border border-border bg-surface-2">
            <Search className="w-4 h-4 text-subtle" />
            <input
              value={query}
              onChange={(e) => { setQuery(e.target.value); setSelectedKey(null); }}
              placeholder="Search an exercise..."
              className="flex-1 bg-transparent outline-none text-sm text-text placeholder:text-subtle"
            />
          </div>

          {matched ? (
            <CueDetail entry={matched} />
          ) : (
            <div className="space-y-2">
              {groupOrder.map((g) => (
                <div key={g}>
                  <div className={`${CAPTION} px-1 mb-1`}>{g}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {grouped[g].map((entry) => (
                      <Chip key={entry.key} onClick={() => setSelectedKey(entry.key)}>{entry.name}</Chip>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {(query || selectedKey) && (
            <button onClick={() => { setQuery(''); setSelectedKey(null); }} className="text-xs text-subtle hover:text-accent transition-colors">
              ← Browse all
            </button>
          )}
        </Card>
      )}
    </div>
  );
}

function CueDetail({ entry }: { entry: FormCueEntry }) {
  return (
    <div className="rounded-control p-3 bg-surface-2">
      <div className="flex items-center justify-between mb-2">
        <div className="font-semibold text-sm text-text">{entry.name}</div>
        <div className={CAPTION}>{entry.group}</div>
      </div>
      <ul className="space-y-1.5">
        {entry.cues.map((cue, i) => (
          <li key={i} className="text-xs flex gap-2 text-muted">
            <span className="text-accent shrink-0">•</span>
            <span className="leading-relaxed">{cue}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function formatVolumeShort(kg: number): string {
  if (kg === 0) return '0';
  if (Math.abs(kg) >= 10000) return (kg / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  if (Math.abs(kg) >= 1000) return (kg / 1000).toFixed(1) + 'k';
  return Math.round(kg).toLocaleString();
}
