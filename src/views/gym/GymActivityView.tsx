import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ClipboardList, CreditCard, ScanLine, Settings2, UserRound, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { GymViewProps } from './types';
import { useGym } from '../../gym/GymContext';
import { useAuth } from '../../auth/AuthContext';
import { isAdmin } from '../../admin';
import { listenToAudit, type AuditEntry } from '../../audit';
import { auditCategory, describeAudit, relativeTime, type AuditCategory } from '../../auditFormat';
import { Card, Chip, EmptyState, H1, SUB, CAPTION } from '../../ui';

type Filter = 'all' | AuditCategory;
const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'members', label: 'Members' },
  { value: 'payments', label: 'Payments' },
  { value: 'checkins', label: 'Check-ins' },
  { value: 'content', label: 'Content' },
  { value: 'settings', label: 'Settings' },
];
const ICON: Record<AuditCategory, LucideIcon> = {
  members: Users, payments: CreditCard, checkins: ScanLine, content: ClipboardList, settings: Settings2, account: UserRound,
};

/**
 * Everything staff and members did in the gym, newest first — who added
 * whom, who took which payment, who rotated the code, who changed a plan.
 * Owners and managers only. Entries are written once and never edited.
 */
export function GymActivityView({ onBack, onOpenProfile }: GymViewProps) {
  const { gym, role } = useGym();
  const { user } = useAuth();
  const canView = role === 'manager' || role === 'owner' || isAdmin(user?.uid);
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!gym?.id || !canView) return;
    return listenToAudit(gym.id, setEntries, 300);
  }, [gym?.id, canView]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (entries ?? []).filter((e) => (filter === 'all' || auditCategory(e.action) === filter)
      && (!q || describeAudit(e).toLowerCase().includes(q)));
  }, [entries, filter, search]);

  // Group by calendar day so a busy desk reads as a diary, not a wall.
  const days = useMemo(() => {
    const map = new Map<string, AuditEntry[]>();
    for (const e of shown) {
      const key = new Date(e.at).toDateString();
      map.set(key, [...(map.get(key) ?? []), e]);
    }
    return [...map.entries()];
  }, [shown]);

  if (!gym) return null;

  return (
    <div className="space-y-4 animate-fadeIn">
      <div className="flex items-center gap-2">
        <button aria-label="Back" onClick={onBack} className="w-10 h-10 -ml-2 shrink-0 flex items-center justify-center rounded-control text-muted hover:text-text transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className={H1}>Activity</h1>
          <p className={`${CAPTION} mt-0.5`}>{gym.name} · last {entries?.length ?? 0} actions</p>
        </div>
      </div>

      {!canView ? (
        <Card><p className={SUB}>Owners and managers only.</p></Card>
      ) : (
        <>
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
            {FILTERS.map((f) => (
              <Chip key={f.value} on={filter === f.value} onClick={() => setFilter(f.value)}>{f.label}</Chip>
            ))}
          </div>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or action"
            aria-label="Search activity"
            className="w-full h-11 px-3 rounded-control border border-border bg-surface-2 text-text placeholder:text-subtle text-sm outline-none focus:border-accent/50"
          />

          {entries === null ? (
            <Card><p className={SUB}>Loading…</p></Card>
          ) : shown.length === 0 ? (
            <EmptyState icon={ClipboardList} title="Nothing here yet" body={entries.length === 0 ? 'Actions at the desk and in the app show up here as they happen.' : 'Nothing matches that filter.'} />
          ) : (
            days.map(([day, list]) => (
              <div key={day} className="space-y-2">
                <p className={CAPTION}>{new Date(list[0].at).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' })}</p>
                <Card padding="list">
                  {list.map((e) => {
                    const cat = auditCategory(e.action);
                    const Icon = ICON[cat];
                    return (
                      <div key={e.id} className="flex items-start gap-3 px-4 py-3 border-b border-border last:border-b-0">
                        <div className="w-9 h-9 shrink-0 rounded-control bg-surface-2 text-muted flex items-center justify-center mt-0.5">
                          <Icon className="w-4 h-4" strokeWidth={1.75} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-text">{describeAudit(e)}</p>
                          <p className={`${SUB} mt-0.5`}>
                            <button type="button" className="underline-offset-2 hover:underline" onClick={() => onOpenProfile?.(e.actorUid)}>{e.actorName}</button>
                            {' · '}{relativeTime(e.at)}{e.source === 'server' ? ' · desk account' : ''}{e.appVersion && e.source === 'app' ? ` · v${e.appVersion}` : ''}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </Card>
              </div>
            ))
          )}
        </>
      )}
    </div>
  );
}
