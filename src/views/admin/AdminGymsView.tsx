import { useEffect, useState } from 'react';
import { ArrowLeft, Building2, ChevronRight, Plus } from 'lucide-react';
import { collection, getDocs, limit as fsLimit, query, where } from 'firebase/firestore';
import { db } from '../../firebase';
import type { Gym } from '../../types';
import { createGymForOwner, listAllGyms, updateGym } from '../../gymService';
import {
  Button, Card, EmptyState, IconButton, ListRow, Pill, SegmentedControl, Sheet, Skeleton, useToast, CAPTION, H1,
} from '../../ui';
import type { PillTone } from '../../ui';

const INPUT_CLS = 'w-full rounded-control px-3 h-11 text-sm bg-surface-2 border border-border text-text placeholder-subtle focus:outline-none focus:border-accent';

const STATUS_TONE: Record<Gym['subscriptionStatus'], PillTone> = { pilot: 'info', active: 'ok', lapsed: 'danger' };

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function CreateGymSheet({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const { showToast } = useToast();

  const handleCreate = async () => {
    if (!name.trim() || !ownerEmail.trim() || saving) return;
    setSaving(true);
    try {
      const normalizedEmail = ownerEmail.trim().toLowerCase();
      const snap = await getDocs(query(collection(db, 'userProfiles'), where('email', '==', normalizedEmail), fsLimit(1)));
      if (snap.empty) {
        showToast('No account found with that email — the owner needs to sign up first.', 'error');
        return;
      }
      const ownerUid = snap.docs[0].id;
      await createGymForOwner(
        { name: name.trim(), address: address.trim() || undefined, phone: phone.trim() || undefined },
        ownerUid,
      );
      showToast('Gym created.');
      setName(''); setAddress(''); setPhone(''); setOwnerEmail('');
      onCreated();
      onClose();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not create the gym.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="New gym">
      <div className="flex flex-col gap-3 pb-1">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Gym name" className={INPUT_CLS} autoFocus />
        <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Address (optional)" className={INPUT_CLS} />
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone (optional)" className={INPUT_CLS} type="tel" />
        <input value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} placeholder="Owner's email" className={INPUT_CLS} type="email" />
        <Button variant="primary" size="lg" full loading={saving} disabled={!name.trim() || !ownerEmail.trim()} onClick={handleCreate}>
          Create gym
        </Button>
      </div>
    </Sheet>
  );
}

function EditGymSheet({ gym, onClose, onSaved }: { gym: Gym | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [status, setStatus] = useState<Gym['subscriptionStatus']>('pilot');
  const [pilotEndsAt, setPilotEndsAt] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const { showToast } = useToast();

  useEffect(() => {
    if (!gym) return;
    setName(gym.name);
    setAddress(gym.address ?? '');
    setPhone(gym.phone ?? '');
    setStatus(gym.subscriptionStatus);
    setPilotEndsAt(gym.pilotEndsAt?.slice(0, 10) ?? '');
    setNotes(gym.notes ?? '');
  }, [gym]);

  const handleSave = async () => {
    if (!gym || !name.trim() || saving) return;
    setSaving(true);
    try {
      await updateGym(gym.id, {
        name: name.trim(),
        address: address.trim() || undefined,
        phone: phone.trim() || undefined,
        subscriptionStatus: status,
        pilotEndsAt: pilotEndsAt || undefined,
        notes: notes.trim() || undefined,
      });
      showToast('Gym updated.');
      onSaved();
      onClose();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not update the gym.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={!!gym} onClose={onClose} title={gym?.name ?? 'Gym'}>
      <div className="flex flex-col gap-3 pb-1">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Gym name" className={INPUT_CLS} />
        <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Address" className={INPUT_CLS} />
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" className={INPUT_CLS} type="tel" />
        <div className="flex flex-col gap-1">
          <span className={CAPTION}>Status</span>
          <SegmentedControl
            label="Status"
            value={status}
            onChange={setStatus}
            options={[
              { value: 'pilot', label: 'Pilot' },
              { value: 'active', label: 'Active' },
              { value: 'lapsed', label: 'Lapsed' },
            ]}
          />
        </div>
        <label className="flex flex-col gap-1">
          <span className={CAPTION}>Pilot ends</span>
          <input value={pilotEndsAt} onChange={(e) => setPilotEndsAt(e.target.value)} type="date" className={INPUT_CLS} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={CAPTION}>Notes</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Internal notes — not shown to gym members"
            rows={3}
            className={`${INPUT_CLS} h-auto py-2`}
          />
        </label>
        <Button variant="primary" size="lg" full loading={saving} disabled={!name.trim()} onClick={handleSave}>Save</Button>
      </div>
    </Sheet>
  );
}

/** Admin console (docs/REVAMP_SPEC.md §5): every gym, with create + edit. */
export function AdminGymsView({ onBack }: { onBack: () => void }) {
  const [gyms, setGyms] = useState<Gym[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<Gym | null>(null);
  const { showToast } = useToast();

  const load = () => {
    setLoading(true);
    listAllGyms()
      .then(setGyms)
      .catch((err) => showToast(err instanceof Error ? err.message : 'Could not load gyms.', 'error'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { (async () => { load(); })(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const term = search.trim().toLowerCase();
  const filtered = gyms
    .filter((g) => !term || g.name.toLowerCase().includes(term))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="space-y-4 animate-fadeIn">
      <div className="flex items-center gap-2">
        <IconButton icon={ArrowLeft} label="Back" onClick={onBack} />
        <h1 className={`${H1} flex-1`}>Gyms</h1>
        <IconButton icon={Plus} label="New gym" onClick={() => setShowCreate(true)} />
      </div>

      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search gyms" className={INPUT_CLS} />

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No gyms yet"
          body="Create the first gym to get a pilot going."
          action={{ label: 'New gym', onClick: () => setShowCreate(true) }}
        />
      ) : (
        <Card padding="list">
          {filtered.map((g) => (
            <ListRow
              key={g.id}
              icon={Building2}
              title={g.name}
              subtitle={`${g.memberCount} members · joined ${formatDate(g.createdAt)}`}
              trailing={(
                <>
                  <Pill tone={STATUS_TONE[g.subscriptionStatus]}>{g.subscriptionStatus}</Pill>
                  <ChevronRight className="w-[18px] h-[18px] text-subtle shrink-0" strokeWidth={1.75} />
                </>
              )}
              onClick={() => setEditing(g)}
            />
          ))}
        </Card>
      )}

      <CreateGymSheet open={showCreate} onClose={() => setShowCreate(false)} onCreated={load} />
      <EditGymSheet gym={editing} onClose={() => setEditing(null)} onSaved={load} />
    </div>
  );
}
