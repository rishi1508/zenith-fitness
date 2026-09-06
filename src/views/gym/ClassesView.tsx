import type { GymViewProps } from './types';
import { GymPlaceholderBody } from './GymPlaceholder';

/** Placeholder for the 'gym-classes' route — see docs/GYM_TIER_A_SPEC.md §6.
 *  UI agents: replace this file's contents with the real screen; keep
 *  the exported name (ClassesView) and GymViewProps shape so App.tsx and
 *  views/index.ts need no changes. */
export function ClassesView(props: GymViewProps) {
  return <GymPlaceholderBody {...props} title="Classes" viewName="gym-classes" />;
}
