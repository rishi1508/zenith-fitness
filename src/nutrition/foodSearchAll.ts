import type { FoodItem } from '../types';
import { getCustomFoods } from '../health/store';
import { searchFoods } from './foodDb';
import type { FoodIndexEntry, SearchOptions } from './foodDb';
import { getSharedFoods } from './sharedFoodCache';

/**
 * One search across everything a user could reasonably mean: the foods they
 * created, the foods anyone in Zenith published, and the static index (IFCT,
 * USDA, curated dishes, Open Food Facts).
 *
 * Every screen that offers a food picker should go through here. When only
 * the static index was searched, a member's own creation was unfindable
 * anywhere except the device that made it.
 */

export interface FoodRow extends FoodIndexEntry {
  /** Present for foods that live as whole items already (own + community). */
  item?: FoodItem;
  /** Someone else in Zenith created this one. */
  community?: boolean;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** Same loose match the diary list uses: any word of the query, anywhere. */
function matchesItem(food: FoodItem, q: string): boolean {
  if (!q) return true;
  const hay = `${food.name} ${food.brand ?? ''}`.toLowerCase();
  return norm(q).split(' ').every((t) => hay.includes(t));
}

function toRow(food: FoodItem, community: boolean): FoodRow {
  return {
    id: food.id,
    name: food.name,
    aliases: [],
    group: community ? 'community' : 'yours',
    source: food.source,
    kcal100: food.per100g.kcal,
    approx: !!food.approx,
    item: food,
    community,
  };
}

/**
 * Own foods first, then the community's, then the index — a food you made is
 * almost always the one you meant.
 */
export function searchAllFoods(queryText: string, opts: SearchOptions & { uid?: string } = {}): FoodRow[] {
  const q = queryText.trim();
  const mine = getCustomFoods().filter((f) => matchesItem(f, q));
  const seen = new Set(mine.map((f) => f.id));

  const community = getSharedFoods().filter((f) => {
    if (seen.has(f.id)) return false;
    // A food the viewer created is "mine" even when it arrives from the
    // shared library — it just means their own copy went missing.
    return matchesItem(f, q);
  });
  for (const f of community) seen.add(f.id);

  const indexed = q ? searchFoods(q, opts).filter((f) => !seen.has(f.id)) : [];

  return [
    ...mine.map((f) => toRow(f, false)),
    ...community.map((f) => toRow(f, opts.uid != null && f.createdBy === opts.uid ? false : true)),
    ...indexed,
  ];
}

/** An existing food with this name, from anywhere we can see. Used to avoid
 *  creating a second "Poha" every time a plate is scanned. */
export function findFoodByName(name: string): FoodItem | null {
  const key = norm(name);
  if (!key) return null;
  return getCustomFoods().find((f) => norm(f.name) === key)
    ?? getSharedFoods().find((f) => norm(f.name) === key)
    ?? null;
}
