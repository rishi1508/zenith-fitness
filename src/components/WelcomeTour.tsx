import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { Tab } from '../shell/tabs';
import { markTourSeen } from '../tourState';

/** Padding around the highlighted element, px. */
const HALO = 8;
/** How long to wait for a step's target to appear after switching tab. */
const TARGET_TIMEOUT_MS = 1200;

interface Step {
  /** `data-tour` value of the element to point at. Absent = a centred card. */
  target?: string;
  /** Switch to this tab first, so the target exists. */
  tab?: Tab;
  title: string;
  body: string;
}

/**
 * What is where — pointed at, not described.
 *
 * The first version was six slides of prose, which tells you a Health tab
 * exists without ever showing you where it is. This one dims the app, cuts a
 * hole around the real control it is talking about, and puts the sentence
 * next to it. Switching tabs is part of the tour: by the end the user has
 * watched every tab open once.
 */
const STEPS: Step[] = [
  {
    title: 'Welcome to Zenith',
    body: 'Thirty seconds and you will know where everything lives. Skip whenever you like — nothing here is hidden.',
  },
  {
    target: 'tab-home',
    tab: 'home',
    title: 'Home is today',
    body: 'Whatever your plan says is next, your week, your streak and today’s food. This is the screen you open before training.',
  },
  {
    target: 'start-workout',
    tab: 'home',
    title: 'Start from here',
    body: 'One tap starts the session your plan is up to. The button beside it invites a buddy to do the same session with you, live.',
  },
  {
    target: 'tab-train',
    tab: 'train',
    title: 'Train holds your plans',
    body: 'Weekly plans, the exercise library and every session you have logged. Change what a day contains here; start it from Home.',
  },
  {
    target: 'tab-health',
    tab: 'health',
    title: 'Health is food and body',
    body: 'Log what you eat, scan a plate with the camera, set calorie targets, and watch your weight against the phase you picked.',
  },
  {
    target: 'tab-gym',
    tab: 'gym',
    title: 'My Gym is your people',
    body: 'Check in, see today’s classes, and the feed of what everyone else at your gym trained. Owners manage the gym from here too.',
  },
  {
    target: 'tab-you',
    tab: 'you',
    title: 'You is everything about you',
    body: 'Your photo wears your experience level as a ring. Buddies, progress, history and settings live behind it — every number opens something.',
  },
];

interface Rect { top: number; left: number; width: number; height: number }

function rectOf(target: string | undefined): Rect | null {
  if (!target) return null;
  const el = document.querySelector(`[data-tour="${target}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

export function WelcomeTour({ onDone, onGoToTab }: { onDone: () => void; onGoToTab: (tab: Tab) => void }) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const step = STEPS[i];
  const last = i === STEPS.length - 1;
  const finishedRef = useRef(false);

  const finish = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    markTourSeen();
    onDone();
  }, [onDone]);

  // Take the tab the step lives on, then wait for its target to be laid out.
  // A tab the user does not have (no gym) simply has no target, and the step
  // falls back to a centred card rather than pointing at nothing.
  useEffect(() => {
    let cancelled = false;
    if (step.tab) onGoToTab(step.tab);
    const started = Date.now();
    // Measured on a frame, never synchronously: the tab this step lives on
    // may only just have been asked to render.
    const tick = () => {
      if (cancelled) return;
      const found = rectOf(step.target);
      if (found || Date.now() - started >= TARGET_TIMEOUT_MS) { setRect(found); return; }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return () => { cancelled = true; };
  }, [i, step.tab, step.target, onGoToTab]);

  // Keep the hole on the element if the layout moves under it.
  useEffect(() => {
    if (!step.target) return;
    const update = () => setRect(rectOf(step.target));
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [step.target]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') finish(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [finish]);

  const next = () => (last ? finish() : setI((n) => n + 1));

  // The card goes on whichever side of the hole has room; with no hole it
  // sits in the middle.
  const viewportH = typeof window === 'undefined' ? 800 : window.innerHeight;
  const below = rect ? rect.top + rect.height + HALO + 12 : 0;
  const placeAbove = rect ? below > viewportH - 240 : false;

  return (
    <div className="fixed inset-0 z-[130]" role="dialog" aria-modal="true" aria-label={step.title}>
      {/* The dimmer is one element with a giant spread shadow, so the hole is
          genuinely transparent — the control underneath stays visible and
          keeps its own colours. */}
      {rect ? (
        <div
          className="absolute rounded-2xl pointer-events-none transition-all duration-300 ease-out"
          style={{
            top: rect.top - HALO,
            left: rect.left - HALO,
            width: rect.width + HALO * 2,
            height: rect.height + HALO * 2,
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.78)',
            outline: '2px solid var(--accent, #f97316)',
            outlineOffset: 2,
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-black/78" />
      )}

      {/* Catches taps anywhere off the card so a stray touch does not fire the
          control being pointed at. */}
      <div className="absolute inset-0" onClick={next} />

      <div
        className="absolute left-1/2 -translate-x-1/2 w-[min(22rem,calc(100vw-2rem))] rounded-card border border-border bg-surface p-5 shadow-2xl animate-fadeIn"
        style={
          rect
            ? placeAbove
              ? { bottom: Math.max(16, viewportH - rect.top + HALO + 12) }
              : { top: below }
            : { top: '50%', transform: 'translate(-50%, -50%)' }
        }
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-lg font-bold text-text">{step.title}</h2>
        <p className="text-[15px] leading-[22px] text-muted mt-1.5">{step.body}</p>

        <div className="flex items-center gap-1.5 mt-4" aria-hidden="true">
          {STEPS.map((s, n) => (
            <span key={s.title} className={`h-1.5 rounded-full transition-all ${n === i ? 'w-5 bg-accent' : 'w-1.5 bg-border'}`} />
          ))}
        </div>

        <div className="flex items-center gap-2 mt-4">
          <button onClick={finish} className="min-h-11 pr-3 text-sm font-semibold text-subtle">Skip</button>
          <button
            onClick={next}
            className="ml-auto min-h-11 px-5 rounded-control bg-accent text-white text-sm font-bold flex items-center gap-1.5"
          >
            {last ? 'Start training' : 'Next'}
            {!last && <ChevronRight className="w-4 h-4" strokeWidth={2.5} />}
          </button>
        </div>
      </div>
    </div>
  );
}
