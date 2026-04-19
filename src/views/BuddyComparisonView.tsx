import { useState, useEffect, useMemo } from 'react';
import {
  ArrowLeft, Crown, Loader2, Scale, Trophy, ChevronDown, ChevronUp,
} from 'lucide-react';
import type { Workout, MuscleGroup } from '../types';
import * as storage from '../storage';
import * as buddyService from '../buddyService';
import { Avatar } from '../components';
import { computeComparison, type ComparisonResult } from '../buddyComparison';

interface BuddyComparisonViewProps {
  buddyUid: string;
  buddyName: string;
  buddyPhotoURL?: string | null;
  isDark: boolean;
  onBack: () => void;
}

const MUSCLE_GROUP_LABELS: Record<MuscleGroup, string> = {
  chest: 'Chest',
  back: 'Back',
  shoulders: 'Shoulders',
  biceps: 'Biceps',
  triceps: 'Triceps',
  legs: 'Legs',
  core: 'Core',
  full_body: 'Full Body',
  other: 'Other',
};

function formatVolume(kg: number): string {
  if (kg >= 1000) return `${(kg / 1000).toFixed(1)}k`;
  return String(kg);
}

export function BuddyComparisonView({
  buddyUid, buddyName, buddyPhotoURL, isDark, onBack,
}: BuddyComparisonViewProps) {
  const [buddyWorkouts, setBuddyWorkouts] = useState<Workout[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showExclusives, setShowExclusives] = useState(false);

  const myWorkouts = useMemo(() => storage.getWorkouts(), []);
  const exercises = useMemo(() => storage.getExercises(), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const w = await buddyService.getBuddyWorkouts(buddyUid);
        if (!cancelled) setBuddyWorkouts(w);
      } catch (e) {
        if (!cancelled) {
          console.error('[BuddyCompare] Failed to load buddy workouts:', e);
          setError('Could not load buddy workouts.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [buddyUid]);

  const result: ComparisonResult | null = useMemo(() => {
    if (!buddyWorkouts) return null;
    return computeComparison(myWorkouts, buddyWorkouts, exercises);
  }, [myWorkouts, buddyWorkouts, exercises]);

  const cardBg = isDark ? 'bg-[#1a1a1a]' : 'bg-white';
  const cardBorder = isDark ? 'border-[#2e2e2e]' : 'border-gray-200';
  const subtleText = isDark ? 'text-zinc-400' : 'text-gray-500';
  const hoverBg = isDark ? 'hover:bg-[#222]' : 'hover:bg-gray-50';

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-orange-400" />
      </div>
    );
  }

  if (error || !result) {
    return (
      <div className="space-y-4 animate-fadeIn">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className={`p-2 rounded-lg transition-colors ${hoverBg}`}>
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-xl font-bold">Compare</h1>
        </div>
        <div className={`rounded-xl border p-6 text-center ${cardBg} ${cardBorder}`}>
          <Scale className={`w-10 h-10 mx-auto mb-2 ${subtleText}`} />
          <p className={`text-sm ${subtleText}`}>{error || 'Nothing to compare yet.'}</p>
        </div>
      </div>
    );
  }

  const noBuddyWorkouts = (buddyWorkouts?.length || 0) === 0;
  const noMyWorkouts = myWorkouts.length === 0;
  if (noBuddyWorkouts || noMyWorkouts) {
    const who = noBuddyWorkouts ? buddyName : 'You';
    return (
      <div className="space-y-4 animate-fadeIn">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className={`p-2 rounded-lg transition-colors ${hoverBg}`}>
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-xl font-bold">vs. {buddyName}</h1>
        </div>
        <div className={`rounded-xl border p-6 text-center ${cardBg} ${cardBorder}`}>
          <Trophy className={`w-10 h-10 mx-auto mb-2 ${subtleText}`} />
          <p className={`text-sm ${subtleText}`}>
            {who} haven't logged any workouts yet — check back soon!
          </p>
        </div>
      </div>
    );
  }

  const { headline, muscleGroups, exercises: faceoffs, exclusives, verdict } = result;
  const verdictLabel =
    verdict.meLeads > verdict.buddyLeads
      ? `You lead in ${verdict.meLeads} · They lead in ${verdict.buddyLeads} · ${verdict.ties} tied`
      : verdict.buddyLeads > verdict.meLeads
        ? `They lead in ${verdict.buddyLeads} · You lead in ${verdict.meLeads} · ${verdict.ties} tied`
        : `Tied at ${verdict.meLeads}-${verdict.buddyLeads} · ${verdict.ties} ties`;
  const verdictColor =
    verdict.meLeads > verdict.buddyLeads
      ? 'bg-orange-500/15 text-orange-400 border-orange-500/30'
      : verdict.buddyLeads > verdict.meLeads
        ? 'bg-blue-500/15 text-blue-400 border-blue-500/30'
        : isDark
          ? 'bg-zinc-800 text-zinc-300 border-zinc-700'
          : 'bg-gray-100 text-gray-600 border-gray-300';

  const winGradient = (side: 'me' | 'buddy' | 'tie', target: 'me' | 'buddy') =>
    side === target
      ? 'border-orange-500/50 bg-gradient-to-br from-orange-500/10 to-transparent'
      : cardBorder;

  const myExclusives = exclusives.filter((e) => e.side === 'me');
  const buddyExclusives = exclusives.filter((e) => e.side === 'buddy');

  return (
    <div className="space-y-4 animate-fadeIn">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className={`p-2 rounded-lg transition-colors ${hoverBg}`}>
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-xl font-bold">vs. {buddyName}</h1>
      </div>

      <div className={`rounded-xl border p-4 flex items-center justify-around ${cardBg} ${cardBorder}`}>
        <div className="flex flex-col items-center gap-1">
          <Avatar name="You" size="lg" />
          <div className="text-xs font-medium">You</div>
        </div>
        <div className={`text-sm font-bold ${subtleText}`}>VS</div>
        <div className="flex flex-col items-center gap-1">
          <Avatar name={buddyName} photoURL={buddyPhotoURL || null} size="lg" />
          <div className="text-xs font-medium truncate max-w-[120px]">{buddyName}</div>
        </div>
      </div>

      <div className={`rounded-full border px-4 py-2 text-center text-xs font-semibold ${verdictColor}`}>
        {verdictLabel}
      </div>

      <div>
        <h3 className={`text-xs font-semibold uppercase tracking-wider mb-2 ${subtleText}`}>
          Scoreboard
        </h3>
        <div className="space-y-2">
          {[
            { label: 'Workouts', me: headline.me.totalWorkouts, buddy: headline.buddy.totalWorkouts, suffix: '' },
            { label: 'Streak', me: headline.me.currentStreak, buddy: headline.buddy.currentStreak, suffix: 'd' },
            { label: 'Total volume', me: formatVolume(headline.me.totalVolume), buddy: formatVolume(headline.buddy.totalVolume), suffix: 'kg' },
            { label: 'Avg / session', me: formatVolume(headline.me.avgVolumePerSession), buddy: formatVolume(headline.buddy.avgVolumePerSession), suffix: 'kg' },
          ].map((row) => {
            const meVal = typeof row.me === 'number' ? row.me : parseFloat(row.me);
            const buddyVal = typeof row.buddy === 'number' ? row.buddy : parseFloat(row.buddy);
            const winner: 'me' | 'buddy' | 'tie' =
              meVal > buddyVal ? 'me' : buddyVal > meVal ? 'buddy' : 'tie';
            return (
              <div key={row.label} className={`rounded-xl border p-3 grid grid-cols-[1fr_auto_1fr] gap-3 items-center ${cardBg} ${cardBorder}`}>
                <div className={`text-right rounded-lg px-3 py-2 border ${winGradient(winner, 'me')}`}>
                  <div className="text-lg font-bold flex items-center justify-end gap-1.5">
                    {winner === 'me' && <Crown className="w-4 h-4 text-yellow-400" />}
                    {row.me}{row.suffix}
                  </div>
                </div>
                <div className={`text-[10px] font-semibold uppercase ${subtleText}`}>{row.label}</div>
                <div className={`text-left rounded-lg px-3 py-2 border ${winGradient(winner, 'buddy')}`}>
                  <div className="text-lg font-bold flex items-center gap-1.5">
                    {row.buddy}{row.suffix}
                    {winner === 'buddy' && <Crown className="w-4 h-4 text-yellow-400" />}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {muscleGroups.length > 0 && (
        <div>
          <h3 className={`text-xs font-semibold uppercase tracking-wider mb-2 ${subtleText}`}>
            Muscle Groups
          </h3>
          <div className={`rounded-xl border divide-y ${cardBg} ${cardBorder} ${isDark ? 'divide-[#2e2e2e]' : 'divide-gray-200'}`}>
            {muscleGroups.map((mg) => {
              const total = mg.meVolume + mg.buddyVolume;
              const mePct = total > 0 ? (mg.meVolume / total) * 100 : 0;
              const buddyPct = 100 - mePct;
              const meColor = mg.winner === 'me' ? 'bg-orange-500' : isDark ? 'bg-zinc-700' : 'bg-gray-300';
              const buddyColor = mg.winner === 'buddy' ? 'bg-orange-500' : isDark ? 'bg-zinc-700' : 'bg-gray-300';
              const label =
                mg.winner === 'me' ? 'You lead' : mg.winner === 'buddy' ? 'They lead' : 'Tied';
              return (
                <div key={mg.group} className="p-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="text-sm font-medium">{MUSCLE_GROUP_LABELS[mg.group]}</div>
                    <div className={`text-xs ${
                      mg.winner === 'me' ? 'text-orange-400' : mg.winner === 'buddy' ? 'text-blue-400' : subtleText
                    }`}>{label}</div>
                  </div>
                  <div className="flex h-2 rounded-full overflow-hidden">
                    <div className={meColor} style={{ width: `${mePct}%` }} />
                    <div className={buddyColor} style={{ width: `${buddyPct}%` }} />
                  </div>
                  <div className={`flex justify-between text-[10px] mt-1 ${subtleText}`}>
                    <span>You · {formatVolume(mg.meVolume)}kg</span>
                    <span>{formatVolume(mg.buddyVolume)}kg · Them</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {faceoffs.length > 0 && (
        <div>
          <h3 className={`text-xs font-semibold uppercase tracking-wider mb-2 ${subtleText}`}>
            Exercise Face-off
          </h3>
          <div className="space-y-2">
            {faceoffs.map((f) => (
              <div key={f.exerciseId} className={`rounded-xl border p-3 ${cardBg} ${cardBorder}`}>
                <div className="text-sm font-medium mb-2">{f.exerciseName}</div>
                <div className="grid grid-cols-2 gap-2">
                  <div className={`rounded-lg px-3 py-2 border ${winGradient(f.winner, 'me')}`}>
                    <div className="flex items-center justify-between">
                      <div className="text-[10px] uppercase font-semibold opacity-60">You</div>
                      {f.winner === 'me' && <Crown className="w-3.5 h-3.5 text-yellow-400" />}
                    </div>
                    <div className="text-base font-bold">{f.me.maxWeight}kg × {f.me.repsAtMax}</div>
                    <div className={`text-[11px] ${subtleText}`}>est. 1RM {f.me.est1RM}kg</div>
                  </div>
                  <div className={`rounded-lg px-3 py-2 border ${winGradient(f.winner, 'buddy')}`}>
                    <div className="flex items-center justify-between">
                      <div className="text-[10px] uppercase font-semibold opacity-60">{buddyName}</div>
                      {f.winner === 'buddy' && <Crown className="w-3.5 h-3.5 text-yellow-400" />}
                    </div>
                    <div className="text-base font-bold">{f.buddy.maxWeight}kg × {f.buddy.repsAtMax}</div>
                    <div className={`text-[11px] ${subtleText}`}>est. 1RM {f.buddy.est1RM}kg</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {exclusives.length > 0 && (
        <div>
          <button
            onClick={() => setShowExclusives((v) => !v)}
            className={`w-full flex items-center justify-between text-xs font-semibold uppercase tracking-wider ${subtleText} py-1`}
          >
            <span>Exclusive exercises ({exclusives.length})</span>
            {showExclusives ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {showExclusives && (
            <div className="space-y-3 mt-2">
              {myExclusives.length > 0 && (
                <div>
                  <div className={`text-[11px] font-semibold mb-1 ${subtleText}`}>Only you've logged</div>
                  <div className={`rounded-xl border divide-y ${cardBg} ${cardBorder} ${isDark ? 'divide-[#2e2e2e]' : 'divide-gray-200'}`}>
                    {myExclusives.map((e) => (
                      <div key={e.exerciseId} className="flex items-center justify-between p-3 text-sm">
                        <span>{e.exerciseName}</span>
                        <span className={subtleText}>{e.maxWeight}kg × {e.repsAtMax}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {buddyExclusives.length > 0 && (
                <div>
                  <div className={`text-[11px] font-semibold mb-1 ${subtleText}`}>Only {buddyName} has logged</div>
                  <div className={`rounded-xl border divide-y ${cardBg} ${cardBorder} ${isDark ? 'divide-[#2e2e2e]' : 'divide-gray-200'}`}>
                    {buddyExclusives.map((e) => (
                      <div key={e.exerciseId} className="flex items-center justify-between p-3 text-sm">
                        <span>{e.exerciseName}</span>
                        <span className={subtleText}>{e.maxWeight}kg × {e.repsAtMax}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
