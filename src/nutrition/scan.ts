import type { FoodEntry, FoodSource, Macros, MealSlot } from '../types';

/**
 * Camera food scan client — talks to `api/foodscan.ts`
 * (docs/HEALTH_SPEC.md §6). The photo is downscaled here, on a canvas,
 * before it leaves the device: a 12 MP camera JPEG is ~4 MB, the route
 * accepts 700 KB of base64, and the model sees no more detail at 1024 px
 * anyway.
 *
 * Mirrors the typed-error shape and endpoint derivation of
 * `src/zen/client.ts` — everything security- and quota-relevant happens
 * server-side.
 */

export type ScanErrorKind = 'auth' | 'quota' | 'busy' | 'network' | 'image' | 'unknown';

export class ScanError extends Error {
  kind: ScanErrorKind;
  retryAfterSec?: number;
  constructor(kind: ScanErrorKind, message: string, opts?: { retryAfterSec?: number }) {
    super(message);
    this.name = 'ScanError';
    this.kind = kind;
    this.retryAfterSec = opts?.retryAfterSec;
  }
}

/** One food the model saw, with the macros for its estimated portion. */
export interface ScanItem {
  name: string;
  grams: number;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  confidence: number;
  /** Set when the user replaced the model's guess with a database food:
   *  the entry then links to that food and scales from its real per-100 g
   *  figures instead of the model's estimate. */
  foodId?: string;
  source?: FoodSource;
  per100g?: Macros;
}

export interface ScanResult {
  items: ScanItem[];
  /** The household portions the model assumed ("2 rotis, 1 katori dal"). */
  note: string;
  model?: string;
  /** Scans this user has left today, from the server's own counter. */
  remainingToday?: number;
}

export interface CaptureAndScanOptions {
  /** Firebase ID token for the signed-in user. */
  idToken: string;
  /** Free-text hint the user typed before scanning. */
  hint?: string;
  /** Meal the results are destined for — sent as part of the hint context. */
  meal?: MealSlot;
  /** Overrides the derived endpoint (mainly for tests). */
  endpoint?: string;
}

export const MAX_IMAGE_PX = 1024;
const JPEG_QUALITIES = [0.8, 0.6, 0.45];
const MAX_IMAGE_B64_BYTES = 700 * 1024;

/** `VITE_FOODSCAN_ENDPOINT` if set, else derived from `VITE_PUSH_ENDPOINT`
 *  (same Vercel project), else the same-origin default. */
function resolveEndpoint(): string {
  const explicit = import.meta.env.VITE_FOODSCAN_ENDPOINT as string | undefined;
  if (explicit) return explicit;
  const push = import.meta.env.VITE_PUSH_ENDPOINT as string | undefined;
  if (push) return push.replace(/\/api\/push\/?$/, '/api/foodscan');
  return '/api/foodscan';
}

/** Milliseconds before we give up on the route. The function itself caps at
 *  60 s; without a client deadline a stalled connection left the UI spinning
 *  on "Analysing your plate…" forever. */
const SCAN_TIMEOUT_MS = 75_000;

function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new ScanError('image', "That photo couldn't be read. Try again.")); };
    img.src = url;
  });
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(new ScanError('image', "That photo couldn't be read. Try again."));
    reader.readAsDataURL(blob);
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    try { canvas.toBlob((b) => resolve(b), 'image/jpeg', quality); }
    catch { resolve(null); }
  });
}

/**
 * Draws the photo into a canvas no larger than `maxPx` on the long edge.
 *
 * Phone cameras hand us 12 MP JPEGs. Decoding one at full size costs ~50 MB
 * of bitmap, and doing that inside an Android WebView — while the original
 * File and a preview <img> are also live — is what made the scan kill the
 * app. `createImageBitmap` with resize options decodes straight to the target
 * size, so the full-size bitmap never exists; the <img> path is the fallback
 * for browsers without it.
 */
async function drawDownscaled(blob: Blob, maxPx: number): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  const draw = (w: number, h: number, src: CanvasImageSource) => {
    canvas.width = Math.max(1, Math.round(w));
    canvas.height = Math.max(1, Math.round(h));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new ScanError('image', "This device couldn't process the photo.");
    ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
  };

  if (typeof createImageBitmap === 'function') {
    try {
      const probe = await createImageBitmap(blob);
      const scale = Math.min(1, maxPx / Math.max(probe.width, probe.height));
      const w = probe.width * scale;
      const h = probe.height * scale;
      probe.close?.();
      const bitmap = await createImageBitmap(blob, {
        resizeWidth: Math.max(1, Math.round(w)),
        resizeHeight: Math.max(1, Math.round(h)),
        resizeQuality: 'medium',
      });
      draw(bitmap.width, bitmap.height, bitmap);
      bitmap.close?.();
      return canvas;
    } catch {
      // Fall through to the <img> path (some WebViews reject resize options).
    }
  }

  const img = await loadImage(blob);
  const scale = Math.min(1, maxPx / Math.max(img.naturalWidth, img.naturalHeight));
  draw(img.naturalWidth * scale, img.naturalHeight * scale, img);
  return canvas;
}

/**
 * Downscales to `MAX_IMAGE_PX` on the long edge and encodes JPEG, dropping
 * quality until the base64 fits the route's 700 KB cap. Returns the encoded
 * bytes AND the compressed blob, so the caller can preview the small copy
 * instead of decoding the original a second time.
 */
export async function prepareScanImage(
  blob: Blob,
  maxPx = MAX_IMAGE_PX,
): Promise<{ base64: string; preview: Blob }> {
  const canvas = await drawDownscaled(blob, maxPx);
  let last: { base64: string; preview: Blob } | null = null;
  for (const quality of JPEG_QUALITIES) {
    const out = await canvasToBlob(canvas, quality);
    if (!out) break;
    const base64 = await blobToBase64(out);
    last = { base64, preview: out };
    if (base64.length <= MAX_IMAGE_B64_BYTES) return last;
  }
  if (!last) throw new ScanError('image', "This device couldn't process the photo.");
  throw new ScanError('image', 'That photo is too large. Try a closer shot.');
}

/** Back-compat wrapper — the base64 alone. */
export async function downscaleToJpegBase64(blob: Blob, maxPx = MAX_IMAGE_PX): Promise<string> {
  return (await prepareScanImage(blob, maxPx)).base64;
}

interface ScanApiResponse {
  items?: ScanItem[];
  note?: string;
  model?: string;
  remainingToday?: number;
  error?: string;
  reason?: string;
  retryAfterSec?: number;
}

async function post(url: string, body: Record<string, unknown>): Promise<ScanApiResponse> {
  let res: Response;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SCAN_TIMEOUT_MS);
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') {
      throw new ScanError('busy', 'The scan took too long. Try again in a moment.');
    }
    throw new ScanError('network', 'Could not reach the scanner. Check your connection and try again.');
  } finally {
    clearTimeout(timer);
  }
  const data = (await res.json().catch(() => ({}))) as ScanApiResponse;
  if (!res.ok) {
    const message = data.error || 'The scan ran into a problem. Please try again.';
    if (res.status === 401 || res.status === 403) throw new ScanError('auth', message);
    if (res.status === 400) throw new ScanError('image', message);
    if (res.status === 429) throw new ScanError(data.reason === 'quota' ? 'quota' : 'busy', message, { retryAfterSec: data.retryAfterSec });
    if (res.status >= 500) throw new ScanError('busy', message);
    throw new ScanError('unknown', message);
  }
  return data;
}

/** Upload an already-prepared image. Never throws raw fetch errors. */
export async function scanPreparedImage(image: string, opts: CaptureAndScanOptions): Promise<ScanResult> {
  const hint = [opts.hint?.trim(), opts.meal ? `This is ${opts.meal}.` : ''].filter(Boolean).join(' ');
  const data = await post(opts.endpoint || resolveEndpoint(), {
    idToken: opts.idToken,
    image,
    mime: 'image/jpeg',
    ...(hint ? { hint } : {}),
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
  return {
    items: Array.isArray(data.items) ? data.items : [],
    note: data.note || '',
    model: data.model,
    remainingToday: data.remainingToday,
  };
}

// ----- mapping to diary entries -------------------------------------------

/** Downscale, upload, and return what the model saw. */
export async function captureAndScan(file: Blob, opts: CaptureAndScanOptions): Promise<ScanResult> {
  const { base64 } = await prepareScanImage(file);
  return scanPreparedImage(base64, opts);
}

/** "Dal Tadka (home)" → "dal-tadka-home". */
export function slugifyFood(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'item';
}

/** Re-estimates an item's macros for a corrected weight (the user's stepper). */
export function scaleScanItem(item: ScanItem, grams: number): ScanItem {
  const next = Math.max(1, Math.round(grams));
  // A matched database food has real per-100 g figures — use them rather
  // than scaling the model's estimate.
  if (item.per100g) {
    const f = next / 100;
    const r1 = (n: number) => Math.round(n * f * 10) / 10;
    return {
      ...item,
      grams: next,
      kcal: Math.round(item.per100g.kcal * f),
      protein: r1(item.per100g.protein),
      carbs: r1(item.per100g.carbs),
      fat: r1(item.per100g.fat),
    };
  }
  if (item.grams <= 0) return { ...item, grams: next };
  const f = next / item.grams;
  const r1 = (n: number) => Math.round(n * f * 10) / 10;
  return {
    ...item,
    grams: next,
    kcal: Math.round(item.kcal * f),
    protein: r1(item.protein),
    carbs: r1(item.carbs),
    fat: r1(item.fat),
  };
}

/**
 * A scanned item as a diary entry. The model's own guesses are estimates,
 * so they stay `approx` behind a `scan:` food id — there is no database row
 * to open. An item the user matched to a real food keeps that food's id and
 * source instead.
 */
export function scanItemToEntry(item: ScanItem, meal: MealSlot, at: Date = new Date()): FoodEntry {
  return {
    id: crypto.randomUUID(),
    foodId: item.foodId ?? `scan:${slugifyFood(item.name)}`,
    name: item.name,
    source: item.source ?? 'dish',
    meal,
    qty: item.grams,
    unit: 'g',
    grams: item.grams,
    macros: { kcal: item.kcal, protein: item.protein, carbs: item.carbs, fat: item.fat },
    at: at.toISOString(),
    approx: !item.foodId,
  };
}
