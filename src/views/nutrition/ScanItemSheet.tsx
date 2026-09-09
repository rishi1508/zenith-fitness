import { useEffect, useMemo, useState } from 'react';
import { Check, Search } from 'lucide-react';
import type { FoodRow } from '../../nutrition';
import { getFood, getSharedFoods, loadFoodIndex, loadSharedFoods, macrosFor, searchAllFoods } from '../../nutrition';
import { getCustomFoods } from '../../health/store';
import type { ScanItem } from '../../nutrition/scan';
import { scaleScanItem } from '../../nutrition/scan';
import { Button, Card, Sheet, Skeleton, CAPTION, SUB } from '../../ui';

/**
 * Correct one row of a plate scan before it reaches the diary: rename it,
 * fix the macros by hand, or replace the model's guess outright with a food
 * from the database — which is the honest fix when it says "paneer curry"
 * and it was actually rajma.
 */
export function ScanItemSheet({ item, onSave, onClose }: {
  item: ScanItem;
  onSave: (next: ScanItem) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<ScanItem>(item);
  const [query, setQuery] = useState('');
  const [ready, setReady] = useState(false);
  const [picking, setPicking] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([loadFoodIndex(), loadSharedFoods()])
      .then(() => setReady(true))
      .catch(() => setReady(true));
  }, []);

  // Your own foods and the community's, not just the static index — the
  // whole point of searching here is to say "no, it was THAT food".
  const results = useMemo<FoodRow[]>(
    () => (ready && query.trim().length >= 2 ? searchAllFoods(query, { limit: 8 }).slice(0, 8) : []),
    [query, ready],
  );

  /** Swap in a real food: its per-100 g figures replace the estimate, and the
   *  diary entry will link to it instead of a `scan:` placeholder. */
  const replaceWithFood = async (entry: FoodRow) => {
    setPicking(entry.id);
    try {
      const food = entry.item
        ?? getCustomFoods().find((f) => f.id === entry.id)
        ?? getSharedFoods().find((f) => f.id === entry.id)
        ?? await getFood(entry.id);
      if (!food) return;
      const macros = macrosFor(food, draft.grams);
      setDraft({
        ...draft,
        name: food.name,
        foodId: food.id,
        source: food.source,
        per100g: food.per100g,
        kcal: Math.round(macros.kcal),
        protein: Math.round(macros.protein * 10) / 10,
        carbs: Math.round(macros.carbs * 10) / 10,
        fat: Math.round(macros.fat * 10) / 10,
        confidence: 1,
      });
      setQuery('');
    } finally {
      setPicking(null);
    }
  };

  const num = (v: string) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : 0; };
  const set = (patch: Partial<ScanItem>) => setDraft((d) => ({ ...d, ...patch, per100g: undefined, foodId: undefined, source: undefined }));

  return (
    <Sheet open onClose={onClose} title="Fix this item">
      <div className="space-y-1">
        <label className={CAPTION}>Name</label>
        <input
          value={draft.name}
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          className={FIELD}
          aria-label="Food name"
        />
      </div>

      {/* Replace it with a database food. */}
      <div className="space-y-1">
        <label className={CAPTION}>Wrong food? Find the right one</label>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-subtle" strokeWidth={1.75} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search the food database…"
            className={`${FIELD} pl-9`}
            aria-label="Search foods"
          />
        </div>
        {query.trim().length >= 2 && !ready && <Skeleton className="h-12 w-full" />}
        {results.length > 0 && (
          <Card padding="list">
            {results.map((r) => (
              <button
                key={r.id}
                onClick={() => { void replaceWithFood(r); }}
                disabled={picking !== null}
                className="w-full min-h-12 px-2 flex items-center gap-2 text-left"
              >
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-semibold text-text truncate">{r.name}</span>
                  <span className={`${SUB} block truncate`}>
                    {Math.round(r.kcal100)} kcal / 100 g
                    {r.item && !r.community ? ' · yours' : r.community ? ' · community' : ''}
                    {r.approx ? ' · approx.' : ''}
                  </span>
                </span>
                {picking === r.id && <Check className="w-4 h-4 text-accent shrink-0" strokeWidth={2} />}
              </button>
            ))}
          </Card>
        )}
        {draft.foodId && (
          <p className={SUB}>Matched to the database — macros now come from that food.</p>
        )}
      </div>

      {/* Manual macros. Editing any of them drops the database link, because
          the numbers are no longer that food's. */}
      <div className="grid grid-cols-2 gap-2">
        <Field
          label="Grams"
          value={String(draft.grams)}
          onChange={(v) => setDraft((d) => scaleScanItem(d, Math.max(1, Math.round(num(v)))))}
        />
        <Field label="Calories" value={String(draft.kcal)} onChange={(v) => set({ kcal: Math.round(num(v)) })} />
        <Field label="Protein (g)" value={String(draft.protein)} onChange={(v) => set({ protein: num(v) })} />
        <Field label="Carbs (g)" value={String(draft.carbs)} onChange={(v) => set({ carbs: num(v) })} />
        <Field label="Fat (g)" value={String(draft.fat)} onChange={(v) => set({ fat: num(v) })} />
      </div>

      <Button variant="primary" size="lg" full onClick={() => onSave(draft)}>Save</Button>
    </Sheet>
  );
}

const FIELD = 'w-full h-11 px-3 rounded-control border border-border bg-surface-2 text-text placeholder:text-subtle text-sm outline-none focus:border-accent/50';

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="space-y-1 block">
      <span className={CAPTION}>{label}</span>
      <input
        type="number"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${FIELD} text-center tabular-nums`}
      />
    </label>
  );
}
