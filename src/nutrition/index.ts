// Nutrition package — food database + portion maths (docs/HEALTH_SPEC.md §2).

export {
  loadFoodIndex,
  searchFoods,
  getFood,
  lookupBarcode,
  gramsFor,
  macrosFor,
  scaleMacros,
  OFF_ATTRIBUTION,
  SOURCE_ATTRIBUTION,
} from './foodDb';
export type { FoodIndexEntry, SearchOptions } from './foodDb';

export { getSharedFoods, loadSharedFoods } from './sharedFoodCache';
export { searchAllFoods, findFoodByName } from './foodSearchAll';
export type { FoodRow } from './foodSearchAll';

export {
  MEASURES,
  GROUP_UNITS,
  unitGroupFor,
  unitsForFood,
  pieceGramsFor,
} from './units';
export type { MeasureLabel, UnitGroup } from './units';
