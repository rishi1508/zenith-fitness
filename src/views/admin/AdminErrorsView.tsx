import { useEffect, useState } from 'react';
import { ArrowLeft, Bug, RefreshCw } from 'lucide-react';
import { listClientErrors, type ClientErrorDoc } from '../../audit';
import { relativeTime } from '../../auditFormat';
import { Card, EmptyState, IconButton, Sheet, Skeleton, useToast, H1, SUB, CAPTION } from '../../ui';

/**
 * Zenith admin: the errors people's phones hit, newest first — message,
 * version, platform, the screens they visited just before. Written by
 * src/audit.ts (throttled), read here. Rules make it admin-only.
 */
export function AdminErrorsView({ onBack }: { onBack: () => void }) {
  const [rows, setRows] = useState<ClientErrorDoc[] | null>(null);
  const [open, setOpen] = useState<ClientErrorDoc | null>(null);
  const [tick, setTick] = useState(0);
  const { showToast } = useToast();

  useEffect(() => {
    let cancelled = false;
    listClientErrors(100)
      .then((r) => { if (!cancelled) setRows(r); })
      .catch((err) => { if (!cancelled) { setRows([]); showToast(err instanceof Error ? err.message : 'Could not load errors.', 'error'); } });
    return () => { cancelled = true; };
  }, [tick, showToast]);

  return (
    <div className="space-y-4 animate-fadeIn">
      <div className="flex items-center gap-2">
        <button aria-label="Back" onClick={onBack} className="w-10 h-10 -ml-2 shrink-0 flex items-center justify-center rounded-control text-muted hover:text-text transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className={H1}>Errors</h1>
          <p className={`${CAPTION} mt-0.5`}>Uncaught errors reported by the app · newest first</p>
        </div>
        <IconButton icon={RefreshCw} label="Refresh" onClick={() => setTick((n) => n + 1)} />
      </div>

      {rows === null ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
      ) : rows.length === 0 ? (
        <EmptyState icon={Bug} title="No errors reported" body="When a phone hits an uncaught error, it lands here with the last screens the person visited." />
      ) : (
        <Card padding="list">
          {rows.map((r) => (
            <button key={r.id} type="button" onClick={() => setOpen(r)} className="w-full text-left flex items-start gap-3 px-4 py-3 border-b border-border last:border-b-0">
              <div className="w-9 h-9 shrink-0 rounded-control bg-danger/10 text-danger flex items-center justify-center mt-0.5"><Bug className="w-4 h-4" strokeWidth={1.75} /></div>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-text truncate">{r.message}</p>
                <p className={`${SUB} mt-0.5 truncate`}>{relativeTime(r.at)} · v{r.appVersion} · {r.platform} · {r.view ?? 'unknown screen'} · {r.uid.slice(0, 6)}…</p>
              </div>
            </button>
          ))}
        </Card>
      )}

      <Sheet open={!!open} onClose={() => setOpen(null)} title="Error detail">
        {open && (
          <div className="space-y-3 text-sm">
            <p className="text-text font-medium break-words">{open.message}</p>
            <p className={SUB}>{new Date(open.at).toLocaleString('en-IN')} · v{open.appVersion} · {open.platform} · {open.source} · user {open.uid}</p>
            {open.breadcrumbs.length > 0 && (
              <div>
                <p className={CAPTION}>Screens before the error</p>
                <p className={`${SUB} mt-1 break-words`}>{open.breadcrumbs.map((c) => c.label).join(' → ')}</p>
              </div>
            )}
            {open.stack && (
              <pre className="text-[11px] leading-4 text-subtle whitespace-pre-wrap break-words max-h-64 overflow-auto rounded-control bg-surface-2 p-3">{open.stack}</pre>
            )}
            <p className={`${SUB} break-words`}>{open.ua}</p>
          </div>
        )}
      </Sheet>
    </div>
  );
}
