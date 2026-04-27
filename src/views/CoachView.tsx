import { useMemo, useState } from 'react';
import {
  ArrowLeft, Sparkles, ChevronDown, ChevronUp, Search, Dumbbell, BookOpen, TrendingUp, TrendingDown, Minus,
} from 'lucide-react';
import type { WeeklySummary } from '../coachService';
import { buildCoachReport } from '../coachService';
import { InsightCard } from '../components/InsightCard';
import { findFormCues, listFormCuesByGroup, type FormCueEntry } from '../coachFormCues';
import { useAuth } from '../auth/AuthContext';

interface Props {
  isDark: boolean;
  onBack: () => void;
}

/**
 * Coach view — runs `buildCoachReport()` over local data and renders:
 *   - Weekly summary card (sessions, volume, PRs, sparkline)
 *   - Ranked feed of Insight cards
 *   - Form cues lookup by exercise (uses both fuzzy search and a
 *     grouped browser)
 *
 * Empty state: triggered when the user has fewer than 3 completed
 * workouts. We don't try to coach a brand-new user — there's no signal
 * yet.
 */
export function CoachView({ isDark, onBack }: Props) {
  const { user } = useAuth();
  // The analysis is pure + synchronous over localStorage. Lazy-init the
  // state with the report so we never have a "loading" frame, and so we
  // don't trigger the eslint rule that bans setState-in-effect.
  const [report] = useState(() => buildCoachReport());

  const subtle = isDark ? 'text-zinc-400' : 'text-gray-600';
  const veryDim = isDark ? 'text-zinc-500' : 'text-gray-500';
  const cardBg = isDark ? 'bg-[#1a1a1a]' : 'bg-white';
  const cardBorder = isDark ? 'border-[#2e2e2e]' : 'border-gray-200';
  const hoverBg = isDark ? 'hover:bg-[#222]' : 'hover:bg-gray-50';

  return (
    <div className="space-y-4 animate-fadeIn">
      <Header onBack={onBack} hoverBg={hoverBg} />

      <Greeting userName={user?.displayName?.split(' ')[0]} subtle={subtle} />

      <WeeklySummaryCard
        summary={report.weekly}
        isDark={isDark}
        cardBg={cardBg}
        cardBorder={cardBorder}
        subtle={subtle}
        veryDim={veryDim}
      />

      {!report.hasEnoughData ? (
        <EmptyState cardBg={cardBg} cardBorder={cardBorder} subtle={subtle} />
      ) : report.insights.length === 0 ? (
        <NoInsightsYet cardBg={cardBg} cardBorder={cardBorder} subtle={subtle} />
      ) : (
        <div className="space-y-2.5">
          <SectionHeader label="Insights" subtle={veryDim} />
          {report.insights.map((insight) => (
            <InsightCard key={insight.id} insight={insight} isDark={isDark} />
          ))}
        </div>
      )}

      <FormCuesSection
        isDark={isDark}
        cardBg={cardBg}
        cardBorder={cardBorder}
        subtle={subtle}
        veryDim={veryDim}
        hoverBg={hoverBg}
      />

      <Disclaimer subtle={veryDim} />
    </div>
  );
}

function Header({ onBack, hoverBg }: { onBack: () => void; hoverBg: string }) {
  return (
    <div className="flex items-center gap-3">
      <button onClick={onBack} className={`p-2 rounded-lg transition-colors ${hoverBg}`}>
        <ArrowLeft className="w-5 h-5" />
      </button>
      <div className="flex items-center gap-2">
        <Sparkles className="w-5 h-5 text-orange-400" />
        <h1 className="text-xl font-bold">Your Coach</h1>
      </div>
    </div>
  );
}

function Greeting({ userName, subtle }: { userName?: string; subtle: string }) {
  const hour = new Date().getHours();
  const tod = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
  return (
    <p className={`text-sm ${subtle}`}>
      Good {tod}{userName ? `, ${userName}` : ''}. Here's what your last few weeks of training are telling me.
    </p>
  );
}

function SectionHeader({ label, subtle }: { label: string; subtle: string }) {
  return (
    <div className={`text-[10px] font-semibold uppercase tracking-wider ${subtle}`}>
      {label}
    </div>
  );
}

function WeeklySummaryCard({
  summary, isDark, cardBg, cardBorder, subtle, veryDim,
}: {
  summary: WeeklySummary;
  isDark: boolean;
  cardBg: string;
  cardBorder: string;
  subtle: string;
  veryDim: string;
}) {
  const VolumeTrendIcon = summary.volumeDelta > 0 ? TrendingUp : summary.volumeDelta < 0 ? TrendingDown : Minus;
  const trendColor = summary.volumeDelta > 0 ? 'text-emerald-400' : summary.volumeDelta < 0 ? 'text-red-400' : veryDim;
  const deltaPct = (() => {
    const lastWeek = summary.weeklyVolumes[6] || 0;
    if (lastWeek === 0) return null;
    return Math.round((summary.volumeDelta / lastWeek) * 100);
  })();

  return (
    <div className={`rounded-2xl border p-4 ${cardBg} ${cardBorder}`}>
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className={`text-[10px] font-semibold uppercase tracking-wider ${veryDim} mb-1`}>
            This week
          </div>
          <div className="flex items-baseline gap-2">
            <div className="text-2xl font-bold">{summary.sessions}</div>
            <div className={`text-xs ${subtle}`}>session{summary.sessions === 1 ? '' : 's'}</div>
          </div>
        </div>
        <SummarySparkline values={summary.weeklyVolumes} isDark={isDark} />
      </div>
      <div className="grid grid-cols-3 gap-3 pt-3 border-t border-zinc-800/40">
        <SummaryStat
          label="Volume"
          value={formatVolumeShort(summary.volume)}
          hint={summary.volume > 0 ? 'kg' : undefined}
          subtle={subtle}
          veryDim={veryDim}
        />
        <SummaryStat
          label="vs last wk"
          value={summary.volumeDelta === 0 ? '±0' : (summary.volumeDelta > 0 ? '+' : '−') + formatVolumeShort(Math.abs(summary.volumeDelta))}
          hint={deltaPct !== null && summary.volumeDelta !== 0 ? `${deltaPct > 0 ? '+' : ''}${deltaPct}%` : undefined}
          subtle={subtle}
          veryDim={veryDim}
          icon={<VolumeTrendIcon className={`w-3.5 h-3.5 ${trendColor}`} />}
        />
        <SummaryStat
          label="PRs"
          value={String(summary.prsThisWeek)}
          hint={summary.prsThisWeek > 0 ? 'this week' : '—'}
          subtle={subtle}
          veryDim={veryDim}
        />
      </div>
    </div>
  );
}

function SummaryStat({
  label, value, hint, subtle, veryDim, icon,
}: {
  label: string; value: string; hint?: string; subtle: string; veryDim: string; icon?: React.ReactNode;
}) {
  return (
    <div>
      <div className={`text-[10px] uppercase tracking-wide ${veryDim} mb-0.5`}>{label}</div>
      <div className="flex items-center gap-1.5">
        <div className="text-base font-bold">{value}</div>
        {icon}
      </div>
      {hint && <div className={`text-[10px] ${subtle}`}>{hint}</div>}
    </div>
  );
}

function SummarySparkline({ values, isDark }: { values: number[]; isDark: boolean }) {
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
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <path d={path} fill="none" stroke="#f97316" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r="2.2" fill="#f97316" />
      <line x1="0" y1={h - 1} x2={w} y2={h - 1} stroke={isDark ? '#2e2e2e' : '#e5e7eb'} strokeWidth="1" />
    </svg>
  );
}

function EmptyState({ cardBg, cardBorder, subtle }: { cardBg: string; cardBorder: string; subtle: string }) {
  return (
    <div className={`rounded-xl border p-5 text-center ${cardBg} ${cardBorder}`}>
      <Dumbbell className="w-8 h-8 text-orange-400 mx-auto mb-2" />
      <div className="font-semibold text-sm mb-1">Log a few sessions first</div>
      <p className={`text-xs ${subtle}`}>
        I need at least 3 completed workouts before I can spot trends. Get a few sessions in and check back — I'll have plenty to say.
      </p>
    </div>
  );
}

function NoInsightsYet({ cardBg, cardBorder, subtle }: { cardBg: string; cardBorder: string; subtle: string }) {
  return (
    <div className={`rounded-xl border p-5 text-center ${cardBg} ${cardBorder}`}>
      <Sparkles className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
      <div className="font-semibold text-sm mb-1">Nothing flagged today</div>
      <p className={`text-xs ${subtle}`}>
        Your training looks balanced and on-track. Keep going. New insights appear as patterns develop.
      </p>
    </div>
  );
}

// ----- Form cues section --------------------------------------------------

function FormCuesSection({
  isDark, cardBg, cardBorder, subtle, veryDim, hoverBg,
}: {
  isDark: boolean; cardBg: string; cardBorder: string;
  subtle: string; veryDim: string; hoverBg: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const grouped = useMemo(() => listFormCuesByGroup(), []);
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
      <button
        onClick={() => setOpen(!open)}
        className={`w-full flex items-center justify-between p-4 rounded-xl border transition-colors ${cardBg} ${cardBorder}`}
      >
        <div className="flex items-center gap-3">
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${isDark ? 'bg-purple-500/15' : 'bg-purple-100'} text-purple-400`}>
            <BookOpen className="w-[18px] h-[18px]" />
          </div>
          <div className="text-left">
            <div className="font-semibold text-sm">Form cues</div>
            <div className={`text-xs ${subtle}`}>Quick reminders for {Object.values(grouped).reduce((n, g) => n + g.length, 0)} common lifts</div>
          </div>
        </div>
        {open ? <ChevronUp className={`w-5 h-5 ${veryDim}`} /> : <ChevronDown className={`w-5 h-5 ${veryDim}`} />}
      </button>

      {open && (
        <div className={`rounded-xl border p-3 space-y-3 ${cardBg} ${cardBorder}`}>
          <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${cardBorder} ${isDark ? 'bg-[#0f0f0f]' : 'bg-gray-50'}`}>
            <Search className={`w-4 h-4 ${veryDim}`} />
            <input
              value={query}
              onChange={(e) => { setQuery(e.target.value); setSelectedKey(null); }}
              placeholder="Search an exercise..."
              className={`flex-1 bg-transparent outline-none text-sm ${isDark ? 'text-white placeholder-zinc-600' : 'text-gray-900 placeholder-gray-400'}`}
            />
          </div>

          {matched ? (
            <CueDetail entry={matched} isDark={isDark} subtle={subtle} veryDim={veryDim} />
          ) : (
            <div className="space-y-2">
              {groupOrder.map((g) => (
                <div key={g}>
                  <div className={`text-[10px] font-semibold uppercase tracking-wider px-1 mb-1 ${veryDim}`}>
                    {g}
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {grouped[g].map((entry) => (
                      <button
                        key={entry.key}
                        onClick={() => setSelectedKey(entry.key)}
                        className={`text-left text-xs px-2.5 py-2 rounded-lg border transition-colors ${cardBorder} ${hoverBg}`}
                      >
                        {entry.name}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {(query || selectedKey) && (
            <button
              onClick={() => { setQuery(''); setSelectedKey(null); }}
              className={`text-xs ${veryDim} hover:text-orange-400 transition-colors`}
            >
              ← Browse all
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function CueDetail({
  entry, isDark, subtle, veryDim,
}: { entry: FormCueEntry; isDark: boolean; subtle: string; veryDim: string }) {
  return (
    <div className={`rounded-lg p-3 ${isDark ? 'bg-[#0f0f0f]' : 'bg-gray-50'}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="font-semibold text-sm">{entry.name}</div>
        <div className={`text-[10px] uppercase tracking-wider ${veryDim}`}>{entry.group}</div>
      </div>
      <ul className="space-y-1.5">
        {entry.cues.map((cue, i) => (
          <li key={i} className={`text-xs flex gap-2 ${subtle}`}>
            <span className="text-orange-400 flex-shrink-0">•</span>
            <span className="leading-relaxed">{cue}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Disclaimer({ subtle }: { subtle: string }) {
  return (
    <p className={`text-[10px] leading-relaxed text-center px-4 ${subtle}`}>
      These are rule-based guidelines, not medical or coaching advice. If something hurts, consult a professional.
    </p>
  );
}

// ----- Helpers -------------------------------------------------------------

function formatVolumeShort(kg: number): string {
  if (kg === 0) return '0';
  if (Math.abs(kg) >= 10000) return (kg / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  if (Math.abs(kg) >= 1000) return (kg / 1000).toFixed(1) + 'k';
  return Math.round(kg).toLocaleString();
}
