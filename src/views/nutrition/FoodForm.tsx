import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { FoodItem, FoodUnit, Macros } from '../../types';
import { Button, Chip, IconButton, CAPTION, SUB } from '../../ui';

/** What the create/edit sheets collect. `basis` decides whether the numbers
 *  are per 100 g (solids) or per 100 ml (drinks) — the app then labels every
 *  amount for this food in that unit instead of always saying "g". */
export interface FoodFormValues {
  name: string;
  brand?: string;
  basis: 'g' | 'ml';
  per100g: Macros;
  units: FoodUnit[];
}

/** Household measures offered as one-tap presets, per basis. */
const PRESETS: Record<'g' | 'ml', Array<{ label: string; amount: number }>> = {
  g: [
    { label: 'katori', amount: 150 }, { label: 'small katori', amount: 100 },
    { label: 'roti', amount: 40 }, { label: 'piece', amount: 50 },
    { label: 'plate', amount: 300 }, { label: 'bowl', amount: 200 },
    { label: 'tbsp', amount: 15 }, { label: 'tsp', amount: 5 },
    { label: 'slice', amount: 25 }, { label: 'scoop', amount: 30 },
  ],
  ml: [
    { label: 'glass', amount: 250 }, { label: 'cup', amount: 250 },
    { label: 'small cup', amount: 150 }, { label: 'mug', amount: 350 },
    { label: 'bottle', amount: 500 }, { label: 'can', amount: 330 },
    { label: 'tbsp', amount: 15 }, { label: 'tsp', amount: 5 },
  ],
};

interface UnitRow { id: string; label: string; amount: string }

function rowsFromUnits(units: FoodUnit[]): UnitRow[] {
  return units.map((u) => ({ id: crypto.randomUUID(), label: u.label, amount: String(u.grams) }));
}

function unitsFromRows(rows: UnitRow[]): FoodUnit[] {
  const out: FoodUnit[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const label = r.label.trim();
    const grams = Number(r.amount);
    if (!label || !Number.isFinite(grams) || grams <= 0) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label, grams });
  }
  return out;
}

const INPUT = 'h-11 px-3 rounded-control border border-border bg-surface-2 text-text placeholder:text-subtle text-sm outline-none focus:border-accent/50';

function NumField({ label, value, onChange, suffix, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; suffix?: string; placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1 min-w-0">
      <span className={CAPTION}>{label}{suffix ? ` (${suffix})` : ''}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} inputMode="decimal" placeholder={placeholder}
        aria-label={label} className={INPUT} />
    </label>
  );
}

/**
 * The shared body of "Create food" and "Edit food". Owns nothing but its own
 * fields: the caller decides what to do with `onSubmit(values)` and renders
 * it inside a Sheet.
 */
export function FoodForm({ initial, submitLabel, busy, onSubmit }: {
  initial?: Partial<FoodItem>;
  submitLabel: string;
  busy?: boolean;
  onSubmit: (values: FoodFormValues) => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [brand, setBrand] = useState(initial?.brand ?? '');
  const [basis, setBasis] = useState<'g' | 'ml'>(initial?.basis ?? 'g');
  const [kcal, setKcal] = useState(initial?.per100g ? String(initial.per100g.kcal) : '');
  const [protein, setProtein] = useState(initial?.per100g ? String(initial.per100g.protein) : '');
  const [carbs, setCarbs] = useState(initial?.per100g ? String(initial.per100g.carbs) : '');
  const [fat, setFat] = useState(initial?.per100g ? String(initial.per100g.fat) : '');
  const [fiber, setFiber] = useState(initial?.per100g?.fiber != null ? String(initial.per100g.fiber) : '');
  const [rows, setRows] = useState<UnitRow[]>(() => rowsFromUnits(initial?.units ?? []));

  const num = (v: string) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : 0; };
  const valid = name.trim().length > 1 && Number(kcal) > 0;
  const unitWord = basis === 'ml' ? 'ml' : 'g';

  const addRow = (label = '', amount = '') =>
    setRows((prev) => [...prev, { id: crypto.randomUUID(), label, amount }]);
  const setRow = (id: string, patch: Partial<UnitRow>) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const dropRow = (id: string) => setRows((prev) => prev.filter((r) => r.id !== id));

  const usedLabels = new Set(rows.map((r) => r.label.trim().toLowerCase()));

  return (
    <>
      <p className={SUB}>
        Nutrition per 100 {unitWord}. Everyone gets to use what you add, so keep it honest.
      </p>

      <label className="flex flex-col gap-1">
        <span className={CAPTION}>Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Milk coffee"
          aria-label="Name" className={INPUT} />
      </label>

      <label className="flex flex-col gap-1">
        <span className={CAPTION}>Brand (optional)</span>
        <input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="e.g. Amul"
          aria-label="Brand" className={INPUT} />
      </label>

      <div>
        <span className={CAPTION}>Measured in</span>
        <div className="flex gap-2 mt-2">
          <Chip on={basis === 'g'} onClick={() => setBasis('g')}>Grams (solid)</Chip>
          <Chip on={basis === 'ml'} onClick={() => setBasis('ml')}>Millilitres (drink)</Chip>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <NumField label="Calories" suffix="kcal" value={kcal} onChange={setKcal} placeholder="0" />
        <NumField label="Protein" suffix="g" value={protein} onChange={setProtein} placeholder="0" />
        <NumField label="Carbs" suffix="g" value={carbs} onChange={setCarbs} placeholder="0" />
        <NumField label="Fat" suffix="g" value={fat} onChange={setFat} placeholder="0" />
        <NumField label="Fibre" suffix="g" value={fiber} onChange={setFiber} placeholder="0" />
      </div>

      <div>
        <span className={CAPTION}>Serving sizes (optional)</span>
        <p className="text-xs text-subtle mt-1">
          How you actually measure it — “1 glass = 250 ml”. {unitWord === 'ml' ? 'Millilitres' : 'Grams'} is always available too.
        </p>

        <div className="space-y-2 mt-2">
          {rows.map((row) => (
            <div key={row.id} className="flex items-center gap-2">
              <input
                value={row.label}
                onChange={(e) => setRow(row.id, { label: e.target.value })}
                placeholder="glass"
                aria-label="Serving name"
                className={`${INPUT} flex-1 min-w-0`}
              />
              <span className="text-sm text-subtle">=</span>
              <input
                value={row.amount}
                onChange={(e) => setRow(row.id, { amount: e.target.value })}
                inputMode="decimal"
                placeholder="250"
                aria-label={`Amount in ${unitWord}`}
                className={`${INPUT} w-20 text-center`}
              />
              <span className="text-sm text-muted w-6">{unitWord}</span>
              <IconButton icon={X} label={`Remove ${row.label || 'serving'}`} size="sm" onClick={() => dropRow(row.id)} />
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-2 mt-2">
          {PRESETS[basis]
            .filter((p) => !usedLabels.has(p.label))
            .slice(0, 6)
            .map((p) => (
              <Chip key={p.label} onClick={() => addRow(p.label, String(p.amount))}>
                + {p.label} {p.amount}{unitWord}
              </Chip>
            ))}
          <Chip onClick={() => addRow()}>
            <span className="inline-flex items-center gap-1"><Plus className="w-3 h-3" strokeWidth={2.5} /> Custom</span>
          </Chip>
        </div>
      </div>

      <Button
        variant="primary" size="lg" full disabled={!valid || busy} loading={busy}
        onClick={() => valid && onSubmit({
          name: name.trim(),
          brand: brand.trim() || undefined,
          basis,
          per100g: {
            kcal: num(kcal), protein: num(protein), carbs: num(carbs), fat: num(fat),
            fiber: fiber.trim() ? num(fiber) : undefined,
          },
          units: unitsFromRows(rows),
        })}
      >
        {submitLabel}
      </Button>
    </>
  );
}
