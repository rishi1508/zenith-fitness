import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { hapticImpact } from '../haptics';
import { LAYOUT, clamp, computeGeometry } from './chartMath';

export type DragAxis = 'x' | 'y';

const LONG_PRESS_MS = 500;
const TAP_SLOP_PX = 10;
const DOUBLE_TAP_MS = 300;
/** Ignore compat mouse events the browser synthesises after a touch. */
const TOUCH_MOUSE_GUARD_MS = 700;
const X_DRAG_PER_PX = 0.005;
const Y_DRAG_PER_PX = 0.008;
const WHEEL_ZOOM_PER_PX = 0.0015;
/** Extra reach (beyond one point spacing) when snapping to the nearest point. */
const HIT_SLOP_PX = 20;

/** Where the scroller should land after an X-zoom re-render: pinned to the
 *  newest point, or keeping data index `t` under viewport x `px`. */
type ScrollAnchor = 'end' | { t: number; px: number };

interface Live {
  n: number;
  containerWidth: number;
  xZoom: number;
  yZoom: number;
  crosshair: boolean;
  active: number | null;
}

/**
 * All pointer interaction for InteractiveLineChart, attached as native
 * (non-passive) listeners on the chart wrapper so touchmove can be
 * preventDefault-ed — React's touch handlers are passive.
 *
 * Gestures: two-finger pinch (X / Y / both, by finger vector), X- and Y-axis
 * drag scaling, 500ms long-press crosshair (drag to move, hold to dismiss),
 * tap to inspect / double-tap to reset, mouse hover, wheel (X; shift or over
 * the Y axis → Y).
 */
export function useChartGestures(
  wrapperRef: RefObject<HTMLDivElement | null>,
  scrollerRef: RefObject<HTMLDivElement | null>,
  n: number,
  containerWidth: number,
) {
  const [xZoom, setXZoom] = useState(1);
  const [yZoom, setYZoom] = useState(1);
  const [active, setActive] = useState<number | null>(null);
  const [crosshair, setCrosshair] = useState(false);
  const [axisDrag, setAxisDrag] = useState<DragAxis | null>(null);
  const [scrollLeft, setScrollLeft] = useState(0);

  // Latest render values for the once-attached native handlers.
  const live = useRef<Live>({ n, containerWidth, xZoom, yZoom, crosshair, active });
  useEffect(() => {
    live.current = { n, containerWidth, xZoom, yZoom, crosshair, active };
  });

  // ---- scroll anchoring across zoom / data changes ----
  const anchorRef = useRef<ScrollAnchor | null>('end');
  const layoutKeyRef = useRef('');
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const key = `${n}:${containerWidth}`;
    // New data or a resize always re-pins to the newest point.
    const anchor = layoutKeyRef.current !== key ? 'end' : anchorRef.current;
    layoutKeyRef.current = key;
    anchorRef.current = null;
    if (!anchor) return;
    if (anchor === 'end') {
      el.scrollLeft = el.scrollWidth - el.clientWidth;
    } else {
      const { pointSpacing } = computeGeometry(n, containerWidth, xZoom, yZoom);
      el.scrollLeft = LAYOUT.padLeft + anchor.t * pointSpacing - anchor.px;
    }
  }, [scrollerRef, n, containerWidth, xZoom, yZoom]);

  const resetZoom = useCallback(() => {
    if (live.current.xZoom === 1 && live.current.yZoom === 1) return;
    anchorRef.current = 'end';
    setXZoom(1);
    setYZoom(1);
  }, []);

  useEffect(() => {
    const wrap = wrapperRef.current;
    const scroller = scrollerRef.current;
    if (!wrap || !scroller) return;

    // Per-gesture bookkeeping. Plain object (not state) so handlers always
    // see the current values without re-subscribing.
    const g: {
      pinch: { startDist: number; axis: 'x' | 'y' | 'both'; xZoom: number; yZoom: number; anchor: ScrollAnchor } | null;
      axisDrag: { axis: DragAxis; startX: number; startY: number; xZoom: number; yZoom: number } | null;
      press: { x: number; y: number; moved: boolean } | null;
      crosshairDrag: { startX: number; startIndex: number } | null;
      timer: ReturnType<typeof setTimeout> | null;
      longPressFired: boolean;
      lastTapAt: number;
      lastTouchAt: number;
    } = { pinch: null, axisDrag: null, press: null, crosshairDrag: null, timer: null, longPressFired: false, lastTapAt: 0, lastTouchAt: 0 };

    const geom = () => computeGeometry(live.current.n, live.current.containerWidth, live.current.xZoom, live.current.yZoom);
    const rel = (clientX: number, clientY: number) => {
      const r = wrap.getBoundingClientRect();
      return { x: clientX - r.left, y: clientY - r.top };
    };
    const zoneAt = (p: { x: number; y: number }): 'yAxis' | 'xAxis' | 'plot' =>
      p.x < LAYOUT.padLeft ? 'yAxis' : p.y > geom().chartHeight - LAYOUT.padBottom + 5 ? 'xAxis' : 'plot';
    /** Data index nearest to a wrapper-relative x, or null when nothing is within reach. */
    const nearest = (relX: number): number | null => {
      const { pointSpacing } = geom();
      const svgX = relX + scroller.scrollLeft;
      const i = clamp(Math.round((svgX - LAYOUT.padLeft) / pointSpacing), 0, live.current.n - 1);
      return Math.abs(LAYOUT.padLeft + i * pointSpacing - svgX) <= pointSpacing + HIT_SLOP_PX ? i : null;
    };
    const focalAnchor = (relX: number): ScrollAnchor => ({
      t: (scroller.scrollLeft + relX - LAYOUT.padLeft) / geom().pointSpacing,
      px: relX,
    });
    const zoomX = (z: number, anchor: ScrollAnchor) => {
      const next = clamp(z, geom().minXZoom, LAYOUT.maxXZoom);
      if (next === live.current.xZoom) return;
      anchorRef.current = anchor;
      setXZoom(next);
    };
    const zoomY = (z: number) => setYZoom(clamp(z, LAYOUT.minYZoom, LAYOUT.maxYZoom));
    const clearTimer = () => {
      if (g.timer) {
        clearTimeout(g.timer);
        g.timer = null;
      }
    };

    // ---- device-agnostic single-pointer core ----

    /** Returns true when the chart owns this gesture (caller should preventDefault). */
    const pointerDown = (cx: number, cy: number): boolean => {
      clearTimer();
      g.longPressFired = false;
      const p = rel(cx, cy);
      const zone = zoneAt(p);
      if (zone !== 'plot') {
        const axis: DragAxis = zone === 'xAxis' ? 'x' : 'y';
        g.axisDrag = { axis, startX: cx, startY: cy, xZoom: live.current.xZoom, yZoom: live.current.yZoom };
        setAxisDrag(axis);
        return true;
      }
      g.press = { x: cx, y: cy, moved: false };
      if (live.current.crosshair) {
        // Drag moves the crosshair; holding still dismisses it.
        g.crosshairDrag = { startX: cx, startIndex: live.current.active ?? 0 };
        g.timer = setTimeout(() => {
          g.longPressFired = true;
          g.crosshairDrag = null;
          setCrosshair(false);
          setActive(null);
          hapticImpact('light');
        }, LONG_PRESS_MS);
        return true;
      }
      g.timer = setTimeout(() => {
        g.longPressFired = true;
        const i = nearest(p.x);
        if (i === null) return;
        g.crosshairDrag = { startX: cx, startIndex: i };
        setCrosshair(true);
        setActive(i);
        hapticImpact('light');
      }, LONG_PRESS_MS);
      return false;
    };

    /** Returns true when the move was consumed (caller should preventDefault). */
    const pointerMove = (cx: number, cy: number): boolean => {
      if (g.axisDrag) {
        if (g.axisDrag.axis === 'x') zoomX(g.axisDrag.xZoom + (g.axisDrag.startX - cx) * X_DRAG_PER_PX, 'end');
        else zoomY(g.axisDrag.yZoom + (cy - g.axisDrag.startY) * Y_DRAG_PER_PX);
        return true;
      }
      if (g.press && !g.press.moved && Math.hypot(cx - g.press.x, cy - g.press.y) > TAP_SLOP_PX) {
        g.press.moved = true;
        clearTimer();
      }
      if (g.crosshairDrag) {
        const delta = Math.round((cx - g.crosshairDrag.startX) / geom().pointSpacing);
        setActive(clamp(g.crosshairDrag.startIndex + delta, 0, live.current.n - 1));
        return true;
      }
      return live.current.crosshair;
    };

    const pointerUp = (isTouch: boolean) => {
      clearTimer();
      const press = g.press;
      g.press = null;
      g.crosshairDrag = null;
      if (g.axisDrag) {
        g.axisDrag = null;
        setAxisDrag(null);
        return;
      }
      if (!press || press.moved || g.longPressFired) return;
      // Clean tap / click on the plot.
      const now = Date.now();
      if (now - g.lastTapAt < DOUBLE_TAP_MS) {
        g.lastTapAt = 0;
        resetZoom();
        return;
      }
      g.lastTapAt = now;
      const i = nearest(rel(press.x, press.y).x);
      if (live.current.crosshair) {
        if (i !== null) setActive(i);
      } else if (isTouch) {
        // Mouse users get hover instead; a tap toggles the tooltip.
        setActive(cur => (cur === i ? null : i));
      }
    };

    // ---- touch ----
    const onTouchStart = (e: TouchEvent) => {
      g.lastTouchAt = Date.now();
      if (e.touches.length >= 2) {
        clearTimer();
        g.press = null;
        g.crosshairDrag = null;
        if (g.axisDrag) {
          g.axisDrag = null;
          setAxisDrag(null);
        }
        const [a, b] = [e.touches[0], e.touches[1]];
        const dx = Math.abs(a.clientX - b.clientX);
        const dy = Math.abs(a.clientY - b.clientY);
        // Finger vector: < 30° from horizontal → X, > 60° → Y, else both.
        const slope = dy / Math.max(dx, 1);
        const mid = rel((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
        g.pinch = {
          startDist: Math.max(1, Math.hypot(dx, dy)),
          axis: slope < 0.577 ? 'x' : slope > 1.732 ? 'y' : 'both',
          xZoom: live.current.xZoom,
          yZoom: live.current.yZoom,
          anchor: focalAnchor(mid.x),
        };
        if (e.cancelable) e.preventDefault();
        return;
      }
      const t = e.touches[0];
      if (pointerDown(t.clientX, t.clientY) && e.cancelable) e.preventDefault();
    };
    const onTouchMove = (e: TouchEvent) => {
      g.lastTouchAt = Date.now();
      if (g.pinch && e.touches.length >= 2) {
        if (e.cancelable) e.preventDefault();
        const [a, b] = [e.touches[0], e.touches[1]];
        const s = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) / g.pinch.startDist;
        if (g.pinch.axis !== 'y') zoomX(g.pinch.xZoom * s, g.pinch.anchor);
        if (g.pinch.axis !== 'x') zoomY(g.pinch.yZoom * s);
        return;
      }
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      if (pointerMove(t.clientX, t.clientY) && e.cancelable) e.preventDefault();
    };
    const onTouchEnd = (e: TouchEvent) => {
      g.lastTouchAt = Date.now();
      if (g.pinch) {
        // Fingers lifting after a pinch never count as a tap.
        if (e.touches.length < 2) g.pinch = null;
        return;
      }
      if (e.touches.length === 0) pointerUp(true);
    };

    // ---- mouse ----
    const mouseGuard = () => Date.now() - g.lastTouchAt < TOUCH_MOUSE_GUARD_MS;
    const onWindowMouseMove = (e: MouseEvent) => {
      pointerMove(e.clientX, e.clientY);
    };
    const onWindowMouseUp = () => {
      pointerUp(false);
      window.removeEventListener('mousemove', onWindowMouseMove);
      window.removeEventListener('mouseup', onWindowMouseUp);
    };
    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0 || mouseGuard()) return;
      if (pointerDown(e.clientX, e.clientY)) e.preventDefault();
      // Track the drag on window so leaving the chart doesn't drop it.
      window.addEventListener('mousemove', onWindowMouseMove);
      window.addEventListener('mouseup', onWindowMouseUp);
    };
    const onMouseMove = (e: MouseEvent) => {
      if (mouseGuard() || e.buttons !== 0 || live.current.crosshair) return;
      const p = rel(e.clientX, e.clientY);
      setActive(zoneAt(p) === 'plot' ? nearest(p.x) : null);
    };
    const onMouseLeave = () => {
      if (!live.current.crosshair && !g.press && !g.axisDrag) setActive(null);
    };

    // ---- wheel ----
    const onWheel = (e: WheelEvent) => {
      const p = rel(e.clientX, e.clientY);
      const vertical = e.shiftKey || zoneAt(p) === 'yAxis';
      // Horizontal wheel / trackpad swipe scrolls the chart natively.
      if (!vertical && Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      const raw = e.shiftKey && e.deltaY === 0 ? e.deltaX : e.deltaY;
      if (raw === 0) return;
      const delta = e.deltaMode === 1 ? raw * 33 : raw;
      const factor = Math.exp(-delta * WHEEL_ZOOM_PER_PX);
      const cur = vertical ? live.current.yZoom : live.current.xZoom;
      const lo = vertical ? LAYOUT.minYZoom : geom().minXZoom;
      const hi = vertical ? LAYOUT.maxYZoom : LAYOUT.maxXZoom;
      // Already at the limit → let the page scroll instead.
      if ((factor < 1 && cur <= lo) || (factor > 1 && cur >= hi)) return;
      e.preventDefault();
      if (vertical) zoomY(cur * factor);
      else zoomX(cur * factor, focalAnchor(p.x));
    };

    const onScroll = () => setScrollLeft(scroller.scrollLeft);
    const onContextMenu = (e: Event) => e.preventDefault();

    wrap.addEventListener('touchstart', onTouchStart, { passive: false });
    wrap.addEventListener('touchmove', onTouchMove, { passive: false });
    wrap.addEventListener('touchend', onTouchEnd, { passive: true });
    wrap.addEventListener('touchcancel', onTouchEnd, { passive: true });
    wrap.addEventListener('mousedown', onMouseDown);
    wrap.addEventListener('mousemove', onMouseMove);
    wrap.addEventListener('mouseleave', onMouseLeave);
    wrap.addEventListener('wheel', onWheel, { passive: false });
    wrap.addEventListener('contextmenu', onContextMenu);
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      clearTimer();
      wrap.removeEventListener('touchstart', onTouchStart);
      wrap.removeEventListener('touchmove', onTouchMove);
      wrap.removeEventListener('touchend', onTouchEnd);
      wrap.removeEventListener('touchcancel', onTouchEnd);
      wrap.removeEventListener('mousedown', onMouseDown);
      wrap.removeEventListener('mousemove', onMouseMove);
      wrap.removeEventListener('mouseleave', onMouseLeave);
      wrap.removeEventListener('wheel', onWheel);
      wrap.removeEventListener('contextmenu', onContextMenu);
      scroller.removeEventListener('scroll', onScroll);
      window.removeEventListener('mousemove', onWindowMouseMove);
      window.removeEventListener('mouseup', onWindowMouseUp);
    };
  }, [wrapperRef, scrollerRef, resetZoom]);

  return { xZoom, yZoom, activeIndex: active, crosshair, axisDrag, scrollLeft, resetZoom };
}
