import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Camera, ImagePlus, Minus, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { AppBar, Button, Card, IconButton, SegmentedControl, useToast, CAPTION, H2, SUB } from '../../ui';
import { PremiumBadge, PremiumGate } from '../../premium';
import { getNutritionDay, localDateISO, saveCustomFood, saveNutritionDay } from '../../health/store';
import type { FoodEntry, FoodItem, MealSlot } from '../../types';
import { findFoodByName, loadSharedFoods } from '../../nutrition';
import { publishSharedFood } from './nutritionHelpers';
import { prepareScanImage, scaleScanItem, ScanError, scanItemToEntry, scanPreparedImage } from '../../nutrition/scan';
import type { ScanErrorKind, ScanItem } from '../../nutrition/scan';
import { ScanItemSheet } from './ScanItemSheet';
import { capturePhoto, nativePhotoCapture, PhotoCancelled } from '../../nativeCamera';
import { consumeRestoredPhoto } from '../../captureRestore';

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

/** How long a scan usually takes. Only used to pace the progress bar, which
 *  eases towards 95 % and waits there rather than pretending to finish. */
const TYPICAL_SCAN_MS = 12_000;

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

  const [stage, setStage] = useState<'capture' | 'preparing' | 'scanning' | 'result'>('capture');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [rows, setRows] = useState<ScanRowState[]>([]);
  const [note, setNote] = useState('');
  const [hint, setHint] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [target, setTarget] = useState<MealSlot>(() => meal ?? mealForNow());
  const [editing, setEditing] = useState<number | null>(null);

  const targetDate = date ?? localDateISO();

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);
  // Warm the community library so "does this food already exist?" is answerable.
  useEffect(() => { void loadSharedFoods(); }, []);

  const runScan = useCallback(async (file: Blob) => {
    if (!user) { setError('Please sign in again to scan food.'); return; }
    setError(null);
    // Two visible stages: shrinking the photo on-device (a second or two on a
    // mid-range phone, and previously silent), then the model round trip.
    setStage('preparing');
    try {
      // Shrink first: this is also what we preview, so a 12 MP camera JPEG is
      // never decoded at full size (that is what used to kill the app).
      const { base64, preview } = await prepareScanImage(file);
      setPreviewUrl((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(preview); });
      setStage('scanning');
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

  /** Android goes through the camera plugin, which owns the permission and
   *  survives the activity being recycled behind the camera app. The web
   *  keeps the file input. */
  const openCamera = async (source: 'camera' | 'gallery') => {
    if (!nativePhotoCapture()) {
      (source === 'camera' ? fileRef : galleryRef).current?.click();
      return;
    }
    try {
      const blob = await capturePhoto(source, 'food-scan', { date: targetDate, meal: target });
      await runScan(blob);
    } catch (err) {
      if (err instanceof PhotoCancelled) return;
      setError(err instanceof Error ? err.message : 'The camera could not be opened.');
    }
  };

  // A plate photographed just before Android recycled the app arrives here
  // on the way back in (src/captureRestore.ts) — scan it as if the camera
  // had returned normally.
  useEffect(() => {
    const restoredPhoto = consumeRestoredPhoto('food-scan');
    if (!restoredPhoto) return;
    // Deferred a tick so the screen paints before the scan flips it to "preparing".
    const t = window.setTimeout(() => { void runScan(restoredPhoto.blob); }, 0);
    return () => window.clearTimeout(t);
  }, [runScan]);

  const reset = () => {
    setPreviewUrl((old) => { if (old) URL.revokeObjectURL(old); return null; });
    setRows([]);
    setNote('');
    setError(null);
    setStage('capture');
  };

  /**
   * A dish the model named that nobody has in the library yet becomes a real
   * food, so the next time it is one search away instead of another scan.
   * Only when it does not already exist — by name, across your foods and the
   * community's — and never for an item already matched to one.
   */
  const learnNewFoods = (): FoodEntry[] => {
    const out: FoodEntry[] = [];
    for (const { item } of rows) {
      if (item.foodId) continue;
      const existing = findFoodByName(item.name);
      if (existing) {
        // Log it against the food we already know rather than a scan: id.
        out.push(scanItemToEntry({ ...item, foodId: existing.id, source: existing.source }, target));
        continue;
      }
      if (!user || item.grams <= 0) { out.push(scanItemToEntry(item, target)); continue; }
      const per100 = (n: number) => Math.round((n / item.grams) * 100 * 10) / 10;
      const food: FoodItem = {
        id: `user:${crypto.randomUUID()}`,
        source: 'user',
        name: item.name,
        per100g: {
          kcal: Math.round(per100(item.kcal)),
          protein: per100(item.protein),
          carbs: per100(item.carbs),
          fat: per100(item.fat),
        },
        units: [{ label: 'serving', grams: Math.round(item.grams) }],
        approx: true,
        createdBy: user.uid,
        createdByName: user.displayName ?? undefined,
        createdAt: new Date().toISOString(),
      };
      saveCustomFood(food);
      publishSharedFood(food);
      out.push(scanItemToEntry({ ...item, foodId: food.id, source: 'user' }, target));
    }
    return out;
  };

  const addAll = () => {
    if (rows.length === 0) return;
    const day = getNutritionDay(targetDate);
    const entries = learnNewFoods();
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

          {(previewUrl || stage === 'preparing') && (
            <div className="relative w-full h-64 rounded-2xl border border-border overflow-hidden bg-surface-2">
              {previewUrl
                ? <img src={previewUrl} alt="Your plate" className="w-full h-full object-cover" />
                : <div className="w-full h-full animate-pulse bg-surface-2" />}
              {(stage === 'preparing' || stage === 'scanning') && <ScanOverlay stage={stage} />}
            </div>
          )}

          {error && (
            <Card tone="danger">
              <p className="text-sm text-danger">{error}</p>
            </Card>
          )}

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
                  <Button variant="primary" size="lg" icon={Camera} full onClick={() => { void openCamera('camera'); }}>
                    Take a photo
                  </Button>
                  <Button variant="secondary" size="md" icon={ImagePlus} full onClick={() => { void openCamera('gallery'); }}>
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
                    onEdit={() => setEditing(i)}
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

      {editing !== null && rows[editing] && (
        <ScanItemSheet
          item={rows[editing].item}
          onClose={() => setEditing(null)}
          onSave={(next) => {
            setRows((prev) => prev.map((r, j) => (j === editing ? { base: next, item: next } : r)));
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

/**
 * What the wait looks like: the photo behind a scrim, a sweeping scan line,
 * a progress bar that eases towards 95 % over the typical scan time, and the
 * rotating status. The old version was a text card with no photo and no sense
 * of progress, which is why a slow scan felt like a hang.
 */
function ScanOverlay({ stage }: { stage: 'preparing' | 'scanning' }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const t = setInterval(() => setElapsed(Date.now() - started), 200);
    return () => clearInterval(t);
  }, [stage]);

  const pct = stage === 'preparing'
    ? Math.min(15, Math.round((elapsed / 1500) * 15))
    : 15 + Math.round(80 * (1 - Math.exp(-elapsed / TYPICAL_SCAN_MS)));
  const line = stage === 'preparing'
    ? 'Getting the photo ready…'
    : SCANNING_LINES[Math.min(SCANNING_LINES.length - 1, Math.floor(elapsed / 2500))];

  // Colours are inline on purpose. This sits over an arbitrary photo in a
  // WebView, and the status line has to be readable whatever is behind it and
  // whatever the theme does — it was reported as invisible on a device.
  return (
    <div className="absolute inset-0 flex flex-col justify-end" role="status" aria-live="polite">
      <span className="absolute inset-0 bg-black/45" aria-hidden="true" />
      {stage === 'scanning' && (
        <span className="absolute inset-x-0 top-0 h-10 bg-gradient-to-b from-accent/30 to-transparent animate-scanSweep" aria-hidden="true" />
      )}
      <div
        className="relative m-3 rounded-card px-3.5 py-3 space-y-2"
        style={{ backgroundColor: 'rgba(9,9,11,0.88)', border: '1px solid rgba(255,255,255,0.12)' }}
      >
        <p className="text-sm font-semibold" style={{ color: '#ffffff' }}>{line}</p>
        <div className="h-1.5 rounded-sm overflow-hidden" style={{ backgroundColor: 'rgba(255,255,255,0.22)' }}>
          <div className="h-full bg-accent transition-[width] duration-300 ease-out" style={{ width: `${pct}%` }} />
        </div>
        <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.75)' }}>
          {elapsed > 20_000 ? 'Still going — a busy model can take a while.' : 'Usually about ten seconds.'}
        </p>
      </div>
    </div>
  );
}

function ScanRow({ item, onGrams, onEdit, onRemove }: {
  item: ScanItem; onGrams: (grams: number) => void; onEdit: () => void; onRemove: () => void;
}) {
  return (
    <Card>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-bold text-text truncate">{item.name}</p>
          <p className="text-[13px] text-muted">
            {item.kcal} kcal · P{item.protein} C{item.carbs} F{item.fat} g
            {item.foodId ? ' · from the database' : item.confidence < 0.5 ? ' · low confidence' : ''}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <IconButton icon={Pencil} label={`Edit ${item.name}`} size="sm" onClick={onEdit} />
          <IconButton icon={Trash2} label={`Remove ${item.name}`} size="sm" onClick={onRemove} />
        </div>
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
