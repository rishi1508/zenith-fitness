import { useEffect } from 'react';
import type { RefObject } from 'react';

/**
 * iOS-style rubber-banding for a scroll container.
 *
 * Chrome on Android simply stops at the edge, which is a problem beyond
 * aesthetics: anything sitting under the tab bar or a floating button is
 * unreachable, because there is no way to pull the page up to look at it.
 * This gives every scroller a little give at both ends and springs it back.
 *
 * How it feels right:
 *   - resistance rises as you pull, so the first few pixels move easily and
 *     the last ones barely move (`MAX * (1 - 1/(d/MAX + 1))`);
 *   - the spring back is a single ease-out, not a bounce — iOS overshoots by
 *     a hair, an obvious overshoot on a phone screen reads as a glitch;
 *   - the transform is on the content, never the scroller, so scrollTop and
 *     any sticky headers are untouched.
 *
 * Touch only. A trackpad already has its own overscroll behaviour and a
 * mouse wheel has none to imitate.
 */

/** Furthest the content will travel, px. About a thumb's width. */
const MAX_PULL = 110;
/** Below this the gesture is a tap or a horizontal swipe, not a pull. */
const START_SLOP = 4;

export function useElasticScroll(
  scrollerRef: RefObject<HTMLElement | null>,
  contentRef: RefObject<HTMLElement | null>,
  enabled = true,
): void {
  useEffect(() => {
    const scroller = scrollerRef.current;
    const content = contentRef.current;
    if (!enabled || !scroller || !content) return;

    let startY = 0;
    let startX = 0;
    let pulling: 'top' | 'bottom' | null = null;
    let decided = false;
    let offset = 0;

    const atTop = () => scroller.scrollTop <= 0;
    const atBottom = () => scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1;

    const setOffset = (value: number) => {
      offset = value;
      content.style.transform = value === 0 ? '' : `translate3d(0, ${value}px, 0)`;
    };

    const release = () => {
      if (offset !== 0) {
        content.style.transition = 'transform 340ms cubic-bezier(0.22, 1, 0.36, 1)';
        setOffset(0);
        window.setTimeout(() => { content.style.transition = ''; }, 360);
      }
      pulling = null;
      decided = false;
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      // Anything that handles its own drag — charts, sliders, the peak-hours
      // scrubber — opts out and keeps the gesture. So does anything inside a
      // fixed overlay: the pull moves the content by `transform`, and a
      // `position: fixed` element inside a transformed ancestor is laid out
      // against that ancestor instead of the viewport — the photo viewer
      // collapsed into a square mid-page on every scroll for exactly this
      // reason. Chat scrollers opt out because they scroll themselves.
      if ((e.target as HTMLElement | null)?.closest('[data-elastic-skip], .fixed, [role="dialog"], [aria-modal="true"]')) return;
      startY = e.touches[0].clientY;
      startX = e.touches[0].clientX;
      pulling = null;
      decided = false;
      content.style.transition = '';
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const dy = e.touches[0].clientY - startY;
      const dx = e.touches[0].clientX - startX;

      if (!decided) {
        if (Math.abs(dy) < START_SLOP) return;
        // A mostly-sideways drag belongs to whatever is underneath.
        if (Math.abs(dx) > Math.abs(dy)) { decided = true; return; }
        decided = true;
        pulling = dy > 0 && atTop() ? 'top' : dy < 0 && atBottom() ? 'bottom' : null;
      }
      if (!pulling) return;

      const distance = pulling === 'top' ? dy : -dy;
      if (distance <= 0) { setOffset(0); return; }
      // The scroller must not also scroll, or the content snaps back the
      // moment the finger crosses the edge.
      if (e.cancelable) e.preventDefault();
      const damped = MAX_PULL * (1 - 1 / (distance / MAX_PULL + 1));
      setOffset(pulling === 'top' ? damped : -damped);
    };

    scroller.addEventListener('touchstart', onTouchStart, { passive: true });
    scroller.addEventListener('touchmove', onTouchMove, { passive: false });
    scroller.addEventListener('touchend', release, { passive: true });
    scroller.addEventListener('touchcancel', release, { passive: true });
    return () => {
      scroller.removeEventListener('touchstart', onTouchStart);
      scroller.removeEventListener('touchmove', onTouchMove);
      scroller.removeEventListener('touchend', release);
      scroller.removeEventListener('touchcancel', release);
      content.style.transform = '';
      content.style.transition = '';
    };
  }, [scrollerRef, contentRef, enabled]);
}
