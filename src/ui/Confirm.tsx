import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Sheet } from './Sheet';
import { Button } from './Button';
import { SUB } from './styles';

/**
 * Promise-based replacements for window.confirm / window.prompt rendered as
 * kit sheets. Native dialogs look foreign inside the app, block the WebView
 * event loop and cannot be styled; these follow the theme and the Android
 * back button closes them (via Sheet). Mount `ConfirmProvider` once (main.tsx)
 * and call `const { confirm, promptText } = useConfirm()` from any component.
 */
export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** `danger` paints the confirm button red — use for deletes and discards. */
  tone?: 'primary' | 'danger';
}

export interface PromptOptions {
  title?: string;
  message?: string;
  label?: string;
  initial?: string;
  placeholder?: string;
  confirmLabel?: string;
  maxLength?: number;
}

interface ConfirmContextValue {
  confirm: (opts: ConfirmOptions | string) => Promise<boolean>;
  promptText: (opts: PromptOptions) => Promise<string | null>;
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

type Pending =
  | { kind: 'confirm'; opts: ConfirmOptions; resolve: (v: boolean) => void }
  | { kind: 'prompt'; opts: PromptOptions; resolve: (v: string | null) => void };

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [text, setText] = useState('');
  const pendingRef = useRef<Pending | null>(null);

  const settle = useCallback((value: boolean | string | null) => {
    const p = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    if (!p) return;
    if (p.kind === 'confirm') p.resolve(Boolean(value));
    else p.resolve(typeof value === 'string' ? value : null);
  }, []);

  const confirm = useCallback((optsOrMessage: ConfirmOptions | string) => {
    const opts = typeof optsOrMessage === 'string' ? { message: optsOrMessage } : optsOrMessage;
    // A second dialog while one is open cancels the first — mirrors how a
    // second window.confirm would have queued but keeps the UI sane.
    if (pendingRef.current) settle(pendingRef.current.kind === 'confirm' ? false : null);
    return new Promise<boolean>((resolve) => {
      const p: Pending = { kind: 'confirm', opts, resolve };
      pendingRef.current = p;
      setPending(p);
    });
  }, [settle]);

  const promptText = useCallback((opts: PromptOptions) => {
    if (pendingRef.current) settle(pendingRef.current.kind === 'confirm' ? false : null);
    setText(opts.initial ?? '');
    return new Promise<string | null>((resolve) => {
      const p: Pending = { kind: 'prompt', opts, resolve };
      pendingRef.current = p;
      setPending(p);
    });
  }, [settle]);

  const value = useMemo(() => ({ confirm, promptText }), [confirm, promptText]);
  const cancel = useCallback(() => settle(pending?.kind === 'confirm' ? false : null), [settle, pending]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      {pending?.kind === 'confirm' && (
        <Sheet open onClose={cancel} title={pending.opts.title ?? 'Are you sure?'}>
          <p className={`${SUB} whitespace-pre-line`}>{pending.opts.message}</p>
          <div className="flex gap-2 pt-1">
            <Button variant="secondary" size="lg" full onClick={cancel}>{pending.opts.cancelLabel ?? 'Cancel'}</Button>
            <Button variant={pending.opts.tone === 'danger' ? 'danger' : 'primary'} size="lg" full onClick={() => settle(true)}>
              {pending.opts.confirmLabel ?? 'Confirm'}
            </Button>
          </div>
        </Sheet>
      )}
      {pending?.kind === 'prompt' && (
        <Sheet open onClose={cancel} title={pending.opts.title ?? 'Enter a value'}>
          {pending.opts.message && <p className={SUB}>{pending.opts.message}</p>}
          <label className="flex flex-col gap-1">
            {pending.opts.label && <span className="text-xs font-semibold tracking-wide uppercase text-subtle">{pending.opts.label}</span>}
            <input
              autoFocus
              value={text}
              maxLength={pending.opts.maxLength ?? 80}
              placeholder={pending.opts.placeholder}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && text.trim()) settle(text.trim()); }}
              className="px-3 py-2.5 rounded-control border border-border bg-surface-2 text-text placeholder:text-subtle text-sm outline-none focus:border-accent"
            />
          </label>
          <div className="flex gap-2 pt-1">
            <Button variant="secondary" size="lg" full onClick={cancel}>Cancel</Button>
            <Button variant="primary" size="lg" full disabled={!text.trim()} onClick={() => settle(text.trim())}>
              {pending.opts.confirmLabel ?? 'Save'}
            </Button>
          </div>
        </Sheet>
      )}
    </ConfirmContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useConfirm(): ConfirmContextValue {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used inside <ConfirmProvider>');
  return ctx;
}
