import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { registerBackHandler } from '../backHandlerRegistry';

/**
 * Press and hold a profile picture to see it properly — the Instagram
 * gesture. The photo lifts to the middle of the screen, still circular,
 * while everything behind it blurs and dims. Let go and it drops back.
 *
 * Hold, not tap, because a tap on an avatar already means "open this
 * person's profile" everywhere in the app and that must keep working.
 */

const HOLD_MS = 320;
const MOVE_CANCEL_PX = 10;

export function AvatarPeek({ photoURL, name, children }: {
  photoURL?: string | null;
  name: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const timer = useRef<number | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);

  const clear = () => {
    if (timer.current !== null) { clearTimeout(timer.current); timer.current = null; }
  };

  useEffect(() => clear, []);

  useEffect(() => {
    if (!open) return;
    return registerBackHandler(() => { setOpen(false); return true; });
  }, [open]);

  // Nothing to enlarge without a photo — leave the tap behaviour alone.
  if (!photoURL) return <>{children}</>;

  return (
    <>
      <span
        onPointerDown={(e) => {
          start.current = { x: e.clientX, y: e.clientY };
          clear();
          timer.current = window.setTimeout(() => setOpen(true), HOLD_MS);
        }}
        onPointerMove={(e) => {
          if (!start.current) return;
          const moved = Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y);
          if (moved > MOVE_CANCEL_PX) clear();
        }}
        onPointerUp={() => { clear(); setOpen(false); }}
        onPointerCancel={() => { clear(); setOpen(false); }}
        onPointerLeave={() => clear()}
        onContextMenu={(e) => { if (open) e.preventDefault(); }}
        className="inline-flex touch-none"
      >
        {children}
      </span>

      {open && createPortal(
        <div
          className="fixed inset-0 z-[150] flex items-center justify-center px-10"
          role="dialog"
          aria-modal="true"
          aria-label={`${name}'s photo`}
          onPointerUp={() => setOpen(false)}
        >
          <div className="absolute inset-0 bg-black/55 backdrop-blur-xl" />
          <img
            src={photoURL}
            alt={name}
            referrerPolicy="no-referrer"
            className="relative w-full max-w-[280px] aspect-square rounded-full object-cover border-4 border-white/15 shadow-2xl"
            style={{ animation: 'avatar-peek 260ms cubic-bezier(0.22, 1, 0.36, 1)' }}
          />
          <span className="absolute left-0 right-0 bottom-24 text-center text-sm font-semibold text-white/90">
            {name}
          </span>
        </div>,
        document.body,
      )}
    </>
  );
}
