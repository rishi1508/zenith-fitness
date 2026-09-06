import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { registerBackHandler } from '../backHandlerRegistry';
import { H2 } from './styles';

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
}

/**
 * Bottom sheet: scrim, grab handle, optional title. Registers with the
 * back-handler registry while open so Android/browser back closes it
 * before the view stack pops. Renders nothing when `open` is false.
 */
export function Sheet({ open, onClose, title, children }: SheetProps) {
  useEffect(() => {
    if (!open) return;
    return registerBackHandler(() => { onClose(); return true; });
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end justify-center" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/55" onClick={onClose} />
      <div
        className="relative w-full max-w-lg bg-surface border-t border-border rounded-t-[24px] px-5 pt-3 flex flex-col gap-3.5 max-h-[85dvh] overflow-y-auto animate-fadeIn"
        style={{ paddingBottom: 'calc(28px + env(safe-area-inset-bottom, 0px))' }}
      >
        <div className="w-10 h-1 rounded-sm bg-border mx-auto mb-1" aria-hidden="true" />
        {title && <h2 className={H2}>{title}</h2>}
        {children}
      </div>
    </div>,
    document.body,
  );
}
