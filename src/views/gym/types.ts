/**
 * Gym OS lite (Tier A) routing types — shared by App.tsx and every
 * placeholder view under src/views/gym/. Lives here (rather than only
 * inline in App.tsx) so these view components can type their
 * `onNavigate` prop without importing from App.tsx, which would create
 * a circular import (App.tsx imports the views).
 *
 * See docs/GYM_TIER_A_SPEC.md §6.1.
 */

/** The gym-related view names — folded into App.tsx's `View` union. */
export type GymView =
  | 'gym-join'
  | 'gym-home'
  | 'gym-checkin'
  | 'gym-classes'
  | 'gym-class'
  | 'gym-announcements'
  | 'gym-membership'
  | 'gym-dashboard'
  | 'gym-members'
  | 'gym-member'
  | 'gym-console'
  | 'gym-classes-manage'
  | 'gym-settings'
  | 'gym-create';

export interface GymNavParams {
  classId?: string;
  memberUid?: string;
}

/** Shared prop shape for every view under src/views/gym/, placeholder or
 *  real. UI agents replacing a placeholder should keep this shape so
 *  App.tsx never needs to change when the real screen lands. */
export interface GymViewProps {
  isDark: boolean;
  onBack: () => void;
  onNavigate: (view: GymView, params?: GymNavParams) => void;
  gymId?: string;
  classId?: string;
  memberUid?: string;
}
