import {
  TrendingUp, TrendingDown, Minus, AlertTriangle, AlertCircle, Trophy,
  Target, Calendar, Activity, Sparkles, Scale, Clock,
} from 'lucide-react';
import type { Insight, InsightSeverity, InsightKind } from '../coachService';

interface Props {
  insight: Insight;
  isDark: boolean;
}

/**
 * Single insight card. Severity drives the accent color, kind drives
 * the icon. The optional sparkline renders inline as a tiny SVG path
 * — we deliberately hand-roll it instead of pulling a chart lib for one
 * trend line.
 */
export function InsightCard({ insight, isDark }: Props) {
  const tone = severityTone(insight.severity, isDark);

  const cardBg = isDark ? 'bg-[#1a1a1a]' : 'bg-white';
  const cardBorder = isDark ? 'border-[#2e2e2e]' : 'border-gray-200';
  const subtle = isDark ? 'text-zinc-400' : 'text-gray-600';
  const veryDim = isDark ? 'text-zinc-500' : 'text-gray-500';

  return (
    <div className={`rounded-xl border p-4 ${cardBg} ${cardBorder}`}>
      <div className="flex items-start gap-3">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${tone.iconBg} ${tone.iconColor}`}>
          {renderKindIcon(insight.kind, 'w-[18px] h-[18px]')}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2 mb-1">
            <div className="font-semibold text-sm leading-tight">{insight.title}</div>
            {insight.metric && (
              <div className="text-right flex-shrink-0">
                <div className={`text-sm font-bold ${tone.metricColor}`}>{insight.metric.value}</div>
                <div className={`text-[10px] ${veryDim} uppercase tracking-wide`}>{insight.metric.label}</div>
              </div>
            )}
          </div>
          <p className={`text-xs leading-relaxed ${subtle}`}>{insight.body}</p>
          {insight.tag && (
            <div className={`mt-2 inline-block text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full ${tone.tagBg} ${tone.tagColor}`}>
              {insight.tag}
            </div>
          )}
          {insight.sparkline && insight.sparkline.length >= 2 && (
            <Sparkline values={insight.sparkline} stroke={tone.sparklineStroke} isDark={isDark} />
          )}
        </div>
      </div>
    </div>
  );
}

function Sparkline({ values, stroke, isDark }: { values: number[]; stroke: string; isDark: boolean }) {
  const w = 120;
  const h = 28;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = w / (values.length - 1);
  const points = values.map((v, i) => {
    const x = i * stepX;
    const y = h - ((v - min) / range) * (h - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const path = `M ${points.join(' L ')}`;
  const lastPoint = points[points.length - 1].split(',');

  return (
    <svg
      className="mt-2"
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path d={path} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      {/* Endpoint dot */}
      <circle cx={lastPoint[0]} cy={lastPoint[1]} r="2" fill={stroke} />
      {/* Baseline track for context */}
      <line
        x1="0" y1={h - 1} x2={w} y2={h - 1}
        stroke={isDark ? '#2e2e2e' : '#e5e7eb'}
        strokeWidth="1"
      />
    </svg>
  );
}

interface Tone {
  iconBg: string;
  iconColor: string;
  metricColor: string;
  tagBg: string;
  tagColor: string;
  sparklineStroke: string;
}

function severityTone(sev: InsightSeverity, isDark: boolean): Tone {
  switch (sev) {
    case 'positive':
      return {
        iconBg: 'bg-emerald-500/15',
        iconColor: 'text-emerald-400',
        metricColor: 'text-emerald-400',
        tagBg: isDark ? 'bg-emerald-500/10' : 'bg-emerald-100',
        tagColor: isDark ? 'text-emerald-300' : 'text-emerald-700',
        sparklineStroke: '#10b981',
      };
    case 'warning':
      return {
        iconBg: 'bg-amber-500/15',
        iconColor: 'text-amber-400',
        metricColor: 'text-amber-400',
        tagBg: isDark ? 'bg-amber-500/10' : 'bg-amber-100',
        tagColor: isDark ? 'text-amber-300' : 'text-amber-700',
        sparklineStroke: '#f59e0b',
      };
    case 'concern':
      return {
        iconBg: 'bg-red-500/15',
        iconColor: 'text-red-400',
        metricColor: 'text-red-400',
        tagBg: isDark ? 'bg-red-500/10' : 'bg-red-100',
        tagColor: isDark ? 'text-red-300' : 'text-red-700',
        sparklineStroke: '#ef4444',
      };
    case 'neutral':
    default:
      return {
        iconBg: 'bg-blue-500/15',
        iconColor: 'text-blue-400',
        metricColor: 'text-blue-400',
        tagBg: isDark ? 'bg-blue-500/10' : 'bg-blue-100',
        tagColor: isDark ? 'text-blue-300' : 'text-blue-700',
        sparklineStroke: '#3b82f6',
      };
  }
}

/**
 * Render the right icon for an insight kind. We render JSX directly
 * instead of returning a component reference so the lint rule against
 * "components created during render" stays happy. Kept as a function
 * (not a component) for the same reason — this is a plain helper.
 */
function renderKindIcon(kind: InsightKind, className: string) {
  const props = { className, strokeWidth: 2.2 };
  switch (kind) {
    case 'plateau': return <Minus {...props} />;
    case 'progression': return <TrendingUp {...props} />;
    case 'regression': return <TrendingDown {...props} />;
    case 'volume-imbalance': return <AlertTriangle {...props} />;
    case 'muscle-neglected': return <AlertCircle {...props} />;
    case 'muscle-on-pace': return <Activity {...props} />;
    case 'frequency-low': return <Calendar {...props} />;
    case 'frequency-strong': return <Activity {...props} />;
    case 'recent-deload': return <Clock {...props} />;
    case 'goal-pacing-bw': return <Scale {...props} />;
    case 'goal-pacing-lift': return <Target {...props} />;
    case 'next-workout': return <Calendar {...props} />;
    case 'pr-celebration': return <Trophy {...props} />;
    case 'rest-overdue': return <AlertCircle {...props} />;
    default: return <Sparkles {...props} />;
  }
}
