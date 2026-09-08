import { useMemo, useState } from 'react';
import { Minus, Pencil, Plus, Trash2 } from 'lucide-react';
import type { FoodEntry, FoodItem, MealSlot } from '../../types';
import { getNutritionDay, pushRecentFood, saveNutritionDay } from '../../health/store';
import { gramsFor, macrosFor } from '../../nutrition';
import { Button, Chip, IconButton, Sheet, CAPTION, SUB } from '../../ui';
import {
  MEALS, MEAL_LABEL, basisLabel, formatQty, removeEntry, sourceLabel, stepQty, upsertEntry,
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
  /** Shown as a pencil next to the title when the viewer may correct this
   *  food's macros or servings (its creator, or an admin). */
  onEditFood?: (food: FoodItem) => void;
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
  onClose, food, date, meal, entry, note, onSaved, onDeleted, onEditFood,
}: FoodEntrySheetProps & { food: FoodItem }) {
  const raw = basisLabel(food);
  const units = useMemo(() => [...food.units, { label: raw, grams: 1 }], [food, raw]);
  const [qty, setQty] = useState(entry?.qty ?? 1);
  const [unitLabel, setUnitLabel] = useState(entry?.unit ?? food.units[0]?.label ?? raw);
  const [slot, setSlot] = useState<MealSlot>(entry?.meal ?? meal);
  // Free typing needs its own string state: "1." and "" are not numbers yet.
  const [qtyText, setQtyText] = useState<string | null>(null);

  const grams = gramsFor(food, qty, unitLabel);
  const macros = macrosFor(food, grams);

  const commitQty = (text: string) => {
    const n = Number(text);
    setQtyText(null);
    if (Number.isFinite(n) && n > 0) setQty(Math.round(n * 100) / 100);
  };

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
      basis: food.basis,
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
    <Sheet
      open
      onClose={onClose}
      title={
        <span className="flex items-center gap-2 min-w-0">
          <span className="truncate">{food.name}</span>
          {onEditFood && (
            <IconButton icon={Pencil} label={`Edit ${food.name}`} size="sm" onClick={() => onEditFood(food)} />
          )}
        </span>
      }
    >
      <p className={SUB}>
        {sourceLabel(food.source, { brand: food.brand, approx: food.approx })}
        {' · '}{Math.round(food.per100g.kcal)} kcal / 100 {raw}
      </p>
      {note && <p className="text-xs text-subtle">{note}</p>}

      <div>
        <span className={CAPTION}>Quantity</span>
        <div className="flex items-center gap-3 mt-2">
          <Button variant="secondary" size="md" icon={Minus} aria-label="Less"
            onClick={() => { setQtyText(null); setQty((q) => stepQty(q, unitLabel, -1)); }} />
          <div className="flex-1 min-w-0 text-center">
            <div className="flex items-baseline justify-center gap-1">
              <input
                value={qtyText ?? formatQty(qty)}
                onChange={(e) => setQtyText(e.target.value.replace(/[^0-9.]/g, ''))}
                onFocus={(e) => { setQtyText(formatQty(qty)); e.currentTarget.select(); }}
                onBlur={(e) => commitQty(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                inputMode="decimal"
                aria-label={`Quantity in ${unitLabel}`}
                className="w-20 bg-transparent border-b border-border focus:border-accent text-center font-display text-2xl font-bold tabular-nums text-text outline-none"
              />
              <span className="text-sm text-muted">{unitLabel}</span>
            </div>
            {unitLabel !== raw && <div className="text-xs text-subtle mt-0.5">{Math.round(grams)} {raw}</div>}
          </div>
          <Button variant="secondary" size="md" icon={Plus} aria-label="More"
            onClick={() => { setQtyText(null); setQty((q) => stepQty(q, unitLabel, 1)); }} />
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
                // The raw unit and household units want different starting
                // quantities (100 g / 250 ml vs 1 katori).
                setQtyText(null);
                setQty(u.label === raw ? Math.max(5, Math.round(grams / 5) * 5) : 1);
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
