import type { GymViewProps } from './types';
import { GymPlaceholderBody } from './GymPlaceholder';

/** Placeholder for the 'gym-console' route — see docs/GYM_TIER_A_SPEC.md §6.
 *  UI agents: replace this file's contents with the real screen; keep
 *  the exported name (CheckinConsoleView) and GymViewProps shape so App.tsx and
 *  views/index.ts need no changes. */
export function CheckinConsoleView(props: GymViewProps) {
  return <GymPlaceholderBody {...props} title="Check-in Console" viewName="gym-console" />;
}
