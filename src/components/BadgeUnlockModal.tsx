import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Share2, X } from 'lucide-react';
import { registerBackHandler } from '../backHandlerRegistry';
import type { BadgeDef } from '../badges';
import { BadgeArt } from './BadgeArt';
import { feedback } from '../feedback';
import { Button, IconButton, CAPTION, SUB } from '../ui';

/**
 * "Achievement unlocked", done properly.
 *
 * What makes Duolingo's land, and what this borrows: the celebration fires
 * the instant the thing happens so cause and effect are unmistakable; the
 * reveal is *staged* rather than all at once (badge, then name, then what it
 * took, then the buttons), which reads as a performance instead of a dialog;
 * and it arrives with sound and a haptic pattern, because a silent
 * celebration is just a screen.
 *
 * A toast at the bottom of the page — which is what this replaced — is the
 * one thing an achievement must not be.
 */

const PIECES = 26;

interface Piece { id: number; left: number; delay: number; duration: number; size: number; hue: number; rotate: number }

/** Deterministic per badge, so the same unlock always looks the same. */
function confettiFor(seed: string): Piece[] {
  let x = 0;
  for (let i = 0; i < seed.length; i++) x = (x * 31 + seed.charCodeAt(i)) >>> 0;
  const next = () => {
    x ^= x << 13; x >>>= 0;
    x ^= x >> 17;
    x ^= x << 5; x >>>= 0;
    return x / 0xffffffff;
  };
  return Array.from({ length: PIECES }, (_, id) => ({
    id,
    left: next() * 100,
    delay: next() * 0.5,
    duration: 1.8 + next() * 1.4,
    size: 6 + next() * 7,
    hue: 20 + next() * 45,
    rotate: next() * 360,
  }));
}

export function BadgeUnlockModal({ badges, onClose }: { badges: BadgeDef[]; onClose: () => void }) {
  const [i, setI] = useState(0);
  // Keyed by index, so moving to the next badge restarts the choreography
  // without a synchronous reset inside the effect.
  const [stage, setStage] = useState(0);
  const badge = badges[i];
  const last = i === badges.length - 1;
  const pieces = useMemo(() => confettiFor(badge?.id ?? ''), [badge?.id]);

  // Stagger the reveal. Each step is a frame or two apart — enough to read as
  // choreography, not enough to make anyone wait.
  useEffect(() => {
    feedback('levelUp');
    const timers = [0, 140, 260, 380].map((ms, n) => window.setTimeout(() => setStage(n), ms));
    return () => timers.forEach(clearTimeout);
  }, [i]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    // The phone's back button closes it too — an overlay that ignores back
    // leaves the screen behind it navigating underneath.
    const unregister = registerBackHandler(() => { onClose(); return true; });
    return () => { window.removeEventListener('keydown', onKey); unregister(); };
  }, [onClose]);

  if (!badge) return null;

  const share = async () => {
    const text = `${badge.name} unlocked on Zenith Fitness — ${badge.detail}.`;
    try {
      if (navigator.share) { await navigator.share({ title: badge.name, text }); return; }
      await navigator.clipboard.writeText(text);
    } catch { /* dismissed, or no clipboard — nothing to recover from */ }
  };

  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center px-6" role="dialog" aria-modal="true" aria-label={`${badge.name} unlocked`}>
      <div className="absolute inset-0 bg-black/78 backdrop-blur-sm" onClick={onClose} />

      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
        {pieces.map((p) => (
          <span
            key={`${badge.id}-${p.id}`}
            className="absolute top-[-8%] rounded-[2px]"
            style={{
              left: `${p.left}%`,
              width: p.size,
              height: p.size * 1.6,
              background: `hsl(${p.hue} 92% 58%)`,
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

        {/* The badge itself, springing in with a glow behind it. */}
        <div className="relative mx-auto mt-4 w-[132px] h-[132px] flex items-center justify-center">
          <span
            className="absolute inset-0 rounded-full bg-accent/25 blur-2xl"
            style={{ animation: 'badge-glow 1.6s ease-out' }}
            aria-hidden="true"
          />
          <span className="relative" style={{ animation: 'badge-pop 620ms cubic-bezier(0.34, 1.56, 0.64, 1)' }}>
            <BadgeArt badge={badge} size={116} />
          </span>
        </div>

        <h2
          className="font-display text-xl font-bold text-text mt-4 transition-all duration-300"
          style={{ opacity: stage >= 1 ? 1 : 0, transform: `translateY(${stage >= 1 ? 0 : 8}px)` }}
        >
          {badge.name}
        </h2>
        <p
          className={`${SUB} mt-1 transition-all duration-300`}
          style={{ opacity: stage >= 2 ? 1 : 0, transform: `translateY(${stage >= 2 ? 0 : 8}px)` }}
        >
          {badge.detail}
        </p>

        <div
          className="flex gap-2 mt-5 transition-all duration-300"
          style={{ opacity: stage >= 3 ? 1 : 0, transform: `translateY(${stage >= 3 ? 0 : 8}px)` }}
        >
          <Button variant="secondary" size="lg" full icon={Share2} onClick={() => { void share(); }}>Share</Button>
          <Button
            variant="primary"
            size="lg"
            full
            icon={last ? undefined : ChevronRight}
            onClick={() => { if (last) { onClose(); return; } setStage(0); setI((n) => n + 1); }}
          >
            {last ? 'Nice' : `Next (${badges.length - i - 1})`}
          </Button>
        </div>
      </div>
    </div>
  );
}
