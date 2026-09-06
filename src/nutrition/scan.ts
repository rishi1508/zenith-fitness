import type { FoodEntry, MealSlot } from '../types';

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

function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new ScanError('image', "That photo couldn't be read. Try again.")); };
    img.src = url;
  });
}

/**
 * Downscales to `MAX_IMAGE_PX` on the long edge and encodes JPEG, dropping
 * quality until the base64 fits the route's 700 KB cap.
 */
export async function downscaleToJpegBase64(blob: Blob, maxPx = MAX_IMAGE_PX): Promise<string> {
  const img = await loadImage(blob);
  const scale = Math.min(1, maxPx / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new ScanError('image', "This device couldn't process the photo.");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  let base64 = '';
  for (const quality of JPEG_QUALITIES) {
    base64 = canvas.toDataURL('image/jpeg', quality).split(',')[1] ?? '';
    if (base64.length <= MAX_IMAGE_B64_BYTES) return base64;
  }
  if (!base64) throw new ScanError('image', "This device couldn't process the photo.");
  throw new ScanError('image', 'That photo is too large. Try a closer shot.');
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
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ScanError('network', 'Could not reach the scanner. Check your connection and try again.');
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

/** Downscale, upload, and return what the model saw. Never throws raw fetch errors. */
export async function captureAndScan(file: Blob, opts: CaptureAndScanOptions): Promise<ScanResult> {
  const image = await downscaleToJpegBase64(file);
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
 * A scanned item as a diary entry. Everything from a scan is an estimate,
 * so it is always `approx` and carries a `scan:` food id — there is no
 * database row behind it to open.
 */
export function scanItemToEntry(item: ScanItem, meal: MealSlot, at: Date = new Date()): FoodEntry {
  return {
    id: crypto.randomUUID(),
    foodId: `scan:${slugifyFood(item.name)}`,
    name: item.name,
    source: 'dish',
    meal,
    qty: item.grams,
    unit: 'g',
    grams: item.grams,
    macros: { kcal: item.kcal, protein: item.protein, carbs: item.carbs, fat: item.fat },
    at: at.toISOString(),
    approx: true,
  };
}
