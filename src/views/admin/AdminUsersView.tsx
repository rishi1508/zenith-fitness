import { useEffect, useState } from 'react';
import { ArrowLeft, ChevronRight, UserCog } from 'lucide-react';
import type { AdminUserRow } from '../../adminService';
import { deleteUser, listUsers, setPremiumGrant, setUserDisabled } from '../../adminService';
import { isAdmin } from '../../admin';
import { Button, Card, EmptyState, IconButton, ListRow, Pill, Sheet, Skeleton, useToast, H1 } from '../../ui';
import type { PillTone } from '../../ui';

const INPUT_CLS = 'w-full rounded-control px-3 h-11 text-sm bg-surface-2 border border-border text-text placeholder-subtle focus:outline-none focus:border-accent';

function tierLabel(row: AdminUserRow): { label: string; tone: PillTone } {
  if (isAdmin(row.uid)) return { label: 'Admin', tone: 'info' };
  if (row.subscriptionTier === 'premium') return { label: 'Premium', tone: 'accent' };
  if (row.gym) return { label: 'Gym', tone: 'accent' };
  return { label: 'Free', tone: 'neutral' };
}

function UserDetailSheet({ row, onClose, onChanged }: { row: AdminUserRow | null; onClose: () => void; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const { showToast } = useToast();

  const handleToggleDisabled = async () => {
    if (!row || busy) return;
    setBusy(true);
    try {
      await setUserDisabled(row.uid, !row.disabled);
      showToast(row.disabled ? 'Account enabled.' : 'Account disabled.');
      onChanged();
      onClose();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not update the account.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleTogglePremium = async () => {
    if (!row || busy) return;
    setBusy(true);
    try {
      const grant = row.subscriptionTier !== 'premium';
      await setPremiumGrant(row.uid, grant);
      showToast(grant ? 'Premium granted.' : 'Premium revoked.');
      onChanged();
      onClose();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not update premium.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!row || busy) return;
    if (!confirm(`Delete ${row.displayName || row.email || row.uid}? This permanently removes their account and data.`)) return;
    setBusy(true);
    try {
      await deleteUser(row.uid);
      showToast('Account deleted.');
      onChanged();
      onClose();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not delete the account.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={!!row} onClose={onClose} title={row?.displayName || row?.email || 'User'}>
      <div className="flex flex-col gap-3 pb-1">
        <p className="text-sm text-muted">{row?.email ?? 'No email'}</p>
        <p className="text-xs text-subtle">
          {row?.providers.join(', ') || 'unknown provider'}
          {' · joined '}
          {row?.createdAt ? new Date(row.createdAt).toLocaleDateString('en-IN') : '—'}
          {row?.lastSignInAt ? ` · last in ${new Date(row.lastSignInAt).toLocaleDateString('en-IN')}` : ''}
        </p>
        <Button variant="secondary" size="md" full loading={busy} onClick={handleToggleDisabled}>
          {row?.disabled ? 'Enable account' : 'Disable account'}
        </Button>
        <Button variant="secondary" size="md" full loading={busy} onClick={handleTogglePremium}>
          {row?.subscriptionTier === 'premium' ? 'Revoke premium' : 'Grant premium'}
        </Button>
        <Button variant="danger" size="md" full loading={busy} onClick={handleDelete}>
          Delete account
        </Button>
      </div>
    </Sheet>
  );
}

/** Admin console (docs/REVAMP_SPEC.md §5): server-backed user list with
 *  disable/enable, delete and premium-grant actions (api/admin.ts). */
export function AdminUsersView({ onBack }: { onBack: () => void }) {
  const [rows, setRows] = useState<AdminUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<AdminUserRow | null>(null);
  const { showToast } = useToast();

  const load = () => {
    setLoading(true);
    listUsers()
      .then(setRows)
      .catch((err) => showToast(err instanceof Error ? err.message : 'Could not load users.', 'error'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { (async () => { load(); })(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const term = search.trim().toLowerCase();
  const filtered = rows.filter((r) => !term || (r.displayName ?? '').toLowerCase().includes(term) || (r.email ?? '').toLowerCase().includes(term));
  // Keep the sheet's data fresh after an action mutates `rows` via `load()`.
  const selectedFresh = selected ? filtered.find((r) => r.uid === selected.uid) ?? selected : null;

  return (
    <div className="space-y-4 animate-fadeIn">
      <div className="flex items-center gap-2">
        <IconButton icon={ArrowLeft} label="Back" onClick={onBack} />
        <h1 className={`${H1} flex-1`}>Users</h1>
      </div>

      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or email" className={INPUT_CLS} />

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={UserCog} title="No users found" />
      ) : (
        <Card padding="list">
          {filtered.map((row) => {
            const { label, tone } = tierLabel(row);
            return (
              <ListRow
                key={row.uid}
                icon={UserCog}
                title={row.displayName || row.email || row.uid}
                subtitle={row.email ?? row.uid}
                trailing={(
                  <>
                    {row.disabled && <Pill tone="danger">Disabled</Pill>}
                    <Pill tone={tone}>{label}</Pill>
                    <ChevronRight className="w-[18px] h-[18px] text-subtle shrink-0" strokeWidth={1.75} />
                  </>
                )}
                onClick={() => setSelected(row)}
              />
            );
          })}
        </Card>
      )}

      <UserDetailSheet row={selectedFresh} onClose={() => setSelected(null)} onChanged={load} />
    </div>
  );
}
