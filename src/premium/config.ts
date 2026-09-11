/**
 * Premium enforcement (docs/REVAMP_SPEC.md §5, docs/DEMO_AND_PRICING.md).
 *
 * On since 3.27.0. There is still nothing to buy inside the app: Premium is
 * what a member of a paying gym has, or what an admin grants. With this on,
 * `usePremium().can()` says no to free accounts for the features in
 * `features.ts`, and the API says no too (api/zen.ts, api/foodscan.ts) —
 * the client gate is the polite version of a rule the server enforces.
 */
export const PAYWALL_ENFORCED = true;
