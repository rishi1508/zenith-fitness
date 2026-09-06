// Household measures for food logging — docs/HEALTH_SPEC.md §2.
//
// Grams is always implicit (the UI always offers "g"), so this table only
// holds the *household* measures a food can be logged in. `scripts/build-food-db.mjs`
// imports this module (via esbuild) so the shipped shards and the app agree
// on every gram figure.
//
// Volumes are treated 1 ml = 1 g. That is exact for water, ~3 % low for milk
// and ~10 % low for oil; these are eyeballed portions anyway.

import type { FoodUnit } from '../types';

/** Canonical gram weight of each household measure. */
export const MEASURES = {
  katori: 150,
  'small katori': 100,
  cup: 240,
  glass: 250,
  plate: 300,
  bowl: 200,
  tbsp: 15,
  tsp: 5,
  handful: 25,
  roti: 40,
  paratha: 80,
  idli: 40,
  dosa: 90,
  slice: 25,
  egg: 50,
  piece: 100,
} as const;

export type MeasureLabel = keyof typeof MEASURES;

/** Coarse food class that decides which measures are offered. */
export type UnitGroup =
  | 'cereals' | 'legumes' | 'vegetables' | 'roots' | 'fruits' | 'nuts' | 'oils'
  | 'dairy' | 'cheese' | 'eggs' | 'meat' | 'fish' | 'spices' | 'sugars' | 'beverages'
  | 'bread' | 'sweets' | 'snacks' | 'dish' | 'other';

const U = (label: MeasureLabel, grams: number = MEASURES[label]): FoodUnit => ({ label, grams });

/** Measures offered per class. A `piece` entry is re-weighed per food by `pieceGramsFor`. */
export const GROUP_UNITS: Record<UnitGroup, FoodUnit[]> = {
  cereals: [U('katori'), U('small katori'), U('cup'), U('tbsp')],
  legumes: [U('katori'), U('small katori'), U('cup'), U('tbsp')],
  vegetables: [U('katori'), U('small katori'), U('cup'), U('piece')],
  roots: [U('katori'), U('small katori'), U('piece')],
  fruits: [U('piece'), U('katori'), U('cup')],
  nuts: [U('tbsp'), U('handful'), U('piece')],
  oils: [U('tbsp'), U('tsp')],
  dairy: [U('glass'), U('cup'), U('katori'), U('tbsp')],
  cheese: [U('slice', 20), U('piece', 30), U('tbsp')],
  eggs: [U('egg'), U('piece', MEASURES.egg)],
  meat: [U('piece'), U('katori'), U('plate')],
  fish: [U('piece'), U('katori'), U('plate')],
  spices: [U('tsp'), U('tbsp')],
  sugars: [U('tsp'), U('tbsp'), U('cup')],
  beverages: [U('glass'), U('cup')],
  bread: [U('slice'), U('piece', 40)],
  sweets: [U('piece', 40), U('katori')],
  snacks: [U('piece', 30), U('katori'), U('plate')],
  dish: [U('katori'), U('small katori'), U('plate')],
  other: [U('katori'), U('cup'), U('tbsp')],
};

/** Source group string (IFCT `grup`, USDA category, dish group) → unit class. */
const GROUP_MAP: Record<string, UnitGroup> = {
  // IFCT 2017
  'cereals and millets': 'cereals',
  'grain legumes': 'legumes',
  'green leafy vegetables': 'vegetables',
  'other vegetables': 'vegetables',
  mushrooms: 'vegetables',
  'roots and tubers': 'roots',
  fruits: 'fruits',
  'nuts and oil seeds': 'nuts',
  'edible oils and fats': 'oils',
  'milk and milk products': 'dairy',
  'egg and egg products': 'eggs',
  poultry: 'meat',
  'animal meat': 'meat',
  'marine fish': 'fish',
  'fresh water fish and shellfish': 'fish',
  'marine shellfish': 'fish',
  'marine mollusks': 'fish',
  'condiments and spices': 'spices',
  sugars: 'sugars',
  'miscellaneous foods': 'other',
  // USDA FoodData Central categories
  'dairy and egg products': 'dairy',
  'spices and herbs': 'spices',
  'fats and oils': 'oils',
  'poultry products': 'meat',
  'beef products': 'meat',
  'pork products': 'meat',
  'lamb, veal, and game products': 'meat',
  'sausages and luncheon meats': 'meat',
  'fruits and fruit juices': 'fruits',
  'vegetables and vegetable products': 'vegetables',
  'nut and seed products': 'nuts',
  'finfish and shellfish products': 'fish',
  'legumes and legume products': 'legumes',
  'cereal grains and pasta': 'cereals',
  'baked products': 'bread',
  sweets: 'sweets',
  beverages: 'beverages',
  snacks: 'snacks',
};

/** Per-food gram weight of one "piece" — overrides the class default. First match wins. */
const PIECE_GRAMS: [RegExp, number][] = [
  [/^egg,? .*white/i, 33],
  [/^egg,? .*yolk/i, 17],
  [/^eggs?\b/i, 50],
  [/\bbread\b/i, 25],
  [/\bchapati|\broti\b|phulka/i, 40],
  [/\bparatha/i, 80],
  [/\bidli/i, 40],
  [/\bdosa/i, 90],
  [/\bpaneer/i, 30],
  [/\bsamosa/i, 60],
  [/\bbanana/i, 120],
  [/\bapple/i, 180],
  [/\borange|\bsantra|mosambi/i, 130],
  [/\bmango/i, 200],
  [/\bguava|amrud/i, 150],
  [/\bsapota|chikoo/i, 80],
  [/\bpear\b/i, 170],
  [/\bpeach|\bplum\b|\bapricot/i, 60],
  [/\bkiwi/i, 75],
  [/\bpomegranate|anar/i, 280],
  [/\bgrapes?\b/i, 5],
  [/\bdates?,|\bkhajur/i, 8],
  [/\bfig\b|anjeer/i, 8],
  [/\bstrawberr/i, 12],
  [/\bwatermelon|muskmelon/i, 200],
  [/\bpapaya/i, 150],
  [/\bpineapple/i, 100],
  [/\blemon|lime\b|nimbu/i, 50],
  [/\bcoconut, tender|tender coconut/i, 200],
  [/\btomato/i, 100],
  [/\bonion/i, 100],
  [/\bpotato/i, 100],
  [/\bcarrot/i, 60],
  [/\bcucumber|kheera/i, 150],
  [/\bcapsicum|bell pepper/i, 90],
  [/\bbrinjal|eggplant|aubergine/i, 100],
  [/\bokra|bhindi|ladies? finger/i, 10],
  [/\bgreen chilli|chilli,? green/i, 5],
  [/\balmond|badam/i, 1.2],
  [/\bcashew|kaju/i, 1.6],
  [/\bwalnut|akhrot/i, 4],
  [/\bpistachio|pista/i, 0.8],
  [/\braisin|kishmish/i, 0.5],
  [/\bpeanut|groundnut/i, 0.8],
  [/\bchicken, .*breast/i, 150],
  [/\bchicken, .*(leg|thigh|drumstick)/i, 100],
  [/\bchicken, .*wing/i, 45],
];

/** Grams in one "piece" of this food, or null when nothing specific is known. */
export function pieceGramsFor(name: string): number | null {
  for (const [re, grams] of PIECE_GRAMS) if (re.test(name)) return grams;
  return null;
}

/** Foods whose name places them in a different class than their source group
 *  (eggs and cheese both sit in USDA "Dairy and Egg Products", for instance). */
const NAME_GROUP: [RegExp, UnitGroup][] = [
  [/^eggs?\b|^egg,/i, 'eggs'],
  [/paneer|^cheese\b|\bcheese,/i, 'cheese'],
  [/^bread\b|chapati|\broti\b|paratha|\bnaan\b|\bkulcha\b/i, 'bread'],
];

/** Map a raw source group string onto a unit class. */
export function unitGroupFor(group?: string): UnitGroup {
  if (!group) return 'other';
  const key = group.trim().toLowerCase();
  const hit = GROUP_MAP[key];
  if (hit) return hit;
  if (/dal|curry|sabzi|rice|bread|breakfast|snack|chaat|sweet|drink|beverage|dish/.test(key)) return 'dish';
  return 'other';
}

/** Household measures for one food. Grams is implicit and never included here. */
export function unitsForFood(name: string, group?: string): FoodUnit[] {
  const override = NAME_GROUP.find(([re]) => re.test(name));
  const cls = override ? override[1] : unitGroupFor(group);
  const piece = pieceGramsFor(name);
  const out: FoodUnit[] = [];
  for (const u of GROUP_UNITS[cls]) {
    if (u.label === 'piece' || u.label === 'egg') {
      const grams = piece ?? u.grams;
      if (piece == null && (cls === 'fruits' || cls === 'vegetables' || cls === 'roots' || cls === 'nuts')) continue;
      out.push({ label: u.label, grams });
    } else {
      out.push({ ...u });
    }
  }
  return out;
}
