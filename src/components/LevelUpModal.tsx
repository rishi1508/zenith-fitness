import { useEffect, useMemo, useState } from 'react';
import { Share2, Sparkles, Users, X } from 'lucide-react';
import { formatVolume, levelTitle } from '../levels';
import { Button, IconButton, CAPTION, SUB } from '../ui';

/**
 * Confetti: 60 CSS-animated pieces, no dependency. The scatter comes from a
 * seeded generator rather than Math.random so the component stays pure — the
 * same level always celebrates the same way, which also makes it testable.
 */
function confettiFor(seed: number, count = 60) {
  let state = (seed * 2654435761) >>> 0 || 1;
  const rnd = () => {
    state ^= state << 13; state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5; state >>>= 0;
    return state / 0xffffffff;
  };
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    left: rnd() * 100,
    delay: rnd() * 0.6,
    duration: 2.2 + rnd() * 1.6,
    size: 6 + rnd() * 6,
    rotate: rnd() * 360,
    hue: [24, 32, 45, 140, 200, 280][i % 6],
  }));
}

export interface LevelUpModalProps {
  level: number;
  /** The level they were on before this workout — shown as "Level 7 → 8". */
  from?: number;
  totalVolumeKg: number;
  /** Present when the user is in a gym: offers the achievement to its feed. */
  onShareToGym?: () => Promise<void>;
  gymName?: string;
  onClose: () => void;
}

/**
 * "Level N unlocked" celebration, shown once when lifetime volume crosses a
 * level threshold (see `src/levels.ts`). Shareable: the Web Share sheet on a
 * phone, clipboard everywhere else.
 */
export function LevelUpModal({ level, from, totalVolumeKg, onShareToGym, gymName, onClose }: LevelUpModalProps) {
  const pieces = useMemo(() => confettiFor(level), [level]);
  const [shared, setShared] = useState<'idle' | 'copied'>('idle');
  const [gymShare, setGymShare] = useState<'idle' | 'sharing' | 'done'>('idle');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const text = `Level ${level} unlocked on Zenith Fitness — ${levelTitle(level)}, ${formatVolume(totalVolumeKg)} lifted all time. 💪`;

  const share = async () => {
    try {
      if (navigator.share) {
        await navigator.share({ title: `Level ${level} unlocked`, text });
        return;
      }
    } catch { /* user dismissed the sheet — fall through to copy */ }
    try {
      await navigator.clipboard.writeText(text);
      setShared('copied');
      setTimeout(() => setShared('idle'), 2000);
    } catch { /* clipboard blocked; nothing else to try */ }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center px-6" role="dialog" aria-modal="true" aria-label={`Level ${level} unlocked`}>
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />

      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
        {pieces.map((p) => (
          <span
            key={p.id}
            className="absolute top-[-8%] rounded-[2px]"
            style={{
              left: `${p.left}%`,
              width: p.size,
              height: p.size * 1.6,
              background: `hsl(${p.hue} 90% 58%)`,
              transform: `rotate(${p.rotate}deg)`,
              animation: `zenith-confetti ${p.duration}s linear ${p.delay}s forwards`,
            }}
          />
        ))}
      </div>

      <div className="relative w-full max-w-sm rounded-card border border-border bg-surface p-6 text-center animate-fadeIn">
        <div className="absolute top-3 right-3">
          <IconButton icon={X} label="Close" size="sm" onClick={onClose} />
        </div>

        <span className={CAPTION}>Achievement unlocked</span>

        <div className="mx-auto mt-3 w-24 h-24 rounded-full bg-accent-soft flex flex-col items-center justify-center">
          <Sparkles className="w-5 h-5 text-accent" strokeWidth={2} />
          <span className="font-display text-[34px] leading-9 font-bold text-accent tabular-nums">{level}</span>
        </div>

        <h2 className="font-display text-xl font-bold text-text mt-3">
          {from ? `Level ${from} → ${level}` : `Level ${level}`}
        </h2>
        <p className="text-sm font-semibold text-accent mt-0.5">{levelTitle(level)}</p>
        <p className={`${SUB} mt-2`}>
          {formatVolume(totalVolumeKg)} lifted all time. Every kilo you log counts towards the next one.
        </p>

        {onShareToGym && gymName && (
          <button
            onClick={() => {
              if (gymShare !== 'idle') return;
              setGymShare('sharing');
              onShareToGym().then(() => setGymShare('done')).catch(() => setGymShare('idle'));
            }}
            disabled={gymShare !== 'idle'}
            className={`w-full min-h-11 mt-4 rounded-control border text-sm font-semibold flex items-center justify-center gap-2 ${
              gymShare === 'done' ? 'border-ok/40 text-ok' : 'border-border text-text'
            } disabled:opacity-70`}
          >
            <Users className="w-4 h-4" strokeWidth={1.75} />
            <span className="truncate">
              {gymShare === 'done' ? `Shared with ${gymName}` : gymShare === 'sharing' ? 'Sharing…' : `Share with ${gymName}`}
            </span>
          </button>
        )}

        <div className="flex gap-2 mt-3">
          <Button variant="secondary" size="lg" full icon={Share2} onClick={share}>
            {shared === 'copied' ? 'Copied' : 'Share'}
          </Button>
          <Button variant="primary" size="lg" full onClick={onClose}>Nice</Button>
        </div>
      </div>
    </div>
  );
}
