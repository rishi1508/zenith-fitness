import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Camera, Plus, ScanBarcode, Search, Star, Zap } from 'lucide-react';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../auth/AuthContext';
import type { FoodEntry, FoodItem, FoodSource, Macros, MealSlot } from '../../types';
import {
  getCustomFoods, getFavouriteFoodIds, getNutritionDay, getRecentFoods,
  saveCustomFood, saveNutritionDay, subscribeHealth, toggleFavouriteFood,
} from '../../health/store';
import { getFood, loadFoodIndex, lookupBarcode, OFF_ATTRIBUTION, searchFoods } from '../../nutrition';
import {
  Button, Card, EmptyState, IconButton, SegmentedControl, Sheet, Skeleton, useToast,
  CAPTION, H2, SUB,
} from '../../ui';
import { BarcodeScanView } from './BarcodeScanView';
import { FoodEntrySheet } from './FoodEntrySheet';
import { MEAL_LABEL, parseUnits, sourceLabel, upsertEntry } from './nutritionHelpers';

export interface FoodSearchViewProps {
  /** Diary day the entry lands on (YYYY-MM-DD). */
  date: string;
  /** Meal preselected in the entry sheet. */
  meal: MealSlot;
  onBack: () => void;
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
  const local = getCustomFoods().find((f) => f.id === id) ?? getRecentFoods().find((f) => f.id === id);
  if (local) return local;
  return await Promise.resolve(getFood(id));
}

/** Publishes a member-created food to `sharedFoods/{id}` — a create only, no
 *  listener (docs/COST_CONTROLS.md). Failures are non-fatal: the food is
 *  already saved locally. */
function publishSharedFood(item: FoodItem): void {
  const payload: Record<string, unknown> = {
    id: item.id, name: item.name, source: 'user',
    per100g: item.per100g, units: item.units,
    createdBy: item.createdBy, createdByName: item.createdByName ?? null, createdAt: item.createdAt,
  };
  if (item.brand) payload.brand = item.brand;
  setDoc(doc(db, 'sharedFoods', item.id), payload)
    .catch((e) => console.warn('[Nutrition] sharedFoods publish failed', e));
}

/**
 * Food picker for one meal (docs/HEALTH_SPEC.md §3): debounced client-side
 * search over the static food index, Recents / Favourites / All segments, a
 * barcode scanner, "Create food" (also published to `sharedFoods`) and a
 * macros-only "Quick add".
 */
export function FoodSearchView({ date, meal, onBack, onOpenScan }: FoodSearchViewProps) {
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
  const [quickOpen, setQuickOpen] = useState(false);

  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => subscribeHealth(() => setTick((t) => t + 1)), []);
  useEffect(() => { searchRef.current?.focus(); }, []);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 150);
    return () => clearTimeout(t);
  }, [query]);

  // `tick` is the health-store change signal — re-read everything on it.
  const stored = useMemo(() => ({
    favouriteIds: getFavouriteFoodIds(), recents: getRecentFoods(), customFoods: getCustomFoods(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [tick]);
  const { favouriteIds, recents, customFoods } = stored;
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
      await loadFoodIndex();
      const boost = [...favouriteIds, ...recents.map((r) => r.id)];
      const found = await Promise.resolve(searchFoods(debounced, { limit: 40, boost }));
      if (cancelled) return;
      const custom = customFoods.filter((f) => matches(f, debounced));
      const seen = new Set(custom.map((f) => f.id));
      setRows([...custom, ...found.filter((f) => !seen.has(f.id))]);
      setSearching(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segment, debounced, favouriteKey, tick]);

  const listed: SearchRow[] = useMemo(() => {
    if (segment === 'recents') return recents.filter((f) => matches(f, debounced));
    if (segment === 'favourites') return favourites.filter((f) => matches(f, debounced));
    return rows;
  }, [segment, recents, favourites, rows, debounced]);

  const pick = useCallback(async (id: string) => {
    const food = await resolveFood(id);
    if (!food) { showToast('Could not load that food.', 'error'); return; }
    setSheetNote(undefined);
    setSelected(food);
  }, [showToast]);

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
    onBack();
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
        <IconButton icon={ScanBarcode} label="Scan barcode" onClick={() => setScanning(true)} />
        {onOpenScan && <IconButton icon={Camera} label="Scan plate" onClick={onOpenScan} />}
      </div>

      <div className="relative">
        <Search className="w-4 h-4 text-subtle absolute left-3 top-1/2 -translate-y-1/2" strokeWidth={1.75} />
        <input
          ref={searchRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setSegment('all')}
          placeholder="Search dal, roti, paneer…"
          className="w-full h-11 pl-9 pr-3 rounded-control border border-border bg-surface-2 text-text placeholder:text-subtle text-sm outline-none focus:border-accent/50"
        />
      </div>

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
              onToggleFavourite={() => toggleFavouriteFood(row.id)}
            />
          ))}
        </Card>
      )}

      <div className="flex gap-2">
        <Button variant="secondary" size="md" icon={Plus} full onClick={() => setCreateOpen(true)}>
          Create food
        </Button>
        <Button variant="secondary" size="md" icon={Zap} full onClick={() => setQuickOpen(true)}>
          Quick add
        </Button>
      </div>

      <FoodEntrySheet
        open={!!selected} onClose={() => setSelected(null)}
        food={selected} date={date} meal={meal} note={sheetNote} onSaved={afterAdd}
      />

      {createOpen && <CreateFoodSheet
        onClose={() => setCreateOpen(false)}
        onCreated={(item) => {
          saveCustomFood(item);
          publishSharedFood(item);
          setCreateOpen(false);
          setSheetNote(undefined);
          setSelected(item);
        }}
        createdBy={user?.uid}
        createdByName={user?.displayName ?? undefined}
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

function ResultRow({ row, favourite, onPick, onToggleFavourite }: {
  row: SearchRow; favourite: boolean; onPick: () => void; onToggleFavourite: () => void;
}) {
  const kcal = rowKcal(row);
  return (
    <div className="flex items-center gap-2 min-h-14 px-1 border-b border-border last:border-b-0">
      <button onClick={onPick} className="flex-1 min-w-0 flex flex-col items-start text-left py-2">
        <span className="text-[15px] leading-[22px] font-semibold text-text truncate w-full">{row.name}</span>
        <span className="text-[13px] leading-[18px] text-muted truncate w-full">
          {sourceLabel(row.source, { brand: row.brand, approx: row.approx })}
          {kcal != null && ` · ${Math.round(kcal)} kcal/100 g`}
        </span>
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

/** Mounted only while open, so the fields start empty every time. */
function CreateFoodSheet({ onClose, onCreated, createdBy, createdByName }: {
  onClose: () => void;
  onCreated: (item: FoodItem) => void;
  createdBy?: string;
  createdByName?: string;
}) {
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [kcal, setKcal] = useState('');
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fat, setFat] = useState('');
  const [fiber, setFiber] = useState('');
  const [unitsText, setUnitsText] = useState('');

  const num = (v: string) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : 0; };
  const valid = name.trim().length > 1 && Number(kcal) > 0 && !!createdBy;

  const submit = () => {
    if (!valid || !createdBy) return;
    const units = parseUnits(unitsText);
    onCreated({
      id: `user:${crypto.randomUUID()}`,
      name: name.trim(),
      brand: brand.trim() || undefined,
      source: 'user',
      per100g: {
        kcal: num(kcal), protein: num(protein), carbs: num(carbs), fat: num(fat),
        fiber: fiber.trim() ? num(fiber) : undefined,
      },
      units: units.length ? units : [{ label: 'serving', grams: 100 }],
      createdBy,
      createdByName,
      createdAt: new Date().toISOString(),
    });
  };

  return (
    <Sheet open onClose={onClose} title="Create food">
      <p className={SUB}>Values per 100 g. Everyone gets to use what you add, so keep it honest.</p>
      <label className="flex flex-col gap-1">
        <span className={CAPTION}>Name</span>
        <input
          value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Mom's rajma"
          className="h-11 px-3 rounded-control border border-border bg-surface-2 text-text placeholder:text-subtle text-sm outline-none focus:border-accent/50"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className={CAPTION}>Brand (optional)</span>
        <input
          value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="e.g. Amul"
          className="h-11 px-3 rounded-control border border-border bg-surface-2 text-text placeholder:text-subtle text-sm outline-none focus:border-accent/50"
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <NumField label="Calories" suffix="kcal" value={kcal} onChange={setKcal} />
        <NumField label="Protein" suffix="g" value={protein} onChange={setProtein} />
        <NumField label="Carbs" suffix="g" value={carbs} onChange={setCarbs} />
        <NumField label="Fat" suffix="g" value={fat} onChange={setFat} />
        <NumField label="Fibre" suffix="g" value={fiber} onChange={setFiber} />
      </div>
      <label className="flex flex-col gap-1">
        <span className={CAPTION}>Units (optional)</span>
        <input
          value={unitsText} onChange={(e) => setUnitsText(e.target.value)} placeholder="katori 150, piece 40"
          className="h-11 px-3 rounded-control border border-border bg-surface-2 text-text placeholder:text-subtle text-sm outline-none focus:border-accent/50"
        />
        <span className="text-xs text-subtle">Label and grams, comma separated. Grams is always available.</span>
      </label>
      {!createdBy && <p className="text-xs text-danger">Sign in to create a food.</p>}
      <Button variant="primary" size="lg" full disabled={!valid} onClick={submit}>Create and log</Button>
    </Sheet>
  );
}

/** Mounted only while open — see `CreateFoodSheet`. */
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
