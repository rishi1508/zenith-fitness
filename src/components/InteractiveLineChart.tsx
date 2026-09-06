import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { ChartSettingsBar } from './ChartSettingsBar';
import { useChartSettings } from './useChartSettings';
import { useChartGestures } from './useChartGestures';
import {
  LAYOUT,
  clamp,
  computeGeometry,
  computeYScale,
  formatChartDate,
  linePath,
  pickXLabelIndices,
  trailingAverage,
  xAt,
  yAt,
} from './chartMath';

export interface ChartPoint {
  date: string;
  value: number;
  note?: string;
}

export interface InteractiveLineChartProps {
  /** Chronological, oldest → newest. */
  points: ChartPoint[];
  isDark: boolean;
  /** Line / area / dot colour for the raw series. */
  accent: string;
  /** Unique per chart instance — SVG gradient ids are document-global. */
  gradientId: string;
  title: string;
  /** Compact formatter for axis labels and crosshair badges (e.g. "1.2k", "72.4"). */
  formatValue: (v: number) => string;
  /** Appended to tooltip values, e.g. "kg". */
  unit?: string;
  /** Tooltip value formatter; defaults to `formatValue(v)` + unit. */
  formatTooltip?: (v: number) => string;
  /** Rendered at the right of the title row (session count, overall change, …). */
  headerExtra?: ReactNode;
  emptyMessage: string;
  /** Below this many points the chart shows `emptyMessage` instead. */
  minPoints?: number;
}

const MA_COLOR = '#22d3ee';
const TOOLTIP_HALF_WIDTH = 80;

/**
 * TradingView-style line chart shared by the volume and body-weight views.
 * Owns the card, header (title + series chips + Reset), sticky Y axis,
 * horizontally scrollable plot, crosshair, tooltip and hint row. All gesture
 * handling lives in useChartGestures; settings in useChartSettings.
 */
export function InteractiveLineChart(props: InteractiveLineChartProps) {
  const { points, isDark, title, emptyMessage, minPoints = 1 } = props;
  const cardClass = isDark ? 'bg-[#1a1a1a] border border-[#2e2e2e] text-white' : 'bg-white border border-gray-200 text-gray-900';

  if (points.length < minPoints) {
    return (
      <div className={`${cardClass} rounded-xl px-2 pt-3 pb-2`}>
        <div className="text-sm font-medium mb-3 px-1">{title}</div>
        <div className={`h-32 flex items-center justify-center text-sm ${isDark ? 'text-zinc-500' : 'text-gray-400'}`}>
          {emptyMessage}
        </div>
      </div>
    );
  }
  return <ChartBody {...props} cardClass={cardClass} />;
}

function useElementWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) setWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

function ChartBody({
  points,
  isDark,
  accent,
  gradientId,
  title,
  formatValue,
  unit,
  formatTooltip,
  headerExtra,
  cardClass,
}: InteractiveLineChartProps & { cardClass: string }) {
  const { settings, toggleSeries, setWindow } = useChartSettings();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const containerWidth = useElementWidth(scrollerRef) || 320;
  const n = points.length;
  const { xZoom, yZoom, activeIndex, crosshair, axisDrag, scrollLeft, resetZoom } = useChartGestures(
    wrapperRef,
    scrollerRef,
    n,
    containerWidth,
  );

  // ---- geometry ----
  const values = useMemo(() => points.map(p => p.value), [points]);
  const scale = useMemo(() => computeYScale(values), [values]);
  const geom = useMemo(() => computeGeometry(n, containerWidth, xZoom, yZoom), [n, containerWidth, xZoom, yZoom]);
  const maValues = useMemo(
    () => trailingAverage(values, settings.movingAverageWindow),
    [values, settings.movingAverageWindow],
  );
  const { padLeft, padRight, padTop, padBottom } = LAYOUT;
  const { pointSpacing, chartWidth, chartHeight, graphHeight } = geom;
  const baseY = padTop + graphHeight;

  const { rawPath, areaPath, maPath } = useMemo(() => {
    const raw = linePath(values.map((v, i) => [xAt(geom, i), yAt(geom, scale, v)]));
    return {
      rawPath: raw,
      areaPath: n >= 2 ? `${raw} L ${xAt(geom, n - 1)} ${baseY} L ${padLeft} ${baseY} Z` : '',
      maPath: linePath(maValues.map((v, i) => [xAt(geom, i), yAt(geom, scale, v)])),
    };
  }, [values, maValues, geom, scale, n, baseY, padLeft]);
  const labelIndices = useMemo(() => pickXLabelIndices(n, pointSpacing), [n, pointSpacing]);

  // ---- derived display state ----
  const showRaw = settings.showRawPoints;
  const showMA = settings.showMovingAverage && n >= 2;
  const showDots = showRaw && pointSpacing >= LAYOUT.minDotSpacing;
  const active = activeIndex !== null && activeIndex < n ? activeIndex : null;
  const activePt =
    active === null
      ? null
      : {
          x: xAt(geom, active),
          // With the raw series hidden the marker rides the MA line instead.
          y: yAt(geom, scale, showRaw ? values[active] : maValues[active]),
          point: points[active],
          ma: maValues[active],
        };
  const activeColor = showRaw ? accent : MA_COLOR;
  const isZoomed = xZoom !== 1 || yZoom !== 1;
  const scrollLocked = crosshair || axisDrag !== null;
  const tooltipValue = (v: number) => (formatTooltip ? formatTooltip(v) : `${formatValue(v)}${unit ? ` ${unit}` : ''}`);

  const tooltipStyle = activePt
    ? (() => {
        const cx = activePt.x - scrollLeft;
        // Point scrolled out of view (e.g. after a wheel zoom) → no tooltip.
        if (cx < -8 || cx > containerWidth + 8) return undefined;
        const left = containerWidth < TOOLTIP_HALF_WIDTH * 2 ? containerWidth / 2 : clamp(cx, TOOLTIP_HALF_WIDTH, containerWidth - TOOLTIP_HALF_WIDTH);
        return activePt.y > 84 ? { left, bottom: chartHeight - activePt.y + 12 } : { left, top: activePt.y + 14 };
      })()
    : undefined;

  // ---- theme ----
  const bgColor = isDark ? '#1a1a1a' : '#ffffff';
  const gridColor = isDark ? '#2e2e2e' : '#e5e7eb';
  const labelColor = isDark ? '#71717a' : '#6b7280';
  const hintColor = isDark ? '#52525b' : '#9ca3af';
  const resetClass = isDark ? 'bg-[#252525] text-zinc-400 hover:text-white' : 'bg-gray-200 text-gray-500 hover:text-gray-900';

  return (
    <div className={`${cardClass} rounded-xl px-2 pt-3 pb-2`}>
      {/* Title row */}
      <div className="flex items-center justify-between px-1">
        <div className="text-sm font-medium">{title}</div>
        {headerExtra}
      </div>

      {/* Toolbar row */}
      <div className="flex items-center justify-between mt-1.5 mb-1 px-1">
        <ChartSettingsBar settings={settings} isDark={isDark} accent={accent} onToggle={toggleSeries} onWindowChange={setWindow} />
        <div className="flex items-center gap-2">
          {crosshair && (
            <span className="text-[10px] px-2 py-0.5 rounded" style={{ backgroundColor: `${accent}33`, color: accent }}>
              Crosshair
            </span>
          )}
          {isZoomed && (
            <button type="button" onClick={resetZoom} className={`text-[10px] px-2 py-0.5 rounded ${resetClass}`}>
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Plot: wrapper receives all gestures (see useChartGestures) */}
      <div
        ref={wrapperRef}
        className="relative select-none"
        style={{ touchAction: scrollLocked ? 'none' : 'pan-x pan-y', WebkitTouchCallout: 'none' }}
      >
        {/* Sticky Y axis */}
        <div className="absolute left-0 top-0 z-10" style={{ width: padLeft, height: chartHeight, cursor: 'ns-resize' }}>
          <svg width={padLeft} height={chartHeight} className="block">
            <rect x={0} y={0} width={padLeft} height={chartHeight} fill={bgColor} />
            {scale.ticks.map((tick, i) => (
              <text key={i} x={padLeft - 8} y={yAt(geom, scale, tick) + 4} fill={labelColor} fontSize="10" textAnchor="end">
                {formatValue(tick)}
              </text>
            ))}
            {crosshair && activePt && (
              <>
                <rect x={0} y={activePt.y - 8} width={padLeft - 4} height={16} rx={3} fill={activeColor} fillOpacity="0.9" />
                <text x={(padLeft - 4) / 2} y={activePt.y + 4} fill="white" fontSize="8" fontWeight="bold" textAnchor="middle">
                  {formatValue(showRaw ? activePt.point.value : activePt.ma)}
                </text>
              </>
            )}
          </svg>
        </div>

        {/* Horizontally scrollable plot */}
        <div
          ref={scrollerRef}
          className={
            scrollLocked
              ? 'overflow-x-hidden'
              : 'overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]'
          }
        >
          <svg width={chartWidth} height={chartHeight} className="block">
            <defs>
              <linearGradient id={gradientId} x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor={accent} stopOpacity="0.3" />
                <stop offset="100%" stopColor={accent} stopOpacity="0.02" />
              </linearGradient>
            </defs>

            {/* Grid */}
            {scale.ticks.map((tick, i) => {
              const y = yAt(geom, scale, tick);
              return <line key={i} x1={padLeft} y1={y} x2={chartWidth - padRight} y2={y} stroke={gridColor} strokeDasharray="4 4" />;
            })}

            {/* X-axis labels + drag zone */}
            {points.map((p, i) =>
              labelIndices.has(i) ? (
                <text key={`x-${i}`} x={xAt(geom, i)} y={baseY + 14} fill={labelColor} fontSize="9" textAnchor="middle">
                  {formatChartDate(p.date)}
                </text>
              ) : null,
            )}
            <rect
              x={padLeft}
              y={chartHeight - padBottom + 5}
              width={chartWidth - padLeft - padRight}
              height={padBottom - 5}
              fill="transparent"
              style={{ cursor: 'ew-resize' }}
            />

            {/* Raw series */}
            {showRaw && areaPath && <path d={areaPath} fill={`url(#${gradientId})`} />}
            {showRaw && <path d={rawPath} fill="none" stroke={accent} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />}

            {/* Moving average (dashed cyan so it reads as secondary) */}
            {showMA && (
              <path
                d={maPath}
                fill="none"
                stroke={MA_COLOR}
                strokeWidth="1.75"
                strokeDasharray="4 3"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeOpacity="0.9"
              />
            )}

            {/* Per-point dots — hidden when points are packed too tightly */}
            {showDots &&
              values.map((v, i) =>
                i === active ? null : (
                  <circle key={i} cx={xAt(geom, i)} cy={yAt(geom, scale, v)} r={3.5} fill={bgColor} stroke={accent} strokeWidth={1.5} />
                ),
              )}

            {/* Active point + crosshair */}
            {activePt && (
              <>
                {crosshair && (
                  <>
                    <line x1={activePt.x} y1={padTop} x2={activePt.x} y2={baseY} stroke="#a3a3a3" strokeWidth="1" strokeDasharray="3 3" strokeOpacity="0.5" />
                    <line x1={padLeft} y1={activePt.y} x2={chartWidth - padRight} y2={activePt.y} stroke="#a3a3a3" strokeWidth="1" strokeDasharray="3 3" strokeOpacity="0.5" />
                    <rect x={activePt.x - 30} y={baseY + 2} width={60} height={14} rx={3} fill={activeColor} fillOpacity="0.9" />
                    <text x={activePt.x} y={baseY + 12} fill="white" fontSize="8" fontWeight="bold" textAnchor="middle">
                      {formatChartDate(activePt.point.date, true)}
                    </text>
                  </>
                )}
                <circle cx={activePt.x} cy={activePt.y} r={8} fill={activeColor} fillOpacity="0.2" />
                <circle cx={activePt.x} cy={activePt.y} r={6} fill={activeColor} stroke={activeColor} strokeWidth={2.5} />
              </>
            )}
          </svg>
        </div>

        {/* Tooltip */}
        {activePt && (
          <div
            className="absolute z-20 pointer-events-none rounded-lg px-2.5 py-1.5 shadow-lg -translate-x-1/2"
            style={{
              ...tooltipStyle,
              maxWidth: TOOLTIP_HALF_WIDTH * 2,
              backgroundColor: isDark ? '#252525' : '#ffffff',
              border: `1px solid ${activeColor}66`,
            }}
          >
            <div className="text-[10px] whitespace-nowrap" style={{ color: labelColor }}>
              {formatChartDate(activePt.point.date, true)}
            </div>
            <div className="text-sm font-bold leading-tight whitespace-nowrap" style={{ color: accent }}>
              {tooltipValue(activePt.point.value)}
            </div>
            {showMA && (
              <div className="text-[10px] whitespace-nowrap" style={{ color: MA_COLOR }}>
                {settings.movingAverageWindow}-MA {tooltipValue(activePt.ma)}
              </div>
            )}
            {activePt.point.note && (
              <div className="text-[10px] truncate" style={{ color: labelColor }}>
                {activePt.point.note}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Hint row */}
      <div className="flex items-center justify-between mt-1 px-1">
        <div className="text-[10px]" style={{ color: hintColor }}>
          {crosshair ? 'Hold to dismiss crosshair' : 'Hold to inspect · Pinch or drag axes to scale'}
        </div>
        {isZoomed && (
          <div className="text-[10px]" style={{ color: labelColor }}>
            X: {Math.round(xZoom * 100)}% · Y: {Math.round(yZoom * 100)}%
          </div>
        )}
      </div>
    </div>
  );
}
