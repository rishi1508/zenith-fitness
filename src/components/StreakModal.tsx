import { useMemo } from 'react';
import { X, Flame, Snowflake } from 'lucide-react';
import * as storage from '../storage';
import { getStreakState, daysUntilNextFreeze, MAX_FREEZES } from '../streakService';

interface Props {
  onClose: () => void;
  isDark: boolean;
}

/**
 * Duolingo-style streak screen. Full-height sheet with:
 *   - Big flame with the streak number inside it
 *   - "N day streak" hero
 *   - This week's activity as 7 day-dots (Sun → Sat)
 *   - Personal best stat
 *   - Freeze slots with fire-shield visual + progress to next freeze
 *
 * Uses env(safe-area-inset-top) padding + z-[100] so the close button
 * is never hidden under the Android status bar / iOS notch. Also sets
 * items-stretch so the sheet covers the full screen on mobile instead
 * of animating up from the bottom (which clipped under the status bar
 * on some Android devices).
 */
export function StreakModal({ onClose, isDark }: Props) {
  const state = getStreakState();
  const stats = useMemo(() => storage.calculateStats(), []);
  const workouts = useMemo(() => storage.getWorkouts(), []);

  // Classify each day into one of four states.
  const workedOut = new Set<string>();
  const restDays = new Set<string>();
  for (const w of workouts) {
    if (!w.completed) continue;
    const d = w.date.slice(0, 10);
    if (w.type === 'rest') restDays.add(d);
    else workedOut.add(d);
  }
  const frozen = new Set(state.freezeConsumedDates);
  const todayIso = new Date().toISOString().slice(0, 10);

  // This week, Sunday through Saturday, anchored on today.
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay()); // back to Sunday
  weekStart.setHours(0, 0, 0, 0);
  const weekDots = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    const ds = d.toISOString().slice(0, 10);
    const label = ['S', 'M', 'T', 'W', 'T', 'F', 'S'][i];
    let kind: 'workout' | 'rest' | 'frozen' | 'today' | 'missed' | 'future';
    if (ds > todayIso) kind = 'future';
    else if (workedOut.has(ds)) kind = 'workout';
    else if (restDays.has(ds)) kind = 'rest';
    else if (frozen.has(ds)) kind = 'frozen';
    else if (ds === todayIso) kind = 'today';
    else kind = 'missed';
    return { ds, label, kind };
  });

  const nextFreezeIn = daysUntilNextFreeze(state);
  const longestStreak = stats.longestStreak || stats.currentStreak || 0;

  const bg = isDark ? 'bg-[#0f0f0f]' : 'bg-white';
  const subtle = isDark ? 'text-zinc-400' : 'text-gray-500';

  return (
    <div
      className="fixed inset-0 z-[100] animate-fadeIn"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" />
      {/* Sheet — full width on mobile, card on desktop */}
      <div
        onClick={(e) => e.stopPropagation()}
        className={`relative ${bg} mx-auto sm:max-w-md sm:rounded-2xl sm:mt-10 h-full sm:h-auto sm:max-h-[90dvh] overflow-y-auto flex flex-col`}
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
      >
        {/* Close — sits on top of the hero, above the status-bar inset */}
        <button
          onClick={onClose}
          className="absolute top-0 right-0 p-3 z-10 text-white/70 hover:text-white"
          style={{ marginTop: 'env(safe-area-inset-top, 0px)' }}
          aria-label="Close"
        >
          <X className="w-6 h-6" />
        </button>

        {/* Hero: flame with the streak count inside */}
        <div className="relative flex flex-col items-center pt-10 pb-6 px-6 bg-gradient-to-b from-orange-500/20 via-orange-500/5 to-transparent">
          <FlameHero count={stats.currentStreak} />
          <div className="mt-4 text-2xl font-extrabold">
            {stats.currentStreak} day streak!
          </div>
          <div className={`text-sm mt-1 ${subtle}`}>
            {stats.currentStreak === 0
              ? 'Work out today to light it up.'
              : 'Keep it going — one more day to lock it in.'}
          </div>
        </div>

        {/* This week dots */}
        <div className="px-6 py-4">
          <div className={`text-xs font-semibold uppercase tracking-wider mb-3 ${subtle}`}>
            This week
          </div>
          <div className="flex justify-between">
            {weekDots.map((dot, i) => {
              const isToday = dot.ds === todayIso;
              const filled = dot.kind === 'workout' || dot.kind === 'rest' || dot.kind === 'frozen';
              const colorClass =
                dot.kind === 'workout'
                  ? 'bg-gradient-to-br from-orange-400 to-red-600 text-white border-orange-400'
                  : dot.kind === 'rest'
                    ? 'bg-purple-500 text-white border-purple-400'
                    : dot.kind === 'frozen'
                      ? 'bg-sky-500 text-white border-sky-400'
                      : isDark
                        ? 'bg-[#1a1a1a] border-[#2e2e2e] text-zinc-500'
                        : 'bg-gray-50 border-gray-200 text-gray-400';
              return (
                <div key={i} className="flex flex-col items-center gap-1.5">
                  <div className={`text-[10px] font-semibold ${subtle}`}>{dot.label}</div>
                  <div
                    className={`w-9 h-9 rounded-full border-2 flex items-center justify-center ${colorClass} ${
                      isToday && !filled ? 'ring-2 ring-orange-400 ring-offset-2 ring-offset-transparent' : ''
                    }`}
                  >
                    {dot.kind === 'workout' && <Flame className="w-4 h-4" fill="currentColor" />}
                    {dot.kind === 'rest' && <span className="text-[10px]">Rest</span>}
                    {dot.kind === 'frozen' && <Snowflake className="w-4 h-4" />}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Stats pair: longest streak + freezes */}
        <div className="px-6 pb-4 grid grid-cols-2 gap-3">
          <StatTile
            label="Personal best"
            value={`${longestStreak} d`}
            accent="text-orange-400"
            isDark={isDark}
          />
          <StatTile
            label="Streak freezes"
            value={`${state.freezes} / ${MAX_FREEZES}`}
            accent="text-sky-400"
            isDark={isDark}
          />
        </div>

        {/* Freeze slots — tactile fire shields */}
        <div className="px-6 pb-4">
          <div className={`rounded-xl border p-4 ${isDark ? 'bg-[#1a1a1a] border-[#2e2e2e]' : 'bg-gray-50 border-gray-200'}`}>
            <div className="flex items-center gap-3 mb-3">
              <div className="flex gap-1.5">
                {Array.from({ length: MAX_FREEZES }).map((_, i) => {
                  const filled = i < state.freezes;
                  return (
                    <div
                      key={i}
                      className={`w-10 h-10 rounded-lg flex items-center justify-center transition-transform ${
                        filled
                          ? 'bg-gradient-to-br from-sky-400 to-sky-600 text-white shadow-md'
                          : isDark
                            ? 'bg-[#0f0f0f] border border-dashed border-zinc-700 text-zinc-600'
                            : 'bg-white border border-dashed border-gray-300 text-gray-400'
                      }`}
                    >
                      <Snowflake className="w-5 h-5" />
                    </div>
                  );
                })}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold">
                  {state.freezes === MAX_FREEZES
                    ? 'All freezes stocked'
                    : state.freezes > 0
                      ? `${state.freezes} freeze ready`
                      : 'No freezes right now'}
                </div>
                <div className={`text-xs ${subtle}`}>
                  {state.freezes >= MAX_FREEZES
                    ? "You're maxed out!"
                    : `${nextFreezeIn} day${nextFreezeIn === 1 ? '' : 's'} to next freeze.`}
                </div>
              </div>
            </div>
            {state.freezes < MAX_FREEZES && (
              <div className={`h-1.5 rounded-full overflow-hidden ${isDark ? 'bg-[#0f0f0f]' : 'bg-white'}`}>
                <div
                  className="h-full rounded-full bg-gradient-to-r from-sky-400 to-sky-600 transition-all"
                  style={{ width: `${Math.min(100, (state.streakDaysSinceFreezeGain / 30) * 100)}%` }}
                />
              </div>
            )}
          </div>
        </div>

        {/* How it works */}
        <div className="px-6 pb-10">
          <details className={`rounded-xl border p-3 text-xs ${isDark ? 'bg-[#1a1a1a] border-[#2e2e2e] text-zinc-400' : 'bg-gray-50 border-gray-200 text-gray-600'}`}>
            <summary className="cursor-pointer font-semibold select-none">How the streak works</summary>
            <ul className="mt-2 space-y-1.5 pl-4 list-disc marker:text-orange-400">
              <li>Every day you work out or log a rest day counts.</li>
              <li>Missed a day? A freeze (if you have one) covers it automatically.</li>
              <li>Stay consistent for 30 days to earn a new freeze (max 2).</li>
              <li>Skipping a day with no freeze resets the streak to zero.</li>
            </ul>
          </details>
        </div>

        <div style={{ height: 'env(safe-area-inset-bottom, 0px)' }} />
      </div>
    </div>
  );
}

function FlameHero({ count }: { count: number }) {
  // Big layered flame glyph with the count perched in the middle.
  return (
    <div className="relative">
      <Flame
        className="w-32 h-32 text-orange-500"
        fill="currentColor"
        strokeWidth={1.5}
      />
      <div
        className="absolute inset-0 flex items-end justify-center pb-4 text-white font-extrabold text-5xl"
        style={{ textShadow: '0 2px 10px rgba(0,0,0,0.35)' }}
      >
        {count}
      </div>
    </div>
  );
}

function StatTile({ label, value, accent, isDark }: { label: string; value: string; accent: string; isDark: boolean }) {
  return (
    <div
      className={`rounded-xl border p-3 ${
        isDark ? 'bg-[#1a1a1a] border-[#2e2e2e]' : 'bg-gray-50 border-gray-200'
      }`}
    >
      <div className={`text-[10px] font-semibold uppercase tracking-wider ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
        {label}
      </div>
      <div className={`text-lg font-bold ${accent}`}>{value}</div>
    </div>
  );
}
