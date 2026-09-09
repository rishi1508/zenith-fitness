import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, CopyPlus, GlassWater, Minus, Plus, Target } from 'lucide-react';
import type { FoodEntry, FoodItem, MealSlot } from '../../types';
import {
  addDaysISO, fetchNutritionDay, getCustomFoods, getNutritionDay, getRecentFoods, getTargets,
  localDateISO, saveMeal, saveNutritionDay, subscribeHealth, sumMacros,
} from '../../health/store';
import { getFood } from '../../nutrition';
import { hapticImpact } from '../../haptics';
import {
  Button, Card, IconButton, Pill, SectionHeader, useToast, CAPTION, H2, SUB, useConfirm, TAB_BAR_HEIGHT,
} from '../../ui';
import { NutritionRing } from './NutritionRing';
import { FoodEntrySheet } from './FoodEntrySheet';
import {
  GLASS_ML, MEALS, MEAL_LABEL, canEditFood, canGoForward, copyDayEntries, dayLabel, entriesForMeal,
  foodFromEntry, basisLabel, formatQty, glassesFor, mealKcal, publishSharedFood, removeEntry, shiftDate,
  toSavedItem,
} from './nutritionHelpers';
import { MealsSheet, SaveMealSheet } from './MealsSheet';
import { publishMeal } from './sharedMeals';
import { useAuth } from '../../auth/AuthContext';
import { isAdmin } from '../../admin';
import { FoodSheet } from './foodEditing';
import { replaceCachedFood, saveCustomFood } from '../../health/store';

export interface NutritionTodayViewProps {
  onBack: () => void;
  /** Push `FoodSearchView` for this day + meal. */
  onAddFood: (date: string, meal: MealSlot) => void;
  /** Push `TargetsView`. */
  onOpenTargets: () => void;
  /** Day to open on (YYYY-MM-DD). Defaults to today. */
  initialDate?: string;
}

/**
 * The food diary (docs/HEALTH_SPEC.md §3). Renders the cached day
 * instantly and reconciles it with one Firestore read per day visited;
 * every write goes back through `saveNutritionDay`, and `subscribeHealth`
 * re-renders when anything in the health store changes.
 */
/** breakfast before 11, lunch before 16, dinner before 21, else snacks —
 *  the same guess the plate scanner makes. */
function mealForNow(now: Date = new Date()): MealSlot {
  const h = now.getHours();
  if (h < 11) return 'breakfast';
  if (h < 16) return 'lunch';
  if (h < 21) return 'dinner';
  return 'snacks';
}

export function NutritionTodayView({ onBack, onAddFood, onOpenTargets, initialDate }: NutritionTodayViewProps) {
  const { showToast } = useToast();
  const { user } = useAuth();
  const today = localDateISO();
  const [date, setDate] = useState(() => initialDate ?? today);
  const [tick, setTick] = useState(0);
  const [editing, setEditing] = useState<{ entry: FoodEntry; food: FoodItem } | null>(null);
  const fetched = useRef<Set<string>>(new Set());

  useEffect(() => subscribeHealth(() => setTick((t) => t + 1)), []);

  // One read per day visited, ever — the cache answers on the way back.
  useEffect(() => {
    if (fetched.current.has(date)) return;
    fetched.current.add(date);
    void fetchNutritionDay(date);
  }, [date]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const day = useMemo(() => getNutritionDay(date), [date, tick]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const targets = useMemo(() => getTargets(), [tick]);
  const totals = useMemo(() => sumMacros(day), [day]);
  const yesterday = useMemo(() => getNutritionDay(addDaysISO(date, -1)), [date, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  const { confirm: confirmDialog } = useConfirm();
  // Saved meals (docs/HEALTH_SPEC.md §3): pick one to add, or save a section.
  const [mealPicker, setMealPicker] = useState<MealSlot | null>(null);
  const [savingMeal, setSavingMeal] = useState<MealSlot | null>(null);
  const deleteEntry = async (entry: FoodEntry) => {
    void hapticImpact('light');
    if (!(await confirmDialog({ title: 'Remove entry?', message: `Remove ${entry.name} from this day?`, confirmLabel: 'Remove', tone: 'danger' }))) return;
    saveNutritionDay(removeEntry(getNutritionDay(date), entry.id));
    showToast(`${entry.name} removed.`);
  };

  const [editingFood, setEditingFood] = useState<FoodItem | null>(null);

  const openEntry = async (entry: FoodEntry) => {
    const local = getCustomFoods().find((f) => f.id === entry.foodId)
      ?? getRecentFoods().find((f) => f.id === entry.foodId);
    const food = local ?? await Promise.resolve(getFood(entry.foodId));
    setEditing({ entry, food: food ?? foodFromEntry(entry) });
  };

  const addWater = (deltaMl: number) => {
    const current = getNutritionDay(date);
    saveNutritionDay({ ...current, waterMl: Math.max(0, current.waterMl + deltaMl) });
  };

  const copyYesterday = () => {
    const source = getNutritionDay(addDaysISO(date, -1));
    if (source.entries.length === 0) return;
    const current = getNutritionDay(date);
    saveNutritionDay({
      ...current,
      entries: [...current.entries, ...copyDayEntries(source.entries, {
        id: () => crypto.randomUUID(), at: new Date().toISOString(),
      })],
    });
    showToast(`Copied ${source.entries.length} item${source.entries.length === 1 ? '' : 's'} from yesterday.`);
  };

  return (
    <div className="space-y-4 animate-fadeIn">
      <div className="flex items-center gap-3">
        <IconButton icon={ArrowLeft} label="Back" onClick={onBack} />
        <h1 className={`${H2} flex-1 truncate`}>Nutrition</h1>
        <IconButton icon={Target} label="Targets" onClick={onOpenTargets} />
      </div>

      <div className="flex items-center justify-between gap-2">
        <IconButton icon={ChevronLeft} label="Previous day" size="sm" onClick={() => setDate((d) => shiftDate(d, -1, today))} />
        <div className="text-center min-w-0">
          <div className="text-[15px] font-bold text-text truncate">{dayLabel(date, today)}</div>
          <div className="text-xs text-subtle tabular-nums">{date}</div>
        </div>
        <IconButton
          icon={ChevronRight} label="Next day" size="sm"
          disabled={!canGoForward(date, today)}
          className={canGoForward(date, today) ? '' : 'opacity-40 pointer-events-none'}
          onClick={() => setDate((d) => shiftDate(d, 1, today))}
        />
      </div>

      <Card>
        <NutritionRing day={day} targets={targets} showMacros={false} />
        {targets ? (
          <div className="mt-4 space-y-2.5">
            <MacroBar label="Protein" value={totals.protein} target={targets.protein} />
            <MacroBar label="Carbs" value={totals.carbs} target={targets.carbs} />
            <MacroBar label="Fat" value={totals.fat} target={targets.fat} />
          </div>
        ) : (
          <div className="mt-4 flex flex-col items-center gap-2 text-center">
            <p className={SUB}>Set daily targets and the ring fills against them.</p>
            <Button variant="secondary" size="md" icon={Target} onClick={onOpenTargets}>Set targets</Button>
          </div>
        )}
      </Card>

      <Card>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <GlassWater className="w-[18px] h-[18px] text-info shrink-0" strokeWidth={1.75} />
            <div className="min-w-0">
              <div className={CAPTION}>Water</div>
              <div className="text-[15px] font-bold tabular-nums text-text">
                {targets?.waterMl
                  ? `${glassesFor(day.waterMl)} of ${glassesFor(targets.waterMl)} glasses`
                  : `${glassesFor(day.waterMl)} glass${glassesFor(day.waterMl) === 1 ? '' : 'es'}`}
              </div>
              <div className="text-xs text-subtle tabular-nums">
                {day.waterMl} ml{targets?.waterMl ? ` of ${targets.waterMl} ml` : ''}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <IconButton
              icon={Minus} label="Remove a glass" size="sm"
              disabled={day.waterMl <= 0}
              className={day.waterMl <= 0 ? 'opacity-40 pointer-events-none' : ''}
              onClick={() => addWater(-GLASS_ML)}
            />
            <Button variant="secondary" size="sm" icon={Plus} onClick={() => addWater(GLASS_ML)}>1 glass</Button>
          </div>
        </div>
        {targets?.waterMl ? (
          <div className="mt-3 h-1.5 rounded-full bg-surface-2 overflow-hidden">
            <div
              className="h-full rounded-full bg-info"
              style={{ width: `${Math.min(100, (day.waterMl / targets.waterMl) * 100)}%` }}
            />
          </div>
        ) : null}
      </Card>

      {MEALS.map((meal) => {
        const entries = entriesForMeal(day.entries, meal);
        return (
          <div key={meal} className="space-y-2">
            <SectionHeader
              caption={`${MEAL_LABEL[meal]}${entries.length ? ` · ${mealKcal(day.entries, meal)} kcal` : ''}`}
              trailing={(
                <div className="flex items-center gap-3">
                  {entries.length > 0 && (
                    <button onClick={() => setSavingMeal(meal)} className="text-[13px] font-bold text-muted">Save as meal</button>
                  )}
                  <button onClick={() => setMealPicker(meal)} className="text-[13px] font-bold text-muted">Meals</button>
                  <button onClick={() => onAddFood(date, meal)} className="text-[13px] font-bold text-accent">+ Add</button>
                </div>
              )}
            />
            <Card padding="list">
              {entries.length === 0 ? (
                <div className="min-h-14 flex items-center px-1">
                  <span className={SUB}>Nothing logged.</span>
                </div>
              ) : (
                entries.map((entry) => (
                  <EntryRow
                    key={entry.id}
                    entry={entry}
                    onOpen={() => { void openEntry(entry); }}
                    onLongPress={() => deleteEntry(entry)}
                  />
                ))
              )}
            </Card>
          </div>
        );
      })}

      {/* The diary's job is to be added to, so the way in is a button you
          cannot miss rather than a small "+ Add" beside a meal heading. */}
      <button
        onClick={() => onAddFood(date, mealForNow())}
        className="fixed right-4 z-30 h-14 pl-4 pr-5 rounded-full bg-accent text-white font-bold text-[15px] shadow-lg shadow-accent/30 flex items-center gap-2 active:scale-95 transition-transform"
        style={{ bottom: `calc(${TAB_BAR_HEIGHT}px + env(safe-area-inset-bottom, 0px) + 16px)` }}
      >
        <Plus className="w-5 h-5" strokeWidth={2.5} />
        Log food
      </button>

      {mealPicker && (
        <MealsSheet
          meal={mealPicker}
          onClose={() => setMealPicker(null)}
          onPick={(saved) => {
            const now = new Date().toISOString();
            const fresh = getNutritionDay(date);
            const added = saved.items.map((item) => ({ ...item, id: crypto.randomUUID(), at: now, meal: mealPicker }));
            saveNutritionDay({ ...fresh, entries: [...fresh.entries, ...added] });
            setMealPicker(null);
            showToast(`Added ${saved.name} (${added.length} item${added.length === 1 ? '' : 's'}).`);
          }}
        />
      )}

      {savingMeal && (() => {
        const items = entriesForMeal(day.entries, savingMeal);
        const kcal = items.reduce((sum, e) => sum + e.macros.kcal, 0);
        return (
          <SaveMealSheet
            defaultName={`My ${MEAL_LABEL[savingMeal].toLowerCase()}`}
            itemCount={items.length}
            kcal={kcal}
            onClose={() => setSavingMeal(null)}
            onSave={(name, share) => {
              const saved = {
                id: `meal:${crypto.randomUUID()}`,
                name,
                // Drop the per-day identity so re-adding never collides.
                items: items.map((e) => toSavedItem(e)),
                kcal: Math.round(kcal),
                createdBy: user?.uid,
                createdByName: user?.displayName ?? undefined,
                createdAt: new Date().toISOString(),
                shared: share,
              };
              saveMeal(saved);
              if (share) publishMeal(saved).catch(() => showToast('Saved, but publishing failed.', 'error'));
              setSavingMeal(null);
              showToast(share ? `Saved and shared "${name}".` : `Saved "${name}".`);
            }}
          />
        );
      })()}

      {day.entries.length === 0 && yesterday.entries.length > 0 && (
        <Button variant="secondary" size="md" icon={CopyPlus} full onClick={copyYesterday}>
          Copy yesterday ({yesterday.entries.length} items)
        </Button>
      )}

      <p className="text-[11px] leading-relaxed text-center px-4 text-subtle">
        Long-press an entry to remove it, or tap to change the quantity. Dishes marked
        “approx.” are recipe estimates, not lab values.
      </p>

      <FoodEntrySheet
        open={!!editing}
        onClose={() => setEditing(null)}
        food={editing?.food ?? null}
        entry={editing?.entry ?? null}
        date={date}
        meal={editing?.entry.meal ?? 'breakfast'}
        canCorrect={isAdmin(user?.uid)}
        onEditFood={editing && canEditFood(editing.food, user?.uid)
          ? (f) => { setEditing(null); setEditingFood(f); }
          : undefined}
      />

      {editingFood && (
        <FoodSheet
          title={`Edit ${editingFood.name}`}
          submitLabel="Save food"
          initial={editingFood}
          onClose={() => setEditingFood(null)}
          onSubmit={(values) => {
            const next: FoodItem = { ...editingFood, ...values };
            saveCustomFood(next);
            replaceCachedFood(next);
            if (next.createdBy) publishSharedFood(next);
            setEditingFood(null);
            showToast(`Saved ${next.name}. New logs use the corrected figures.`);
          }}
        />
      )}
    </div>
  );
}

function MacroBar({ label, value, target }: { label: string; value: number; target: number }) {
  const pct = target > 0 ? Math.min(100, (value / target) * 100) : 0;
  const over = value > target;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <span className={CAPTION}>{label}</span>
        <span className={`text-xs font-bold tabular-nums ${over ? 'text-warn' : 'text-muted'}`}>
          {Math.round(value)} / {target} g
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden">
        <div className={`h-full rounded-full ${over ? 'bg-warn' : 'bg-accent'}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

const LONG_PRESS_MS = 500;

function EntryRow({ entry, onOpen, onLongPress }: {
  entry: FoodEntry; onOpen: () => void; onLongPress: () => void;
}) {
  const timer = useRef<number | null>(null);
  const fired = useRef(false);

  const clear = () => {
    if (timer.current !== null) { clearTimeout(timer.current); timer.current = null; }
  };
  const start = () => {
    fired.current = false;
    clear();
    timer.current = window.setTimeout(() => { fired.current = true; onLongPress(); }, LONG_PRESS_MS);
  };

  return (
    <button
      onPointerDown={start}
      onPointerUp={clear}
      onPointerLeave={clear}
      onPointerCancel={clear}
      onContextMenu={(e) => e.preventDefault()}
      onClick={() => { if (!fired.current) onOpen(); }}
      className="flex items-center gap-3 min-h-14 px-1 w-full text-left border-b border-border last:border-b-0 transition-colors hover:bg-surface-2/40"
    >
      <span className="flex-1 min-w-0 flex flex-col">
        <span className="text-[15px] leading-[22px] font-semibold text-text truncate">{entry.name}</span>
        <span className="text-[13px] leading-[18px] text-muted truncate">
          {formatQty(entry.qty)} {entry.unit}
          {entry.unit !== basisLabel(entry) && entry.grams > 0 ? ` · ${Math.round(entry.grams)} ${basisLabel(entry)}` : ''}
          {` · ${Math.round(entry.macros.kcal)} kcal`}
        </span>
      </span>
      {entry.approx && <Pill tone="neutral">approx.</Pill>}
    </button>
  );
}
