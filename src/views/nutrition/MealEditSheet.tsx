import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { SavedMeal, SavedMealItem } from '../../types';
import { Button, Card, IconButton, Sheet, CAPTION, SUB } from '../../ui';
import { formatQty } from './nutritionHelpers';

export interface MealEditSheetProps {
  meal: SavedMeal;
  onClose: () => void;
  /** Fired with the corrected meal; the caller owns the writes. */
  onSave: (meal: SavedMeal) => void;
  /** Set while the caller is saving/publishing. */
  busy?: boolean;
}

/** One item's fields as text — "1." and "" are not numbers yet. */
interface Draft {
  item: SavedMealItem;
  qty: string;
  unit: string;
  kcal: string;
  protein: string;
  carbs: string;
  fat: string;
}

function toDraft(item: SavedMealItem): Draft {
  return {
    item,
    qty: formatQty(item.qty),
    unit: item.unit,
    kcal: String(Math.round(item.macros.kcal)),
    protein: String(item.macros.protein),
    carbs: String(item.macros.carbs),
    fat: String(item.macros.fat),
  };
}

function num(text: string, fallback: number): number {
  const n = Number(text);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** A draft back to a stored item. Grams follow the quantity so "2 katori"
 *  never keeps one katori's weight; the macros are whatever the user typed. */
function toItem(d: Draft): SavedMealItem {
  const qty = Math.max(0.01, num(d.qty, d.item.qty));
  const perUnit = d.item.qty > 0 ? d.item.grams / d.item.qty : d.item.grams;
  return {
    ...d.item,
    qty,
    unit: d.unit.trim() || d.item.unit,
    grams: Math.round(perUnit * qty * 10) / 10,
    macros: {
      ...d.item.macros,
      kcal: num(d.kcal, d.item.macros.kcal),
      protein: num(d.protein, d.item.macros.protein),
      carbs: num(d.carbs, d.item.macros.carbs),
      fat: num(d.fat, d.item.macros.fat),
    },
  };
}

/**
 * Correcting a saved meal — the creator's own, or anybody's when an admin
 * opens it (docs/HEALTH_SPEC.md §3). The name and every item's quantity,
 * unit and four macros are editable; `SavedMeal.kcal` is recomputed from the
 * items so the list line can never drift from what the meal actually holds.
 */
export function MealEditSheet({ meal, onClose, onSave, busy }: MealEditSheetProps) {
  const [name, setName] = useState(meal.name);
  const [drafts, setDrafts] = useState<Draft[]>(() => meal.items.map(toDraft));

  const items = drafts.map(toItem);
  const kcal = Math.round(items.reduce((sum, i) => sum + i.macros.kcal, 0));
  const valid = !!name.trim() && items.length > 0;

  const patch = (i: number, field: keyof Omit<Draft, 'item'>, value: string) => {
    setDrafts((prev) => prev.map((d, j) => (j === i ? { ...d, [field]: value } : d)));
  };

  return (
    <Sheet open onClose={onClose} title="Edit meal">
      <p className={SUB}>{items.length} item{items.length === 1 ? '' : 's'} · {kcal} kcal</p>

      <label className="flex flex-col gap-1">
        <span className={CAPTION}>Name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="Meal name"
          className="h-11 px-3 rounded-control border border-border bg-surface-2 text-text placeholder:text-subtle text-sm outline-none focus:border-accent/50"
        />
      </label>

      {drafts.map((d, i) => (
        <Card key={`${d.item.foodId}-${i}`}>
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-bold text-text truncate">{d.item.name}</p>
            {drafts.length > 1 && (
              <IconButton
                icon={Trash2} label={`Remove ${d.item.name}`} size="sm"
                onClick={() => setDrafts((prev) => prev.filter((_, j) => j !== i))}
              />
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 mt-2">
            <Field label="Quantity" value={d.qty} onChange={(v) => patch(i, 'qty', v)} name={d.item.name} />
            <Field label="Unit" value={d.unit} onChange={(v) => patch(i, 'unit', v)} name={d.item.name} text />
          </div>
          <div className="grid grid-cols-4 gap-2 mt-2">
            <Field label="kcal" value={d.kcal} onChange={(v) => patch(i, 'kcal', v)} name={d.item.name} />
            <Field label="P (g)" value={d.protein} onChange={(v) => patch(i, 'protein', v)} name={d.item.name} />
            <Field label="C (g)" value={d.carbs} onChange={(v) => patch(i, 'carbs', v)} name={d.item.name} />
            <Field label="F (g)" value={d.fat} onChange={(v) => patch(i, 'fat', v)} name={d.item.name} />
          </div>
        </Card>
      ))}

      <p className={CAPTION}>A meal keeps at least one item — delete the meal itself to drop it entirely.</p>

      <Button
        variant="primary" size="lg" full disabled={!valid || busy} loading={busy}
        onClick={() => { if (valid && !busy) onSave({ ...meal, name: name.trim(), items, kcal }); }}
      >
        Save meal
      </Button>
    </Sheet>
  );
}

function Field({ label, value, onChange, name, text }: {
  label: string; value: string; onChange: (v: string) => void; name: string; text?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1 min-w-0">
      <span className={CAPTION}>{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(text ? e.target.value : e.target.value.replace(/[^0-9.]/g, ''))}
        inputMode={text ? 'text' : 'decimal'}
        aria-label={`${label} of ${name}`}
        className="h-11 px-2 rounded-control border border-border bg-surface-2 text-text text-sm text-center outline-none focus:border-accent/50"
      />
    </label>
  );
}
