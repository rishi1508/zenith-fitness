import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Camera, Pencil, Plus, ScanBarcode, Search, Star, Trash2, UtensilsCrossed, Zap } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import type { FoodEntry, FoodItem, FoodSource, Macros, MealSlot, SavedMeal } from '../../types';
import {
  deleteCustomFood, getCustomFoods, getFavouriteFoodIds, getMeals, getNutritionDay, getRecentFoods,
  replaceCachedFood, saveCustomFood, saveNutritionDay, subscribeHealth, toggleFavouriteFood,
} from '../../health/store';
import { hapticImpact } from '../../haptics';
import {
  getFood, getSharedFoods, loadFoodIndex, loadSharedFoods, lookupBarcode, OFF_ATTRIBUTION, searchAllFoods,
} from '../../nutrition';
import {
  Button, Card, EmptyState, IconButton, SegmentedControl, Sheet, Skeleton, useConfirm, useToast,
  CAPTION, H2, SUB,
} from '../../ui';
import { BarcodeScanView } from './BarcodeScanView';
import { FoodEntrySheet } from './FoodEntrySheet';
import { MEAL_LABEL, basisLabel, canEditFood, deleteSharedFood, publishSharedFood, upsertEntry } from './nutritionHelpers';
import { MealsSheet } from './MealsSheet';
import { FoodSheet } from './foodEditing';

export interface FoodSearchViewProps {
  /** Diary day the entry lands on (YYYY-MM-DD). */
  date: string;
  /** Meal preselected in the entry sheet. */
  meal: MealSlot;
  onBack: () => void;
  /** Fired once an entry is in the diary — the caller shows the day itself
   *  rather than leaving the user on the add screen. */
  onAdded?: (entry: FoodEntry) => void;
  /** Opens the premium plate scan (docs/HEALTH_SPEC.md §6) for the same day/meal. */
  onOpenScan?: () => void;
}

type Segment = 'recents' | 'favourites' | 'all';

/** Both a `FoodIndexEntry` and a full `FoodItem` satisfy this, so the view
 *  survives either return shape from N1's `searchFoods`. */
interface SearchRow {
  id: string;
  name: string;
  source: FoodSource;
  basis?: 'g' | 'ml';
  group?: string;
  brand?: string;
  approx?: boolean;
  kcal100?: number;
  per100g?: Macros;
}

const SEGMENTS: { value: Segment; label: string }[] = [
  { value: 'recents', label: 'Recents' },
  { value: 'favourites', label: 'Favourites' },
  { value: 'all', label: 'All' },
];

function rowKcal(row: SearchRow): number | null {
  return row.kcal100 ?? row.per100g?.kcal ?? null;
}

function matches(row: SearchRow & { aliases?: string[] }, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return [row.name, row.brand, ...(row.aliases ?? [])]
    .some((s) => !!s && s.toLowerCase().includes(needle));
}

/** Custom foods live only in the user's own store, so they are matched here
 *  rather than by `searchFoods` (which covers the static shards). */
async function resolveFood(id: string): Promise<FoodItem | null> {
  const local = getCustomFoods().find((f) => f.id === id)
    ?? getRecentFoods().find((f) => f.id === id)
    ?? getSharedFoods().find((f) => f.id === id);
  if (local) return local;
  return await Promise.resolve(getFood(id));
}

/**
 * Food picker for one meal (docs/HEALTH_SPEC.md §3): debounced client-side
 * search over the static food index, Recents / Favourites / All segments, a
 * barcode scanner, "Create food" (also published to `sharedFoods`) and a
 * macros-only "Quick add".
 */
export function FoodSearchView({ date, meal, onBack, onAdded, onOpenScan }: FoodSearchViewProps) {
  const { user } = useAuth();
  const { showToast } = useToast();

  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [segment, setSegment] = useState<Segment>('recents');
  const [rows, setRows] = useState<SearchRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [tick, setTick] = useState(0);

  const [scanning, setScanning] = useState(false);
  const [selected, setSelected] = useState<FoodItem | null>(null);
  const [sheetNote, setSheetNote] = useState<string | undefined>(undefined);
  const [createOpen, setCreateOpen] = useState(false);
  /** `thenLog` opens the entry sheet after the save — true when the edit was
   *  started on the way to logging the food, false for a long-press edit. */
  const [editing, setEditing] = useState<{ food: FoodItem; thenLog: boolean } | null>(null);
  const [quickOpen, setQuickOpen] = useState(false);
  const [mealsOpen, setMealsOpen] = useState(false);
  const [rowActions, setRowActions] = useState<FoodItem | null>(null);
  /** Foods deleted in this session. The community library is cached for hours,
   *  so without this a food you just deleted would still be listed. */
  const [deleted, setDeleted] = useState<string[]>([]);

  useEffect(() => subscribeHealth(() => setTick((t) => t + 1)), []);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 150);
    return () => clearTimeout(t);
  }, [query]);
  // Typing is a search of everything; the segment the user picked is left
  // alone as soon as the box is empty again.
  useEffect(() => { if (query.trim()) setSegment('all'); }, [query]);

  // `tick` is the health-store change signal — re-read everything on it.
  const stored = useMemo(() => ({
    favouriteIds: getFavouriteFoodIds(), recents: getRecentFoods(), meals: getMeals(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [tick]);
  const { favouriteIds, recents, meals } = stored;

  /** A saved meal is the fastest thing to log, so it sits above the foods and
   *  answers the same search box. */
  const matchingMeals = useMemo(() => {
    const q = debounced.trim().toLowerCase();
    const rowsForQuery = q
      ? meals.filter((m) => m.name.toLowerCase().includes(q) || m.items.some((i) => i.name.toLowerCase().includes(q)))
      : meals;
    return rowsForQuery.slice(0, 4);
  }, [meals, debounced]);

  /** Everything in a saved meal, into today's diary in one go. */
  const logMeal = useCallback((saved: SavedMeal) => {
    const now = new Date().toISOString();
    const day = getNutritionDay(date);
    const added: FoodEntry[] = saved.items.map((item) => ({ ...item, id: crypto.randomUUID(), at: now, meal }));
    saveNutritionDay({ ...day, entries: [...day.entries, ...added] });
    showToast(`Added ${saved.name} (${added.length} item${added.length === 1 ? '' : 's'}).`);
    if (onAdded) onAdded(added[0]); else onBack();
  }, [date, meal, onAdded, onBack, showToast]);
  const favouriteKey = favouriteIds.join(',');

  const [favourites, setFavourites] = useState<FoodItem[]>([]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const items = await Promise.all(favouriteIds.map((id) => resolveFood(id)));
      if (!cancelled) setFavourites(items.filter((f): f is FoodItem => f !== null));
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [favouriteKey]);

  // "All" is the only segment that touches the food index; Recents and
  // Favourites are filtered locally so typing there costs nothing.
  useEffect(() => {
    if (segment !== 'all') return;
    let cancelled = false;
    setSearching(true);
    void (async () => {
      // The community library is read back here (once every few hours) so a
      // food someone created is findable by everyone, on any device.
      await Promise.all([loadFoodIndex(), loadSharedFoods()]);
      if (cancelled) return;
      const boost = { favouriteIds, recentIds: recents.map((r) => r.id) };
      setRows(searchAllFoods(debounced, { limit: 40, boost, uid: user?.uid }));
      setSearching(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segment, debounced, favouriteKey, tick, user?.uid]);

  const listed: SearchRow[] = useMemo(() => {
    const all = segment === 'recents' ? recents.filter((f) => matches(f, debounced))
      : segment === 'favourites' ? favourites.filter((f) => matches(f, debounced))
        : rows;
    return deleted.length ? all.filter((f) => !deleted.includes(f.id)) : all;
  }, [segment, recents, favourites, rows, debounced, deleted]);

  const pick = useCallback(async (id: string) => {
    const food = await resolveFood(id);
    if (!food) { showToast('Could not load that food.', 'error'); return; }
    setSheetNote(undefined);
    setSelected(food);
  }, [showToast]);

  /** Press and hold a row: the edit/delete sheet, but only for a food this
   *  member is allowed to correct. Anything else stays a plain tap-to-log. */
  const { confirm: confirmDialog } = useConfirm();
  const openRowActions = useCallback(async (id: string) => {
    const food = await resolveFood(id);
    if (!food || !canEditFood(food, user?.uid)) return;
    void hapticImpact('light');
    setRowActions(food);
  }, [user?.uid]);

  const deleteFood = useCallback(async (food: FoodItem) => {
    const ok = await confirmDialog({
      title: 'Delete food?',
      message: `${food.name} is removed from your foods and from the shared library. Entries already logged keep their figures.`,
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    deleteCustomFood(food.id);
    setDeleted((ids) => [...ids, food.id]);
    setRowActions(null);
    const shared = await deleteSharedFood(food.id);
    showToast(shared ? `Deleted ${food.name}.` : `Deleted ${food.name} on this device only.`);
  }, [confirmDialog, showToast]);

  const onBarcode = useCallback(async (code: string) => {
    const food = await lookupBarcode(code);
    if (!food) {
      showToast('Barcode not found — create the food instead.', 'error');
      return;
    }
    setSheetNote(OFF_ATTRIBUTION);
    setSelected(food);
  }, [showToast]);

  const afterAdd = (entry: FoodEntry) => {
    showToast(`Added ${entry.name} to ${MEAL_LABEL[entry.meal].toLowerCase()}.`);
    if (onAdded) onAdded(entry); else onBack();
  };

  if (scanning) {
    return (
      <>
        <BarcodeScanView
          onResult={(code) => { void onBarcode(code); }}
          onEnterCode={(code) => { void onBarcode(code); }}
          onBack={() => setScanning(false)}
          active={!selected}
        />
        <FoodEntrySheet
          open={!!selected} onClose={() => setSelected(null)}
          food={selected} date={date} meal={meal} note={sheetNote} onSaved={afterAdd}
          onEditFood={canEditFood(selected, user?.uid) ? (f) => { setSelected(null); setEditing({ food: f, thenLog: true }); } : undefined}
        />
      </>
    );
  }

  return (
    <div className="space-y-4 animate-fadeIn">
      <div className="flex items-center gap-3">
        <IconButton icon={ArrowLeft} label="Back" onClick={onBack} />
        <div className="min-w-0 flex-1">
          <h1 className={`${H2} truncate`}>Add food</h1>
          <p className={SUB}>{MEAL_LABEL[meal]}</p>
        </div>
      </div>

      {/* Photographing the plate is the fast path, so it sits above the search
          box; typing a food out by hand is the fallback. */}
      <Card>
        <span className={CAPTION}>Capture</span>
        <div className="mt-2 space-y-2">
          {onOpenScan && (
            <Button variant="primary" size="md" icon={Camera} full onClick={onOpenScan}>
              Scan your plate
            </Button>
          )}
          <Button variant="secondary" size="md" icon={ScanBarcode} full onClick={() => setScanning(true)}>
            Scan barcode
          </Button>
        </div>
      </Card>

      <div className="relative">
        <Search className="w-4 h-4 text-subtle absolute left-3 top-1/2 -translate-y-1/2" strokeWidth={1.75} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search dal, roti, paneer…"
          className="w-full h-11 pl-9 pr-3 rounded-control border border-border bg-surface-2 text-text placeholder:text-subtle text-sm outline-none focus:border-accent/50"
        />
      </div>

      {/* Saved meals first — logging "my usual breakfast" should never mean
          re-adding four foods. */}
      {matchingMeals.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className={CAPTION}>Your meals</span>
            <button onClick={() => setMealsOpen(true)} className="text-[13px] font-bold text-accent">See all</button>
          </div>
          <Card padding="list">
            {matchingMeals.map((m) => (
              <button
                key={m.id}
                onClick={() => logMeal(m)}
                className="w-full min-h-14 px-1 flex items-center gap-3 text-left"
              >
                <span className="w-9 h-9 rounded-control bg-accent-soft text-accent flex items-center justify-center shrink-0">
                  <UtensilsCrossed className="w-[18px] h-[18px]" strokeWidth={1.75} />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[15px] leading-[22px] font-semibold text-text truncate">{m.name}</span>
                  <span className={`${SUB} block truncate`}>
                    Saved meal · {m.items.length} item{m.items.length === 1 ? '' : 's'} · {Math.round(m.kcal)} kcal
                  </span>
                </span>
                <Plus className="w-[18px] h-[18px] text-subtle shrink-0" strokeWidth={1.75} />
              </button>
            ))}
          </Card>
        </div>
      )}

      <SegmentedControl options={SEGMENTS} value={segment} onChange={setSegment} label="Food list" />

      {segment === 'all' && searching && listed.length === 0 ? (
        <div className="space-y-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : listed.length === 0 ? (
        <EmptyState
          icon={Search}
          title={segment === 'favourites' ? 'No favourites yet' : segment === 'recents' ? 'Nothing logged yet' : 'No matches'}
          body={
            segment === 'favourites'
              ? 'Star a food while adding it and it will wait for you here.'
              : segment === 'recents'
                ? 'Foods you log show up here so the next time is one tap.'
                : 'Try a shorter word, scan the barcode, or create the food yourself.'
          }
        />
      ) : (
        <Card padding="list">
          {listed.map((row) => (
            <ResultRow
              key={row.id}
              row={row}
              favourite={favouriteIds.includes(row.id)}
              onPick={() => { void pick(row.id); }}
              onLongPress={() => { void openRowActions(row.id); }}
              onToggleFavourite={() => toggleFavouriteFood(row.id)}
            />
          ))}
        </Card>
      )}

      <div className="grid grid-cols-3 gap-2">
        <Button variant="secondary" size="md" icon={UtensilsCrossed} full onClick={() => setMealsOpen(true)}>
          Meals
        </Button>
        <Button variant="secondary" size="md" icon={Plus} full onClick={() => setCreateOpen(true)}>
          Create
        </Button>
        <Button variant="secondary" size="md" icon={Zap} full onClick={() => setQuickOpen(true)}>
          Quick add
        </Button>
      </div>

      {mealsOpen && (
        <MealsSheet
          meal={meal}
          onClose={() => setMealsOpen(false)}
          onPick={(saved) => { setMealsOpen(false); logMeal(saved); }}
        />
      )}

      <FoodEntrySheet
        open={!!selected} onClose={() => setSelected(null)}
        food={selected} date={date} meal={meal} note={sheetNote} onSaved={afterAdd}
      />

      {createOpen && <FoodSheet
        title="Create food"
        submitLabel="Create and log"
        createdBy={user?.uid}
        onClose={() => setCreateOpen(false)}
        onSubmit={(values) => {
          const item: FoodItem = {
            id: `user:${crypto.randomUUID()}`,
            source: 'user',
            name: values.name,
            brand: values.brand,
            basis: values.basis,
            per100g: values.per100g,
            units: values.units,
            createdBy: user!.uid,
            createdByName: user?.displayName ?? undefined,
            createdAt: new Date().toISOString(),
          };
          saveCustomFood(item);
          publishSharedFood(item);
          setCreateOpen(false);
          setSheetNote(undefined);
          showToast(`Created ${item.name}.`);
          setSelected(item);
        }}
      />}

      {rowActions && (
        <Sheet open onClose={() => setRowActions(null)} title={rowActions.name}>
          <Button
            variant="secondary" size="lg" icon={Pencil} full
            onClick={() => { const food = rowActions; setRowActions(null); setEditing({ food, thenLog: false }); }}
          >
            Edit
          </Button>
          <Button variant="danger" size="lg" icon={Trash2} full onClick={() => { void deleteFood(rowActions); }}>
            Delete
          </Button>
        </Sheet>
      )}

      {editing && <FoodSheet
        title="Edit food"
        submitLabel="Save changes"
        initial={editing.food}
        createdBy={user?.uid}
        onClose={() => setEditing(null)}
        onSubmit={(values) => {
          const updated: FoodItem = {
            ...editing.food,
            name: values.name,
            brand: values.brand,
            basis: values.basis,
            per100g: values.per100g,
            units: values.units,
          };
          replaceCachedFood(updated);
          publishSharedFood(updated);
          showToast(`Updated ${updated.name}.`);
          if (editing.thenLog) setSelected(updated);
          setEditing(null);
        }}
      />}

      {quickOpen && <QuickAddSheet
        onClose={() => setQuickOpen(false)}
        meal={meal}
        onAdd={(entry) => {
          saveNutritionDay(upsertEntry(getNutritionDay(date), entry));
          setQuickOpen(false);
          afterAdd(entry);
        }}
      />}
    </div>
  );
}

/** Long enough not to fire while scrolling, short enough to feel deliberate. */
const LONG_PRESS_MS = 400;
/** A press that travels further than this is a scroll, not a hold. */
const LONG_PRESS_SLOP_PX = 8;

function ResultRow({ row, favourite, onPick, onLongPress, onToggleFavourite }: {
  row: SearchRow; favourite: boolean; onPick: () => void; onLongPress: () => void; onToggleFavourite: () => void;
}) {
  const kcal = rowKcal(row);
  const timer = useRef<number | null>(null);
  const fired = useRef(false);
  const origin = useRef<{ x: number; y: number } | null>(null);

  const clear = () => {
    if (timer.current !== null) { clearTimeout(timer.current); timer.current = null; }
  };
  const start = (e: React.PointerEvent) => {
    fired.current = false;
    origin.current = { x: e.clientX, y: e.clientY };
    clear();
    timer.current = window.setTimeout(() => { fired.current = true; onLongPress(); }, LONG_PRESS_MS);
  };
  const move = (e: React.PointerEvent) => {
    if (timer.current === null || !origin.current) return;
    if (Math.hypot(e.clientX - origin.current.x, e.clientY - origin.current.y) > LONG_PRESS_SLOP_PX) clear();
  };

  // Brand and the per-100 figure are all a row needs; where the numbers came
  // from is noise in a list you are scanning.
  const subtitle = [row.brand, kcal != null ? `${Math.round(kcal)} kcal/100 ${basisLabel(row)}` : null]
    .filter(Boolean).join(' · ');

  return (
    <div className="flex items-center gap-2 min-h-14 px-1 border-b border-border last:border-b-0">
      <button
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={clear}
        onPointerLeave={clear}
        onPointerCancel={clear}
        onContextMenu={(e) => e.preventDefault()}
        onClick={() => { if (!fired.current) onPick(); }}
        className="flex-1 min-w-0 flex flex-col items-start text-left py-2"
      >
        <span className="text-[15px] leading-[22px] font-semibold text-text truncate w-full">{row.name}</span>
        <span className="text-[13px] leading-[18px] text-muted truncate w-full">{subtitle}</span>
      </button>
      <button
        onClick={onToggleFavourite}
        aria-pressed={favourite}
        aria-label={favourite ? `Unfavourite ${row.name}` : `Favourite ${row.name}`}
        className={`shrink-0 w-9 h-9 flex items-center justify-center rounded-control ${favourite ? 'text-accent' : 'text-subtle'}`}
      >
        <Star className="w-[18px] h-[18px]" strokeWidth={1.75} fill={favourite ? 'currentColor' : 'none'} />
      </button>
    </div>
  );
}

function NumField({ label, value, onChange, suffix }: {
  label: string; value: string; onChange: (v: string) => void; suffix?: string;
}) {
  return (
    <label className="flex flex-col gap-1 min-w-0">
      <span className={CAPTION}>{label}{suffix ? ` (${suffix})` : ''}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode="decimal"
        className="h-11 px-3 rounded-control border border-border bg-surface-2 text-text placeholder:text-subtle text-sm outline-none focus:border-accent/50"
      />
    </label>
  );
}

/** Create/edit wrapper around the shared `FoodForm`. Mounted only while open,
 *  so the fields seed once from `initial` and no reset effect is needed.
 *  `busy` blocks the double-taps that used to create the same food twice. */
/** Mounted only while open — see `FoodSheet`. */
function QuickAddSheet({ onClose, meal, onAdd }: {
  onClose: () => void; meal: MealSlot; onAdd: (entry: FoodEntry) => void;
}) {
  const [name, setName] = useState('');
  const [kcal, setKcal] = useState('');
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fat, setFat] = useState('');

  const num = (v: string) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : 0; };
  const valid = Number(kcal) > 0;

  const submit = () => {
    if (!valid) return;
    // 1 "serving" of a nominal 100 g keeps the entry rescalable in the edit
    // sheet even though no food backs it.
    onAdd({
      id: crypto.randomUUID(),
      foodId: `quick:${crypto.randomUUID()}`,
      name: name.trim() || 'Quick add',
      source: 'user',
      meal,
      qty: 1,
      unit: 'serving',
      grams: 100,
      macros: { kcal: num(kcal), protein: num(protein), carbs: num(carbs), fat: num(fat) },
      at: new Date().toISOString(),
      approx: true,
    });
  };

  return (
    <Sheet open onClose={onClose} title="Quick add">
      <p className={SUB}>Calories now, details never. Lands in {MEAL_LABEL[meal].toLowerCase()}.</p>
      <label className="flex flex-col gap-1">
        <span className={CAPTION}>Label (optional)</span>
        <input
          value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Office lunch"
          className="h-11 px-3 rounded-control border border-border bg-surface-2 text-text placeholder:text-subtle text-sm outline-none focus:border-accent/50"
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <NumField label="Calories" suffix="kcal" value={kcal} onChange={setKcal} />
        <NumField label="Protein" suffix="g" value={protein} onChange={setProtein} />
        <NumField label="Carbs" suffix="g" value={carbs} onChange={setCarbs} />
        <NumField label="Fat" suffix="g" value={fat} onChange={setFat} />
      </div>
      <Button variant="primary" size="lg" full disabled={!valid} onClick={submit}>Add</Button>
    </Sheet>
  );
}
