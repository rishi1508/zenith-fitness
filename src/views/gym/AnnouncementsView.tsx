import type { GymViewProps } from './types';
import { GymPlaceholderBody } from './GymPlaceholder';

/** Placeholder for the 'gym-announcements' route — see docs/GYM_TIER_A_SPEC.md §6.
 *  UI agents: replace this file's contents with the real screen; keep
 *  the exported name (AnnouncementsView) and GymViewProps shape so App.tsx and
 *  views/index.ts need no changes. */
export function AnnouncementsView(props: GymViewProps) {
  return <GymPlaceholderBody {...props} title="Announcements" viewName="gym-announcements" />;
}
