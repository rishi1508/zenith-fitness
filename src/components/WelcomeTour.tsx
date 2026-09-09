import { useEffect, useState } from 'react';
import {
  Building2, ChevronRight, Dumbbell, HeartPulse, Home, Sparkles, User, X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '../ui';
import { markTourSeen } from '../tourState';

interface Step {
  icon: LucideIcon;
  title: string;
  body: string;
}

/**
 * What is where, in five cards. Named after the tabs, because that is the
 * map the app is actually organised by — someone who reads this once should
 * never have to hunt for logging food or starting a session.
 */
const STEPS: Step[] = [
  {
    icon: Sparkles,
    title: 'Welcome to Zenith',
    body: 'Everything lives under five tabs along the bottom. Thirty seconds here and you will know where to find each of them — or skip, nothing is hidden.',
  },
  {
    icon: Home,
    title: 'Home is today',
    body: 'The session your plan says is next, one tap to start it, and the button beside it to train with a buddy. Your week, your streak and today’s food sit under it.',
  },
  {
    icon: Dumbbell,
    title: 'Train is your plans',
    body: 'Weekly plans, the exercise library and every session you have logged. Change what a day contains here; start it from Home.',
  },
  {
    icon: HeartPulse,
    title: 'Health is food and body',
    body: 'Log food (the orange button is always on the diary), scan a plate with the camera, set calorie targets, and track weight against the phase you picked.',
  },
  {
    icon: Building2,
    title: 'My Gym is your people',
    body: 'Check in, see today’s classes, and the Feed — what everyone else at your gym trained today. Owners get the Manage side here too.',
  },
  {
    icon: User,
    title: 'You is everything about you',
    body: 'Your level ring, buddies, progress, history and settings. Tap any number to open what is behind it.',
  },
];

/**
 * Shown once, on the first launch of a signed-in account. Skippable at every
 * step — a tutorial you cannot dismiss is worse than none.
 */
export function WelcomeTour({ onDone }: { onDone: () => void }) {
  const [i, setI] = useState(0);
  const step = STEPS[i];
  const last = i === STEPS.length - 1;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') finish(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finish = () => { markTourSeen(); onDone(); };
  const Icon = step.icon;

  return (
    <div className="fixed inset-0 z-[130] flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-label="Welcome tour">
      <div className="absolute inset-0 bg-black/75" onClick={finish} />
      <div
        className="relative w-full sm:max-w-sm bg-surface border-t sm:border border-border rounded-t-[24px] sm:rounded-card p-6 animate-fadeIn"
        style={{ paddingBottom: 'calc(24px + env(safe-area-inset-bottom, 0px))' }}
      >
        <button
          onClick={finish}
          aria-label="Skip the tour"
          className="absolute top-3 right-3 w-9 h-9 rounded-full flex items-center justify-center text-subtle"
        >
          <X className="w-[18px] h-[18px]" strokeWidth={1.75} />
        </button>

        <span className="w-12 h-12 rounded-2xl bg-accent-soft text-accent flex items-center justify-center">
          <Icon className="w-6 h-6" strokeWidth={1.75} />
        </span>
        <h2 className="font-display text-xl font-bold text-text mt-4">{step.title}</h2>
        <p className="text-[15px] leading-[22px] text-muted mt-2">{step.body}</p>

        <div className="flex items-center gap-1.5 mt-5" aria-hidden="true">
          {STEPS.map((s, n) => (
            <span
              key={s.title}
              className={`h-1.5 rounded-full transition-all ${n === i ? 'w-6 bg-accent' : 'w-1.5 bg-border'}`}
            />
          ))}
        </div>

        <div className="flex items-center gap-2 mt-5">
          <button onClick={finish} className="flex-1 min-h-11 text-sm font-semibold text-subtle text-left">
            Skip
          </button>
          <Button
            variant="primary"
            size="lg"
            icon={last ? undefined : ChevronRight}
            onClick={() => (last ? finish() : setI((n) => n + 1))}
            className="flex-[2]"
          >
            {last ? 'Start training' : 'Next'}
          </Button>
        </div>
      </div>
    </div>
  );
}
