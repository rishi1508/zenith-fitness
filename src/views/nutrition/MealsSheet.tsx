import { useCallback, useEffect, useState } from 'react';
import { collection, deleteDoc, doc, getDocs, limit, orderBy, query } from 'firebase/firestore';
import { Trash2, Upload, Users } from 'lucide-react';
import { db } from '../../firebase';
import { useAuth } from '../../auth/AuthContext';
import type { MealSlot, SavedMeal } from '../../types';
import { deleteMeal, getMeals, saveMeal } from '../../health/store';
import {
  Button, Card, Chip, EmptyState, IconButton, Sheet, Skeleton, useConfirm, useToast, CAPTION, SUB,
} from '../../ui';
import { MEAL_LABEL } from './nutritionHelpers';
import { publishMeal } from './sharedMeals';

export interface MealsSheetProps {
  /** Slot the chosen meal is added to. */
  meal: MealSlot;
  onClose: () => void;
  /** Fired with the meal the user picked — the caller writes the entries. */
  onPick: (saved: SavedMeal) => void;
}

/**
 * "My usual breakfast" in one tap (docs/HEALTH_SPEC.md §3). Saved meals live
 * on the user's own synced store; the Community tab reads the 20 most recent
 * shared ones, and only when the user asks for it — a deliberate 20 reads
 * rather than a listener (docs/COST_CONTROLS.md).
 */
export function MealsSheet({ meal, onClose, onPick }: MealsSheetProps) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const { confirm } = useConfirm();
  const [tab, setTab] = useState<'mine' | 'community'>('mine');
  const [mine, setMine] = useState<SavedMeal[]>(() => getMeals());
  const [community, setCommunity] = useState<SavedMeal[] | null>(null);
  const [loading, setLoading] = useState(false);

  const loadCommunity = useCallback(async () => {
    setLoading(true);
    try {
      const snap = await getDocs(query(collection(db, 'sharedMeals'), orderBy('createdAt', 'desc'), limit(20)));
      setCommunity(snap.docs.map((d) => d.data() as SavedMeal));
    } catch (err) {
      console.warn('[Nutrition] shared meals load failed', err);
      showToast('Could not load community meals.', 'error');
      setCommunity([]);
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    if (tab === 'community' && community === null && !loading) void loadCommunity();
  }, [tab, community, loading, loadCommunity]);

  const share = async (m: SavedMeal) => {
    try {
      await publishMeal(m);
      const next = { ...m, shared: true };
      saveMeal(next);
      setMine(getMeals());
      showToast(`${m.name} published — everyone can add it now.`);
    } catch {
      showToast('Could not publish that meal.', 'error');
    }
  };

  const remove = async (m: SavedMeal) => {
    if (!(await confirm({ title: 'Delete meal?', message: `"${m.name}" will be removed from your saved meals.`, confirmLabel: 'Delete', tone: 'danger' }))) return;
    deleteMeal(m.id);
    setMine(getMeals());
    if (m.shared && m.createdBy === user?.uid) {
      deleteDoc(doc(db, 'sharedMeals', m.id)).catch(() => { /* already gone */ });
    }
  };

  const list = tab === 'mine' ? mine : community ?? [];

  return (
    <Sheet open onClose={onClose} title={`Add a meal to ${MEAL_LABEL[meal].toLowerCase()}`}>
      <div className="flex gap-2">
        <Chip on={tab === 'mine'} onClick={() => setTab('mine')}>My meals</Chip>
        <Chip on={tab === 'community'} onClick={() => setTab('community')}>
          <span className="inline-flex items-center gap-1"><Users className="w-3 h-3" strokeWidth={2.5} /> Community</span>
        </Chip>
      </div>

      {tab === 'community' && loading && (
        <div className="space-y-2"><Skeleton className="h-14 w-full" /><Skeleton className="h-14 w-full" /></div>
      )}

      {!loading && list.length === 0 && (
        <EmptyState
          icon={Users}
          title={tab === 'mine' ? 'No saved meals yet' : 'Nothing shared yet'}
          body={tab === 'mine'
            ? 'Log a meal the way you like it, then tap "Save as meal" on that section of the diary.'
            : 'Meals other members publish will show up here.'}
        />
      )}

      {!loading && list.length > 0 && (
        <Card padding="list">
          {list.map((m) => (
            <div key={m.id} className="flex items-center gap-2 min-h-14 px-1 border-b border-border last:border-b-0">
              <button onClick={() => onPick(m)} className="flex-1 min-w-0 flex flex-col items-start text-left py-2">
                <span className="text-[15px] leading-[22px] font-semibold text-text truncate w-full">{m.name}</span>
                <span className="text-[13px] leading-[18px] text-muted truncate w-full">
                  {m.items.length} item{m.items.length === 1 ? '' : 's'} · {Math.round(m.kcal)} kcal
                  {tab === 'community' && m.createdByName ? ` · by ${m.createdByName}` : ''}
                  {tab === 'mine' && m.shared ? ' · shared' : ''}
                </span>
              </button>
              {tab === 'mine' && (
                <>
                  {!m.shared && (
                    <IconButton icon={Upload} label={`Publish ${m.name}`} size="sm" onClick={() => { void share(m); }} />
                  )}
                  <IconButton icon={Trash2} label={`Delete ${m.name}`} size="sm" onClick={() => { void remove(m); }} />
                </>
              )}
            </div>
          ))}
        </Card>
      )}

      <p className={CAPTION}>Adding a meal copies its foods — editing them afterwards only changes today.</p>
      <Button variant="secondary" size="lg" full onClick={onClose}>Close</Button>
    </Sheet>
  );
}

/** The "Save as meal" prompt shown from a diary section. */
export function SaveMealSheet({ defaultName, itemCount, kcal, onClose, onSave }: {
  defaultName: string;
  itemCount: number;
  kcal: number;
  onClose: () => void;
  onSave: (name: string, share: boolean) => void;
}) {
  const [name, setName] = useState(defaultName);
  const [share, setShare] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <Sheet open onClose={onClose} title="Save as meal">
      <p className={SUB}>
        {itemCount} item{itemCount === 1 ? '' : 's'} · {Math.round(kcal)} kcal. Add the whole set again in one tap.
      </p>
      <label className="flex flex-col gap-1">
        <span className={CAPTION}>Name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. My usual breakfast"
          aria-label="Meal name"
          autoFocus
          className="h-11 px-3 rounded-control border border-border bg-surface-2 text-text placeholder:text-subtle text-sm outline-none focus:border-accent/50"
        />
      </label>
      <label className="flex items-start gap-2.5 cursor-pointer">
        <input
          type="checkbox"
          checked={share}
          onChange={(e) => setShare(e.target.checked)}
          className="mt-0.5 w-4 h-4 accent-[var(--color-accent,#f97316)]"
        />
        <span className="min-w-0">
          <span className="text-sm font-semibold text-text">Share with everyone</span>
          <span className={`${SUB} block`}>Other members can add this meal too. You can delete it later.</span>
        </span>
      </label>
      <Button
        variant="primary" size="lg" full disabled={!name.trim() || busy} loading={busy}
        onClick={() => { if (name.trim() && !busy) { setBusy(true); onSave(name.trim(), share); } }}
      >
        Save meal
      </Button>
    </Sheet>
  );
}
