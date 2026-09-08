#!/usr/bin/env node
// Builds the offline food database shipped in public/data/foods/ — docs/HEALTH_SPEC.md §2.
//
//   node scripts/build-food-db.mjs
//
// Inputs (downloaded into data/raw/, which is gitignored; re-runs reuse them):
//   - @ifct2017/compositions@2.0.9 + @ifct2017/columns@2.0.13  (MIT; 2.1+ is AGPL — do not bump)
//   - USDA FoodData Central Foundation Foods + SR Legacy CSV exports (public domain)
//   - data/dishes.in.json — our curated Indian dishes (committed)
//
// Outputs (committed):
//   - public/data/foods/index.json   [[id, name, aliases, group, source, kcal100], ...]
//   - public/data/foods/ifct.json, dishes.json, usda-<a..z>.json  — full FoodItems
//
// The script is idempotent: same inputs → byte-identical outputs.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const RAW = join(ROOT, 'data', 'raw');
const OUT = join(ROOT, 'public', 'data', 'foods');

const IFCT_COMPOSITIONS = '@ifct2017/compositions@2.0.9';
const IFCT_COLUMNS = '@ifct2017/columns@2.0.13';
const USDA_FOUNDATION = 'https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_foundation_food_csv_2026-04-30.zip';
const USDA_SR_LEGACY = 'https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip';

const warnings = [];
const warn = (msg) => { warnings.push(msg); console.warn('  ! ' + msg); };

// ---------------------------------------------------------------- utilities

/** RFC-4180 CSV → rows of strings. */
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); field = ''; rows.push(row); row = []; }
    else if (c !== '\r') field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const num = (v) => { const n = Number.parseFloat(v); return Number.isFinite(n) ? n : 0; };
const r1 = (n) => Math.round(n * 10) / 10;
const r2 = (n) => Math.round(n * 100) / 100;

function slugify(s) {
  return s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** Load the TypeScript unit table so the shards and the app never drift. */
async function loadUnitTable() {
  const { transform } = await import('esbuild');
  const src = readFileSync(join(ROOT, 'src', 'nutrition', 'units.ts'), 'utf8');
  const { code } = await transform(src, { loader: 'ts', format: 'esm' });
  const tmp = join(RAW, '.units.mjs');
  writeFileSync(tmp, code);
  return import(pathToFileURL(tmp).href);
}

// ---------------------------------------------------------------- downloads

function ensureDir(p) { mkdirSync(p, { recursive: true }); }

function npmPack(spec) {
  const name = spec.replace('@ifct2017/', 'ifct2017-').replace('@', '-') + '.tgz';
  const tgz = join(RAW, name);
  const dir = join(RAW, spec.includes('compositions') ? 'ifct-compositions' : 'ifct-columns');
  if (existsSync(join(dir, 'index.csv'))) return dir;
  if (!existsSync(tgz)) {
    console.log(`  downloading ${spec}`);
    execFileSync('npm', ['pack', spec], { cwd: RAW, stdio: 'pipe' });
  }
  rmSync(join(RAW, 'package'), { recursive: true, force: true });
  execFileSync('tar', ['xzf', tgz], { cwd: RAW });
  rmSync(dir, { recursive: true, force: true });
  execFileSync('mv', [join(RAW, 'package'), dir]);
  return dir;
}

async function fetchZip(url, name) {
  const zip = join(RAW, name + '.zip');
  const dir = join(RAW, name);
  if (existsSync(dir)) return dir;
  if (!existsSync(zip)) {
    console.log(`  downloading ${url}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
  }
  execFileSync('unzip', ['-q', '-o', zip, '-d', dir]);
  return dir;
}

/** USDA zips wrap everything in one dated folder. */
function insideZipDir(dir) {
  const entries = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory());
  return entries.length === 1 ? join(dir, entries[0].name) : dir;
}

// ---------------------------------------------------------------- IFCT 2017

// `lang` reads "A. Moricha guti; H. Ramdana; Tam. Keerai vidai." — a
// language abbreviation, then the local name, usually ";"-separated but
// occasionally ",".
const IFCT_LANG_PREFIX = /^(?:[A-Z][a-z]{0,4}\.|[A-Z]\.)\s*/;
const IFCT_LANG_SPLIT = /;|,\s*(?=[A-Z][a-z]{0,4}\.\s)/;

function ifctAliases(lang) {
  const out = [];
  for (const part of (lang || '').split(IFCT_LANG_SPLIT)) {
    const alias = part.trim().replace(IFCT_LANG_PREFIX, '').replace(/^[^A-Za-z]+/, '').replace(/\.$/, '').trim();
    if (alias.length < 3 || alias.length > 28) continue;
    if (!out.some((a) => a.toLowerCase() === alias.toLowerCase())) out.push(alias);
    if (out.length === 12) break;
  }
  return out;
}

function buildIfct(dir, units) {
  const rows = parseCsv(readFileSync(join(dir, 'index.csv'), 'utf8'));
  // Header cells look like "Total Fat; fatce" — the code after ";" is the column id.
  const header = rows[0].map((h) => (h.includes(';') ? h.split(';').pop().trim() : h.trim()));
  const at = Object.fromEntries(header.map((h, i) => [h, i]));
  const foods = [];
  let derived = 0;
  for (const row of rows.slice(1)) {
    if (row.length < header.length - 2 || !row[at.code]) continue;
    const name = row[at.name].trim();
    const group = row[at.grup].trim();
    // IFCT proximates are g/100 g, minerals g/100 g, energy kJ/100 g.
    let kcal = num(row[at.enerc]) / 4.184;
    const protein = num(row[at.protcnt]);
    const carbs = num(row[at.choavldf]);
    const fat = num(row[at.fatce]);
    if (!kcal && !protein && !carbs && !fat) continue;
    // IFCT leaves energy blank for pure fats and has a handful of typos
    // (chicken leg reads 1605 kJ against 191 kcal of macros). Fall back to
    // Atwater in those cases; a ±60 % band leaves genuine outliers alone.
    const atwater = 4 * protein + 4 * carbs + 9 * fat;
    if (!kcal || (atwater > 50 && (kcal / atwater > 1.6 || kcal / atwater < 0.6))) { kcal = atwater; derived++; }
    foods.push({
      id: `ifct:${row[at.code]}`,
      name,
      aliases: ifctAliases(row[at.lang]),
      source: 'ifct',
      group,
      per100g: {
        kcal: r1(kcal),
        protein: r2(protein),
        carbs: r2(carbs),
        fat: r2(fat),
        fiber: r2(num(row[at.fibtg])),
        sugar: r2(num(row[at.fsugar])),
        sodium: Math.round(num(row[at.na]) * 1000),
      },
      units: units.unitsForFood(name, group),
    });
  }
  if (derived) console.log(`  ifct: derived kcal from macros for ${derived} foods (energy missing or inconsistent)`);
  return foods;
}

// ---------------------------------------------------- USDA FoodData Central

// Generic ingredient categories only, with a cap on each so one over-subdivided
// category (beef has 954 rows of trim/grade permutations) cannot swamp search.
const USDA_CATEGORY_CAPS = {
  'Dairy and Egg Products': 200,
  'Spices and Herbs': 65,
  'Fats and Oils': 90,
  'Poultry Products': 160,
  'Fruits and Fruit Juices': 260,
  'Pork Products': 140,
  'Vegetables and Vegetable Products': 420,
  'Nut and Seed Products': 130,
  'Beef Products': 200,
  'Finfish and Shellfish Products': 200,
  'Legumes and Legume Products': 200,
  'Lamb, Veal, and Game Products': 110,
  'Cereal Grains and Pasta': 170,
  'Baked Products': 60,
  Sweets: 40,
  Beverages: 40,
};

const USDA_DROP = /baby ?food|babyfood|infant|toddler|formula|supplement|meal replacement|restaurant|fast ?food|school lunch|commodity|imitation|meat extender|candies|puddings|frostings|alcoholic|cocktail|liqueur|beer\b|wine\b|discontinued|NFS|UPC|GTIN/i;
const ALLCAPS_OK = /^(?:USDA|II|III|IV|BBQ|TV|A|B|C|D|E|K|PDS|NS|RTE|OZ|LB|G|ML|KFC)$/;

function looksBranded(desc) {
  if (/[®™]|\bbrand\b/i.test(desc)) return true;
  for (const word of desc.split(/[\s,()/]+/)) {
    if (word.length >= 2 && /^[A-Z][A-Z'&.-]+$/.test(word) && !ALLCAPS_OK.test(word)) return true;
  }
  return false;
}

// Everyday staples must survive the per-category caps: "Chicken, broilers or
// fryers, breast, meat only, cooked, roasted" has six qualifier segments and
// would otherwise lose its slot to emu and ostrich cuts.
const USDA_STAPLE = /^(?:chicken|turkey|egg|milk|yogurt|cheese|butter|cream|rice|wheat|oats|bread|pasta|noodles|potato|sweet potato|onion|tomato|spinach|carrot|cauliflower|cabbage|peas|beans|lentils|chickpeas|mung|soy|tofu|banana|apple|mango|orange|grapes|papaya|guava|watermelon|almond|cashew|peanut|walnut|oil|ghee|sugar|honey|salmon|tuna|tilapia|sardine|shrimp|prawn|fish|beef|pork|lamb|goat|mutton|mushroom|corn|cucumber|pumpkin|okra|eggplant|coconut|dates|raisins|flour|semolina|millet|barley|quinoa|salt|pepper|chili|turmeric|cumin|coriander|ginger|garlic)\b/i;
// Rare game and exotic birds fill up SR Legacy's meat categories; they go last.
const USDA_EXOTIC = /^(?:emu|ostrich|dove|squab|pheasant|goose|guinea hen|alligator|beaver|bear|bison|buffalo|caribou|deer|elk|moose|muskrat|opossum|raccoon|seal|whale|walrus|antelope|armadillo|horse|rabbit|seaweed|snail|frog|turtle|cuttlefish|octopus)\b/i;

function usdaTier(desc) {
  if (USDA_EXOTIC.test(desc)) return 2;
  return USDA_STAPLE.test(desc) ? 0 : 1;
}

/** Segments that only distinguish near-identical rows — dropped from the dedupe key. */
const NOISE_SEGMENT = /^(?:all grades|choice|select|prime|with salt|without salt|unprepared|raw or unheated|drained solids|solids and liquids|includes .*|trimmed to .*|separable .*|Aust\. marble score .*)$/i;

function dedupeKey(desc) {
  return desc
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s && !NOISE_SEGMENT.test(s))
    .join(',')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function readUsdaFoods(dir, dataType, categories) {
  const rows = parseCsv(readFileSync(join(dir, 'food.csv'), 'utf8')).slice(1);
  const out = [];
  for (const r of rows) {
    if (r[1] !== dataType) continue;
    const category = categories.get(r[3]);
    if (!category || !(category in USDA_CATEGORY_CAPS)) continue;
    const desc = r[2].replace(/\s*\((?:Includes|includes) foods for[^)]*\)/g, '').trim();
    if (!desc || USDA_DROP.test(desc) || looksBranded(desc)) continue;
    out.push({ fdcId: r[0], desc, category });
  }
  return out;
}

/** food_nutrient.csv is up to 36 MB; only the first four columns are ever needed. */
function readNutrients(dir, wanted, nutrientIds) {
  const text = readFileSync(join(dir, 'food_nutrient.csv'), 'utf8');
  const out = new Map();
  let start = text.indexOf('\n') + 1;
  while (start < text.length) {
    let end = text.indexOf('\n', start);
    if (end === -1) end = text.length;
    const line = text.slice(start, end);
    start = end + 1;
    const m = /^"(\d*)","(\d+)","(\d+)","([^"]*)"/.exec(line);
    if (!m) continue;
    const [, , fdcId, nutrientId, amount] = m;
    if (!wanted.has(fdcId) || !nutrientIds.has(nutrientId)) continue;
    let rec = out.get(fdcId);
    if (!rec) out.set(fdcId, (rec = {}));
    rec[nutrientId] = Number.parseFloat(amount);
  }
  return out;
}

const NUTRIENT_IDS = new Set(['1008', '2048', '2047', '1003', '1004', '1005', '1050', '1079', '2000', '1063', '1093']);

function usdaMacros(n) {
  if (!n) return null;
  const protein = n['1003'];
  const fat = n['1004'];
  const carbs = n['1005'] ?? n['1050'];
  if (protein == null || fat == null || carbs == null) return null;
  const kcal = n['1008'] ?? n['2048'] ?? n['2047'] ?? (4 * protein + 4 * carbs + 9 * fat);
  const macros = { kcal: r1(kcal), protein: r2(protein), carbs: r2(carbs), fat: r2(fat) };
  const fiber = n['1079'];
  const sugar = n['2000'] ?? n['1063'];
  const sodium = n['1093'];
  if (fiber != null) macros.fiber = r2(fiber);
  if (sugar != null) macros.sugar = r2(sugar);
  if (sodium != null) macros.sodium = Math.round(sodium);
  return macros;
}

async function buildUsda(units) {
  const foundationDir = insideZipDir(await fetchZip(USDA_FOUNDATION, 'usda-foundation'));
  const legacyDir = insideZipDir(await fetchZip(USDA_SR_LEGACY, 'usda-sr-legacy'));

  const categories = new Map(
    parseCsv(readFileSync(join(foundationDir, 'food_category.csv'), 'utf8')).slice(1)
      .filter((r) => r[0]).map((r) => [r[0], r[2].trim()]),
  );

  // Foundation first — better sampling and newer data than SR Legacy.
  const candidates = [
    ...readUsdaFoods(foundationDir, 'foundation_food', categories).map((f) => ({ ...f, rank: 0, dir: foundationDir })),
    ...readUsdaFoods(legacyDir, 'sr_legacy_food', categories).map((f) => ({ ...f, rank: 1, dir: legacyDir })),
  ];
  // Staples first, then Foundation over SR Legacy, then the most generic
  // descriptions: fewest qualifier segments, then shortest.
  candidates.sort((a, b) =>
    usdaTier(a.desc) - usdaTier(b.desc)
    || a.rank - b.rank
    || a.desc.split(',').length - b.desc.split(',').length
    || a.desc.length - b.desc.length
    || a.fdcId.localeCompare(b.fdcId));

  const seen = new Set();
  const perCategory = new Map();
  const picked = [];
  for (const c of candidates) {
    const key = dedupeKey(c.desc);
    if (seen.has(key)) continue;
    const used = perCategory.get(c.category) || 0;
    if (used >= USDA_CATEGORY_CAPS[c.category]) continue;
    seen.add(key);
    perCategory.set(c.category, used + 1);
    picked.push(c);
  }

  const byDir = new Map();
  for (const p of picked) {
    if (!byDir.has(p.dir)) byDir.set(p.dir, new Set());
    byDir.get(p.dir).add(p.fdcId);
  }
  const nutrients = new Map();
  for (const [dir, ids] of byDir) for (const [k, v] of readNutrients(dir, ids, NUTRIENT_IDS)) nutrients.set(k, v);

  const foods = [];
  let dropped = 0;
  for (const p of picked) {
    const per100g = usdaMacros(nutrients.get(p.fdcId));
    if (!per100g) { dropped++; continue; }
    foods.push({
      id: `usda:${p.fdcId}`,
      name: p.desc,
      source: 'usda',
      group: p.category,
      per100g,
      units: units.unitsForFood(p.desc, p.category),
    });
  }
  if (dropped) console.log(`  usda: skipped ${dropped} foods with incomplete macros`);
  foods.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return foods;
}

// ------------------------------------------------------------ curated dishes

function buildDishes(units) {
  const file = join(ROOT, 'data', 'dishes.in.json');
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  const flagged = [];
  const seen = new Set();
  const foods = raw.map((d) => {
    const slug = d.slug || slugify(d.name);
    if (seen.has(slug)) throw new Error(`duplicate dish slug: ${slug}`);
    seen.add(slug);
    const m = d.per100g;
    const atwater = 4 * m.protein + 4 * m.carbs + 9 * m.fat;
    const diff = Math.abs(m.kcal - atwater);
    const drift = diff / Math.max(atwater, 1);
    // The 5 kcal floor keeps plain tea and other near-zero foods out of the report.
    if (drift > 0.12 && diff > 5) flagged.push(`${d.name}: ${m.kcal} kcal vs ${Math.round(atwater)} from macros (${Math.round(drift * 100)}% off)`);
    return {
      id: `dish:${slug}`,
      name: d.name,
      // Drinks are logged in millilitres: per100g then means per 100 ml.
      ...(d.basis ? { basis: d.basis } : {}),
      aliases: d.aliases || [],
      source: 'dish',
      group: d.group,
      per100g: {
        kcal: r1(m.kcal), protein: r2(m.protein), carbs: r2(m.carbs), fat: r2(m.fat),
        ...(m.fiber == null ? {} : { fiber: r2(m.fiber) }),
        ...(m.sugar == null ? {} : { sugar: r2(m.sugar) }),
        ...(m.sodium == null ? {} : { sodium: Math.round(m.sodium) }),
      },
      units: d.units && d.units.length ? d.units : units.unitsForFood(d.name, d.group),
      approx: true,
    };
  });
  foods.sort((a, b) => a.name.localeCompare(b.name));
  return { foods, flagged };
}

// ------------------------------------------------------------------- output

function shardOf(food) {
  if (food.source === 'ifct') return 'ifct';
  if (food.source === 'dish') return 'dishes';
  const c = food.name[0].toLowerCase();
  return c >= 'a' && c <= 'z' ? `usda-${c}` : 'usda-0';
}

function writeJson(path, value) {
  const json = JSON.stringify(value);
  writeFileSync(path, json);
  return { bytes: Buffer.byteLength(json), gzip: gzipSync(Buffer.from(json), { level: 9 }).length };
}

async function main() {
  ensureDir(RAW);
  ensureDir(OUT);

  console.log('Inputs');
  const units = await loadUnitTable();

  let ifct = [];
  try {
    const compositions = npmPack(IFCT_COMPOSITIONS);
    npmPack(IFCT_COLUMNS); // documents the column codes/units used above
    ifct = buildIfct(compositions, units);
  } catch (e) { warn(`IFCT unavailable — ${e.message}`); }

  let usda = [];
  try {
    usda = await buildUsda(units);
  } catch (e) { warn(`USDA unavailable — ${e.message}`); }

  const { foods: dishes, flagged } = buildDishes(units);

  const all = [...dishes, ...ifct, ...usda];
  const shards = new Map();
  for (const f of all) {
    const s = shardOf(f);
    if (!shards.has(s)) shards.set(s, []);
    shards.get(s).push(f);
  }

  // Clear stale shards from earlier runs so the output is a pure function of the inputs.
  for (const f of readdirSync(OUT)) if (f.endsWith('.json')) rmSync(join(OUT, f));

  let bytes = 0, gzip = 0;
  const index = all.map((f) => [f.id, f.name, f.aliases && f.aliases.length ? f.aliases : [], f.group || '', f.source, f.per100g.kcal]);
  const idx = writeJson(join(OUT, 'index.json'), index);
  bytes += idx.bytes; gzip += idx.gzip;

  const shardNames = [...shards.keys()].sort();
  for (const name of shardNames) {
    const s = writeJson(join(OUT, `${name}.json`), shards.get(name));
    bytes += s.bytes; gzip += s.gzip;
  }

  console.log('\nCounts');
  console.log(`  dishes ${dishes.length}   ifct ${ifct.length}   usda ${usda.length}   total ${all.length}`);
  const perGroup = new Map();
  for (const f of usda) perGroup.set(f.group, (perGroup.get(f.group) || 0) + 1);
  for (const [g, n] of [...perGroup].sort((a, b) => b[1] - a[1])) console.log(`    usda · ${g}: ${n}`);

  console.log('\nOutput');
  console.log(`  index.json  ${(idx.bytes / 1024).toFixed(0)} KB raw  ${(idx.gzip / 1024).toFixed(0)} KB gz`);
  console.log(`  ${shardNames.length} shards: ${shardNames.join(', ')}`);
  console.log(`  total       ${(bytes / 1024).toFixed(0)} KB raw  ${(gzip / 1024).toFixed(0)} KB gz  (budget 1536 KB gz)`);
  console.log(`  checksum    ${createHash('sha1').update(readdirSync(OUT).sort().map((f) => readFileSync(join(OUT, f))).reduce((a, b) => Buffer.concat([a, b]), Buffer.alloc(0))).digest('hex').slice(0, 12)}`);

  if (flagged.length) {
    console.log(`\nDish sanity check — ${flagged.length} outside ±12 % of 4P+4C+9F`);
    for (const f of flagged) console.log('  ! ' + f);
  } else {
    console.log('\nDish sanity check — all dishes within ±12 % of 4P+4C+9F');
  }
  if (gzip > 1536 * 1024) warn(`gzipped output ${(gzip / 1024).toFixed(0)} KB exceeds the 1.5 MB budget`);
  if (warnings.length) console.log(`\n${warnings.length} warning(s) — see above`);
}

main().catch((e) => { console.error(`${basename(process.argv[1])}: ${e.stack || e.message}`); process.exit(1); });
