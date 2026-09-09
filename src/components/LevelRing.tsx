import { useState } from 'react';
import { levelForVolume, levelTitle } from '../levels';

interface LevelRingProps {
  /** Outer diameter in px. */
  size: number;
  totalVolumeKg: number;
  photoURL?: string | null;
  name?: string;
  /** Show the level number in a badge on the ring. Off below ~40px. */
  showLevel?: boolean;
  /** Dims the ring when the tab is not the current one. */
  muted?: boolean;
  className?: string;
}

/**
 * The user's photo inside their experience level: the ring is the progress
 * through the current level, so the level is something you glance at rather
 * than go and look up. Used at 26px in the tab bar and at 72px on the You
 * screen, which is why the level badge is optional.
 */
export function LevelRing({ size, totalVolumeKg, photoURL, name, showLevel, muted, className = '' }: LevelRingProps) {
  const [broken, setBroken] = useState(false);
  const p = levelForVolume(totalVolumeKg);
  const stroke = Math.max(2, Math.round(size * 0.07));
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const inner = size - stroke * 2 - 2;

  return (
    <span
      className={`relative inline-flex items-center justify-center shrink-0 ${className}`}
      style={{ width: size, height: size }}
      title={name ? `${name} · Level ${p.level}, ${levelTitle(p.level)}` : `Level ${p.level}`}
    >
      <svg width={size} height={size} className="absolute inset-0 -rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-border" />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round"
          className={muted ? 'stroke-subtle' : 'stroke-accent'}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - p.fraction)}
          style={{ transition: 'stroke-dashoffset 600ms ease-out' }}
        />
      </svg>
      {photoURL && !broken ? (
        <img
          src={photoURL}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setBroken(true)}
          className="rounded-full object-cover"
          style={{ width: inner, height: inner }}
        />
      ) : (
        <span
          className="rounded-full bg-accent-soft text-accent font-display font-bold flex items-center justify-center"
          style={{ width: inner, height: inner, fontSize: Math.max(10, Math.round(inner * 0.42)) }}
        >
          {(name || '?').charAt(0).toUpperCase()}
        </span>
      )}
      {showLevel && (
        <span
          className="absolute -bottom-0.5 -right-0.5 rounded-full bg-accent text-white font-bold tabular-nums flex items-center justify-center border-2 border-bg"
          style={{ minWidth: size * 0.34, height: size * 0.34, fontSize: Math.max(9, size * 0.19), paddingInline: 3 }}
        >
          {p.level}
        </span>
      )}
    </span>
  );
}
