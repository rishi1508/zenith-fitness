import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { hapticImpact } from '../haptics';

const HOLD_MS = 280;
const SLOP_PX = 8;

/**
 * Press-and-hold scrubbing for bar charts. A plain swipe over the track
 * scrolls the page like anywhere else; holding still for a beat (with a
 * light tick) enters scrub mode, and then sliding reports the bar under
 * the finger until it lifts. Mouse users still get hover-free reading via
 * the buttons' focus handlers, and a click reads one bar.
 *
 * `indexAt(clientX)` maps a pointer x to a bar index (or null off-track).
 */
export function useHoldScrub(indexAt: (clientX: number) => number | null) {
  const [active, setActive] = useState<number | null>(null);
  const [holding, setHolding] = useState(false);
  const press = useRef<{ x: number; y: number; id: number; el: HTMLElement } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const armed = useRef(false);

  const clearTimer = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  const end = useCallback(() => {
    clearTimer();
    press.current = null;
    armed.current = false;
    setHolding(false);
    setActive(null);
  }, []);

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    clearTimer();
    armed.current = false;
    const el = e.currentTarget;
    press.current = { x: e.clientX, y: e.clientY, id: e.pointerId, el };
    if (e.pointerType === 'mouse') {
      // A click reads one bar; dragging with the button held scrubs.
      armed.current = true;
      setHolding(true);
      setActive(indexAt(e.clientX));
      return;
    }
    timer.current = setTimeout(() => {
      const p = press.current;
      if (!p) return;
      armed.current = true;
      try { p.el.setPointerCapture(p.id); } catch { /* pointer gone */ }
      setHolding(true);
      setActive(indexAt(p.x));
      hapticImpact('light');
    }, HOLD_MS);
  }, [indexAt]);

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    const p = press.current;
    if (!p) return;
    if (armed.current) {
      if (e.pointerType === 'mouse' && e.buttons === 0) return;
      setActive(indexAt(e.clientX));
      return;
    }
    // Moved before the hold landed: this is a scroll, not a scrub.
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > SLOP_PX) { clearTimer(); press.current = null; }
  }, [indexAt]);

  return {
    active,
    /** True while the finger is down in scrub mode — the chart may show the reading emphatically. */
    holding,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: end,
      onPointerCancel: end,
      onPointerLeave: (e: ReactPointerEvent<HTMLElement>) => { if (!armed.current || e.pointerType === 'mouse') end(); },
    },
    /** Keyboard focus on a bar still reads it. */
    setActive,
  };
}
