import { useMemo, useState } from 'react';
import { Minus, Plus, Trash2 } from 'lucide-react';
import type { FoodEntry, FoodItem, MealSlot } from '../../types';
import { getNutritionDay, pushRecentFood, saveNutritionDay } from '../../health/store';
import { gramsFor, macrosFor } from '../../nutrition';
import { Button, Chip, Sheet, CAPTION, SUB } from '../../ui';
import {
  MEALS, MEAL_LABEL, formatQty, removeEntry, sourceLabel, stepQty, upsertEntry,
} from './nutritionHelpers';

export interface FoodEntrySheetProps {
  open: boolean;
  onClose: () => void;
  /** Food being logged. `null` renders nothing. */
  food: FoodItem | null;
  /** Diary day the entry belongs to (YYYY-MM-DD). */
  date: string;
  /** Meal preselected in the picker. */
  meal: MealSlot;
  /** Editing an existing entry — pre-fills qty/unit/meal and shows Delete. */
  entry?: FoodEntry | null;
  /** Extra line under the title, e.g. the Open Food Facts attribution. */
  note?: string;
  /** Fired after the day has been saved (add or edit). */
  onSaved?: (entry: FoodEntry) => void;
  /** Fired after the entry has been deleted. */
  onDeleted?: (entryId: string) => void;
}

/**
 * Quantity + unit + meal picker with live macros (docs/HEALTH_SPEC.md §3).
 * Owns the write: `saveNutritionDay` for the day it was given, plus
 * `pushRecentFood` for new entries so the food surfaces under Recents.
 *
 * The form is a separate component keyed by food + entry so opening it for
 * something else starts from that food's own defaults — no reset effect.
 */
export function FoodEntrySheet(props: FoodEntrySheetProps) {
  if (!props.open || !props.food) return null;
  return <EntryForm {...props} key={`${props.food.id}:${props.entry?.id ?? 'new'}`} food={props.food} />;
}

function EntryForm({
  onClose, food, date, meal, entry, note, onSaved, onDeleted,
}: FoodEntrySheetProps & { food: FoodItem }) {
  const units = useMemo(() => [...food.units, { label: 'g', grams: 1 }], [food]);
  const [qty, setQty] = useState(entry?.qty ?? 1);
  const [unitLabel, setUnitLabel] = useState(entry?.unit ?? food.units[0]?.label ?? 'g');
  const [slot, setSlot] = useState<MealSlot>(entry?.meal ?? meal);

  const grams = gramsFor(food, qty, unitLabel);
  const macros = macrosFor(food, grams);

  const save = () => {
    const day = getNutritionDay(date);
    const next: FoodEntry = {
      id: entry?.id ?? crypto.randomUUID(),
      foodId: food.id,
      name: food.name,
      source: food.source,
      meal: slot,
      qty,
      unit: unitLabel,
      grams: Math.round(grams * 10) / 10,
      macros,
      at: entry?.at ?? new Date().toISOString(),
      approx: food.approx,
    };
    saveNutritionDay(upsertEntry(day, next));
    if (!entry) pushRecentFood(food);
    onSaved?.(next);
    onClose();
  };

  const remove = () => {
    if (!entry) return;
    saveNutritionDay(removeEntry(getNutritionDay(date), entry.id));
    onDeleted?.(entry.id);
    onClose();
  };

  return (
    <Sheet open onClose={onClose} title={food.name}>
      <p className={SUB}>
        {sourceLabel(food.source, { brand: food.brand, approx: food.approx })}
        {' · '}{Math.round(food.per100g.kcal)} kcal / 100 g
      </p>
      {note && <p className="text-xs text-subtle">{note}</p>}

      <div>
        <span className={CAPTION}>Quantity</span>
        <div className="flex items-center gap-3 mt-2">
          <Button variant="secondary" size="md" icon={Minus} aria-label="Less"
            onClick={() => setQty((q) => stepQty(q, unitLabel, -1))} />
          <div className="flex-1 text-center">
            <span className="font-display text-2xl font-bold tabular-nums text-text">{formatQty(qty)}</span>
            <span className="text-sm text-muted"> {unitLabel}</span>
            {unitLabel !== 'g' && <div className="text-xs text-subtle">{Math.round(grams)} g</div>}
          </div>
          <Button variant="secondary" size="md" icon={Plus} aria-label="More"
            onClick={() => setQty((q) => stepQty(q, unitLabel, 1))} />
        </div>
      </div>

      <div>
        <span className={CAPTION}>Unit</span>
        <div className="flex flex-wrap gap-2 mt-2">
          {units.map((u) => (
            <Chip
              key={u.label}
              on={u.label === unitLabel}
              onClick={() => {
                // Grams and household units want different starting
                // quantities (100 g vs 1 katori).
                setQty(u.label === 'g' ? Math.max(5, Math.round(grams / 5) * 5) : 1);
                setUnitLabel(u.label);
              }}
            >
              {u.label}
            </Chip>
          ))}
        </div>
      </div>

      <div>
        <span className={CAPTION}>Meal</span>
        <div className="flex flex-wrap gap-2 mt-2">
          {MEALS.map((m) => (
            <Chip key={m} on={m === slot} onClick={() => setSlot(m)}>{MEAL_LABEL[m]}</Chip>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2">
        <Macro label="kcal" value={Math.round(macros.kcal)} />
        <Macro label="Protein" value={macros.protein} suffix="g" />
        <Macro label="Carbs" value={macros.carbs} suffix="g" />
        <Macro label="Fat" value={macros.fat} suffix="g" />
      </div>

      <div className="flex gap-2">
        {entry && (
          <Button variant="secondary" size="lg" icon={Trash2} aria-label="Delete entry" onClick={remove} />
        )}
        <Button variant="primary" size="lg" full onClick={save}>
          {entry ? 'Save changes' : `Add to ${MEAL_LABEL[slot].toLowerCase()}`}
        </Button>
      </div>
    </Sheet>
  );
}

function Macro({ label, value, suffix }: { label: string; value: number; suffix?: string }) {
  return (
    <div className="rounded-control bg-surface-2 px-2 py-2 text-center">
      <div className={`${CAPTION} truncate`}>{label}</div>
      <div className="text-sm font-bold tabular-nums text-text">
        {Math.round(value * 10) / 10}{suffix ? ` ${suffix}` : ''}
      </div>
    </div>
  );
}
