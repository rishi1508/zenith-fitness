// Pure prompt + parsing helpers for api/foodscan.ts (docs/HEALTH_SPEC.md
// §6). No I/O and no env, so the JSON repair and the clamping can be
// unit-tested — the model's output is the least trustworthy input in the
// whole app, and this is the only thing standing between it and the
// user's food diary.

export interface ScanItem {
  name: string;
  grams: number;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  /** The model's own confidence, 0–1. */
  confidence: number;
}

export interface ScanPayload {
  items: ScanItem[];
  note: string;
}

export const MAX_ITEMS = 12;
export const MAX_NOTE_CHARS = 300;

/** Asks for exactly the JSON the client can consume — nothing else. */
export const SCAN_PROMPT = [
  'You are a nutritionist estimating what is on this plate for an Indian user logging food.',
  'Identify every distinct food in the photo. Use the common Indian name where one exists',
  '(dal tadka, aloo sabzi, roti, idli, poha, rajma chawal, paneer butter masala…).',
  'Estimate the cooked weight of each item in grams from the visual portion size — be realistic:',
  'one roti ≈ 40 g, one katori of dal ≈ 150 g, one idli ≈ 40 g, one plate of rice ≈ 200 g.',
  'Then give kcal and macros for that estimated weight (not per 100 g).',
  '',
  'Reply with ONLY this JSON object, no prose and no code fence:',
  '{"items":[{"name":"","grams":0,"kcal":0,"protein":0,"carbs":0,"fat":0,"confidence":0}],"note":""}',
  '',
  'Rules: grams/kcal are numbers, protein/carbs/fat are grams, confidence is 0–1.',
  'Put the portions you assumed in household units in "note" (e.g. "2 rotis, 1 katori dal, ~1 cup rice").',
  'If the photo is not food, return {"items":[],"note":"No food detected"}.',
].join('\n');

/**
 * Best-effort repair of a model's "JSON": drops code fences and any prose
 * around the object, and removes trailing commas. Returns the candidate
 * JSON text (which may still be invalid — the caller parses).
 */
export function repairJson(raw: string): string {
  let s = raw.trim();
  // ```json … ``` (or any fenced block) → its contents.
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  // A bare array of items is a common miss — wrap it.
  const firstBrace = s.indexOf('{');
  const firstBracket = s.indexOf('[');
  if (firstBracket >= 0 && (firstBrace < 0 || firstBracket < firstBrace)) {
    const endArr = s.lastIndexOf(']');
    if (endArr > firstBracket) s = `{"items":${s.slice(firstBracket, endArr + 1)},"note":""}`;
  } else if (firstBrace >= 0) {
    const endObj = s.lastIndexOf('}');
    if (endObj > firstBrace) s = s.slice(firstBrace, endObj + 1);
  }
  // Trailing commas before a closing brace/bracket.
  return s.replace(/,\s*([}\]])/g, '$1');
}

function toNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    // "≈ 150 g" / "150g" → 150
    const m = v.replace(',', '').match(/-?\d+(\.\d+)?/);
    if (m) return Number(m[0]);
  }
  return NaN;
}

function clampNum(v: unknown, min: number, max: number, dflt: number, decimals = 0): number {
  const n = toNumber(v);
  if (!Number.isFinite(n)) return dflt;
  const clamped = Math.min(max, Math.max(min, n));
  const f = 10 ** decimals;
  return Math.round(clamped * f) / f;
}

/** One item, bounded to values a human plate can actually hold. */
export function clampItem(raw: unknown): ScanItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const name = typeof o.name === 'string' ? o.name.trim().replace(/\s+/g, ' ').slice(0, 60) : '';
  if (!name) return null;
  return {
    name,
    grams: clampNum(o.grams, 1, 2000, 100),
    kcal: clampNum(o.kcal, 0, 5000, 0),
    protein: clampNum(o.protein, 0, 500, 0, 1),
    carbs: clampNum(o.carbs, 0, 500, 0, 1),
    fat: clampNum(o.fat, 0, 500, 0, 1),
    confidence: clampNum(o.confidence, 0, 1, 0.5, 2),
  };
}

/**
 * Parses a model reply into a payload the client can trust, or null when
 * there is no usable JSON in it at all.
 */
export function parseScanPayload(raw: string): ScanPayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(repairJson(raw));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const o = parsed as Record<string, unknown>;
  const rawItems = Array.isArray(o.items) ? o.items : [];
  const items: ScanItem[] = [];
  for (const r of rawItems) {
    const item = clampItem(r);
    if (item) items.push(item);
    if (items.length >= MAX_ITEMS) break;
  }
  const note = typeof o.note === 'string' ? o.note.trim().slice(0, MAX_NOTE_CHARS) : '';
  return { items, note };
}
