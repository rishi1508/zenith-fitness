// Pure geometry / scale helpers shared by InteractiveLineChart and its
// gesture hook. No React, no DOM — everything here is unit-testable math.

export const MA_WINDOW_MIN = 2;
export const MA_WINDOW_MAX = 30;
export const MA_WINDOW_PRESETS = [3, 5, 7, 10, 14];

export const LAYOUT = {
  /** Horizontal distance between adjacent points at 100% X zoom. */
  basePointSpacing: 50,
  padTop: 10,
  padBottom: 30,
  padLeft: 42,
  padRight: 8,
  /** SVG height at 100% Y zoom. Y zoom stretches the chart vertically. */
  baseHeight: 160,
  minYZoom: 0.5,
  maxYZoom: 4,
  maxXZoom: 12,
  /** Below this on-screen spacing the per-point hollow dots are hidden. */
  minDotSpacing: 12,
  /** Minimum on-screen distance between two X-axis date labels. */
  minLabelSpacing: 46,
} as const;

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Trailing moving average; the first `window - 1` entries use an expanding window. */
export function trailingAverage(values: number[], window: number): number[] {
  const out: number[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= window) sum -= values[i - window];
    out.push(sum / Math.min(i + 1, window));
  }
  return out;
}

export function formatChartDate(dateStr: string, withYear = false): string {
  return new Date(dateStr).toLocaleDateString(
    'en-IN',
    withYear ? { day: 'numeric', month: 'short', year: '2-digit' } : { day: 'numeric', month: 'short' },
  );
}

export interface YScale {
  min: number;
  max: number;
  ticks: number[];
}

/** Value domain with 10% headroom (never below 0) and evenly spaced ticks. */
export function computeYScale(values: number[], tickCount = 4): YScale {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (values.length === 0) {
    lo = 0;
    hi = 1;
  }
  const range = hi - lo;
  const pad = range > 0 ? range * 0.1 : Math.max(1, Math.abs(hi) * 0.05);
  const min = Math.max(0, lo - pad);
  const max = hi + pad;
  const ticks = Array.from({ length: tickCount + 1 }, (_, i) => min + ((max - min) * i) / tickCount);
  return { min, max, ticks };
}

export interface ChartGeometry {
  /** Smallest X zoom at which every point fits inside the container. */
  minXZoom: number;
  pointSpacing: number;
  chartWidth: number;
  chartHeight: number;
  graphHeight: number;
}

export function computeGeometry(n: number, containerWidth: number, xZoom: number, yZoom: number): ChartGeometry {
  const { basePointSpacing, padLeft, padRight, padTop, padBottom, baseHeight } = LAYOUT;
  const gaps = Math.max(0, n - 1);
  const minXZoom = Math.min(1, containerWidth / (padLeft + padRight + gaps * basePointSpacing));
  const pointSpacing = basePointSpacing * xZoom;
  const chartHeight = Math.round(baseHeight * yZoom);
  return {
    minXZoom,
    pointSpacing,
    chartWidth: Math.max(containerWidth, padLeft + padRight + gaps * pointSpacing),
    chartHeight,
    graphHeight: chartHeight - padTop - padBottom,
  };
}

export function xAt(geom: ChartGeometry, index: number): number {
  return LAYOUT.padLeft + index * geom.pointSpacing;
}

export function yAt(geom: ChartGeometry, scale: YScale, value: number): number {
  const t = (value - scale.min) / (scale.max - scale.min);
  return LAYOUT.padTop + geom.graphHeight - t * geom.graphHeight;
}

export function linePath(coords: [number, number][]): string {
  return coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x} ${y}`).join(' ');
}

/** Indices that get an X-axis label. Anchored on the newest point and
 *  thinned by actual pixel spacing so labels never overlap. */
export function pickXLabelIndices(n: number, pointSpacing: number): Set<number> {
  const step = Math.max(1, Math.ceil(LAYOUT.minLabelSpacing / pointSpacing));
  const out = new Set<number>();
  for (let i = n - 1; i >= 0; i -= step) out.add(i);
  return out;
}
