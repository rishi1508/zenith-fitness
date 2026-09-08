import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Camera, ImagePlus, Minus, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { AppBar, Button, Card, IconButton, SegmentedControl, useToast, CAPTION, H2, SUB } from '../../ui';
import { PremiumBadge, PremiumGate } from '../../premium';
import { getNutritionDay, localDateISO, saveNutritionDay } from '../../health/store';
import type { MealSlot } from '../../types';
import { prepareScanImage, scaleScanItem, ScanError, scanItemToEntry, scanPreparedImage } from '../../nutrition/scan';
import type { ScanErrorKind, ScanItem } from '../../nutrition/scan';

export interface FoodScanViewProps {
  onBack: () => void;
  /** Meal the results are added to. Defaults to a guess from the clock; the user can change it. */
  meal?: MealSlot;
  /** Local date (YYYY-MM-DD) to add to. Defaults to today. */
  date?: string;
  /** Fired after entries are written to the diary. */
  onAdded?: (count: number) => void;
}

const MEALS: Array<{ value: MealSlot; label: string }> = [
  { value: 'breakfast', label: 'Breakfast' },
  { value: 'lunch', label: 'Lunch' },
  { value: 'dinner', label: 'Dinner' },
  { value: 'snacks', label: 'Snacks' },
];

const SCANNING_LINES = [
  'Analysing your plate…',
  'Identifying the dishes…',
  'Estimating portions…',
  'Adding up the calories…',
  'Almost there…',
];

const GRAM_STEP = 25;

/** One editable result row. `base` is what the model actually said, so every
 *  gram correction re-scales from the original estimate rather than from the
 *  previously rounded one. */
interface ScanRowState {
  base: ScanItem;
  item: ScanItem;
}

/** breakfast before 11, lunch before 16, dinner before 21, else snacks. */
function mealForNow(now: Date = new Date()): MealSlot {
  const h = now.getHours();
  if (h < 11) return 'breakfast';
  if (h < 16) return 'lunch';
  if (h < 21) return 'dinner';
  return 'snacks';
}

/**
 * Camera food scan (docs/HEALTH_SPEC.md §6).
 *
 * ONE capture path: the OS camera via `<input capture="environment">`, with
 * the same handler reused for "choose from gallery" (no `capture`). It behaves
 * identically in the Capacitor WebView and the PWA, needs no permission
 * plumbing, and gives the user their phone's real camera UI. The old
 * getUserMedia preview was a second, worse code path — it could hang with no
 * feedback — and is gone.
 *
 * Everything the model returns is an estimate, so nothing is written to
 * the diary until the user has seen the grams and pressed Add.
 */
export function FoodScanView({ onBack, meal, date, onAdded }: FoodScanViewProps) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  const [stage, setStage] = useState<'capture' | 'scanning' | 'result'>('capture');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [rows, setRows] = useState<ScanRowState[]>([]);
  const [note, setNote] = useState('');
  const [hint, setHint] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [target, setTarget] = useState<MealSlot>(() => meal ?? mealForNow());

  const targetDate = date ?? localDateISO();

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const runScan = useCallback(async (file: File) => {
    if (!user) { setError('Please sign in again to scan food.'); return; }
    setError(null);
    setStage('scanning');
    try {
      // Shrink first: this is also what we preview, so a 12 MP camera JPEG is
      // never decoded at full size (that is what used to kill the app).
      const { base64, preview } = await prepareScanImage(file);
      setPreviewUrl((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(preview); });
      const idToken = await user.getIdToken();
      const result = await scanPreparedImage(base64, { idToken, hint: hint.trim() || undefined, meal: target });
      if (typeof result.remainingToday === 'number') setRemaining(result.remainingToday);
      if (result.items.length === 0) {
        setError(result.note || "No food found in that photo. Try again, closer and better lit.");
        setStage('capture');
        return;
      }
      setRows(result.items.map((item) => ({ base: item, item })));
      setNote(result.note);
      setStage('result');
    } catch (err) {
      console.error('[FoodScan] failed', err);
      const kind: ScanErrorKind = err instanceof ScanError ? err.kind : 'unknown';
      setError(errorCopy(kind, err instanceof ScanError ? err.message : ''));
      setStage('capture');
    }
  }, [user, hint, target]);

  const onPick = (file: File | undefined) => {
    if (!file) return;
    void runScan(file);
  };

  const reset = () => {
    setPreviewUrl((old) => { if (old) URL.revokeObjectURL(old); return null; });
    setRows([]);
    setNote('');
    setError(null);
    setStage('capture');
  };

  const addAll = () => {
    if (rows.length === 0) return;
    const day = getNutritionDay(targetDate);
    const entries = rows.map((r) => scanItemToEntry(r.item, target));
    saveNutritionDay({ ...day, entries: [...day.entries, ...entries] });
    showToast(`Added ${entries.length} item${entries.length === 1 ? '' : 's'} to ${target}`, 'success');
    onAdded?.(entries.length);
    reset();
  };

  const totals = rows.reduce(
    (a, { item }) => ({ kcal: a.kcal + item.kcal, protein: a.protein + item.protein, carbs: a.carbs + item.carbs, fat: a.fat + item.fat }),
    { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  );

  return (
    <div className="flex flex-col h-full pb-24">
      <AppBar
        left={
          <div className="flex items-center gap-2 min-w-0">
            <IconButton icon={ArrowLeft} label="Back" size="sm" onClick={onBack} />
            <h1 className={`${H2} truncate`}>Scan food</h1>
            <PremiumBadge />
          </div>
        }
        right={stage === 'result' ? <IconButton icon={RotateCcw} label="Scan again" size="sm" onClick={reset} /> : undefined}
      />

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        <PremiumGate feature="food-scan">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => { onPick(e.target.files?.[0]); e.target.value = ''; }}
          />
          <input
            ref={galleryRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => { onPick(e.target.files?.[0]); e.target.value = ''; }}
          />

          {previewUrl && (
            <img src={previewUrl} alt="Your plate" className="w-full max-h-64 object-cover rounded-2xl border border-border" />
          )}

          {error && (
            <Card tone="danger">
              <p className="text-sm text-danger">{error}</p>
            </Card>
          )}

          {stage === 'scanning' && <ScanningCard />}

          {stage === 'capture' && (
            <>
              <Card>
                <div className="flex flex-col gap-3">
                  <div>
                    <h2 className={H2}>Photograph your plate</h2>
                    <p className={`${SUB} mt-1`}>
                      One shot from above, whole plate in frame. Estimates are approximate — check the grams before adding.
                    </p>
                  </div>
                  <input
                    value={hint}
                    onChange={(e) => setHint(e.target.value)}
                    placeholder="Optional: what is it? e.g. 2 rotis, home dal"
                    className="px-3 py-2.5 rounded-control border border-border bg-surface-2 text-text placeholder:text-subtle text-sm outline-none focus:border-accent/50"
                  />
                  <Button variant="primary" size="lg" icon={Camera} full onClick={() => fileRef.current?.click()}>
                    Take a photo
                  </Button>
                  <Button variant="secondary" size="md" icon={ImagePlus} full onClick={() => galleryRef.current?.click()}>
                    Choose an existing photo
                  </Button>
                </div>
              </Card>
              {remaining !== null && (
                <p className={`${CAPTION} text-center`}>{remaining} scan{remaining === 1 ? '' : 's'} left today</p>
              )}
            </>
          )}

          {stage === 'result' && (
            <>
              <SegmentedControl label="Meal" options={MEALS} value={target} onChange={setTarget} />
              {note && <p className={SUB}>{note}</p>}
              <div className="space-y-2">
                {rows.map((row, i) => (
                  <ScanRow
                    key={`${row.base.name}-${i}`}
                    item={row.item}
                    onGrams={(grams) => setRows((prev) => prev.map((r, j) => (j === i ? { ...r, item: scaleScanItem(r.base, grams) } : r)))}
                    onRemove={() => setRows((prev) => prev.filter((_, j) => j !== i))}
                  />
                ))}
              </div>
              <Card tone="accent">
                <div className="flex items-baseline justify-between">
                  <span className={CAPTION}>Total</span>
                  <span className="text-sm font-bold text-text">
                    {Math.round(totals.kcal)} kcal · P{Math.round(totals.protein)} C{Math.round(totals.carbs)} F{Math.round(totals.fat)} g
                  </span>
                </div>
                <p className="text-[11px] text-subtle mt-1">Approximate — adjust the grams if a portion looks off.</p>
              </Card>
              <Button variant="primary" size="lg" full onClick={addAll} disabled={rows.length === 0}>
                Add {rows.length} item{rows.length === 1 ? '' : 's'} to {target}
              </Button>
              {remaining !== null && (
                <p className={`${CAPTION} text-center`}>{remaining} scan{remaining === 1 ? '' : 's'} left today</p>
              )}
            </>
          )}
        </PremiumGate>
      </div>
    </div>
  );
}

/** Rotating status while the model looks at the photo — same pattern as ZenChatView. */
function ScanningCard() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 2500);
    return () => clearInterval(t);
  }, []);
  return (
    <Card>
      <div className="flex items-center gap-2.5 text-sm text-muted">
        <span className="flex gap-0.5" aria-hidden="true">
          <span className="w-1.5 h-1.5 rounded-full bg-accent animate-bounce" style={{ animationDelay: '0ms' }} />
          <span className="w-1.5 h-1.5 rounded-full bg-accent animate-bounce" style={{ animationDelay: '150ms' }} />
          <span className="w-1.5 h-1.5 rounded-full bg-accent animate-bounce" style={{ animationDelay: '300ms' }} />
        </span>
        {SCANNING_LINES[tick % SCANNING_LINES.length]}
      </div>
    </Card>
  );
}

function ScanRow({ item, onGrams, onRemove }: { item: ScanItem; onGrams: (grams: number) => void; onRemove: () => void }) {
  return (
    <Card>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-bold text-text truncate">{item.name}</p>
          <p className="text-[13px] text-muted">
            {item.kcal} kcal · P{item.protein} C{item.carbs} F{item.fat} g
            {item.confidence < 0.5 ? ' · low confidence' : ''}
          </p>
        </div>
        <IconButton icon={Trash2} label={`Remove ${item.name}`} size="sm" onClick={onRemove} />
      </div>
      <div className="flex items-center gap-2 mt-2">
        <IconButton icon={Minus} label="Less" size="sm" onClick={() => onGrams(Math.max(5, item.grams - GRAM_STEP))} />
        <label className="flex items-center gap-1 flex-1">
          <input
            type="number"
            inputMode="numeric"
            value={item.grams}
            onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n) && n > 0) onGrams(n); }}
            className="w-full h-9 px-2 rounded-control border border-border bg-surface-2 text-text text-sm text-center outline-none focus:border-accent/50"
            aria-label={`Grams of ${item.name}`}
          />
          <span className="text-sm text-muted">g</span>
        </label>
        <IconButton icon={Plus} label="More" size="sm" onClick={() => onGrams(item.grams + GRAM_STEP)} />
      </div>
    </Card>
  );
}

function errorCopy(kind: ScanErrorKind, message: string): string {
  switch (kind) {
    case 'auth': return 'Please sign in again to scan food.';
    case 'quota': return message || "You've used today's scans. More tomorrow — you can still add food by hand.";
    case 'busy': return message || 'The scanner is busy right now. Try again in a moment.';
    case 'network': return "Can't reach the scanner — check your connection and try again.";
    case 'image': return message || "That photo couldn't be used. Take another one.";
    case 'unknown':
    default: return message || 'Something went wrong. Please try again.';
  }
}
