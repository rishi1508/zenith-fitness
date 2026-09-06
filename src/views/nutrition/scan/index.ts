// Camera food scan barrel (docs/HEALTH_SPEC.md §6). Deliberately separate
// from `src/views/nutrition/index.ts`, which belongs to the diary package
// (N2); the integrator wires the `food-scan` route from here.
export { FoodScanView } from '../FoodScanView';
export type { FoodScanViewProps } from '../FoodScanView';
