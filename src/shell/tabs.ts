import { Home, Dumbbell, Building2, HeartPulse, User } from 'lucide-react';
import type { TabItem } from '../ui';
import type { View } from '../App';

/** The five bottom-tab / sidebar destinations (docs/REVAMP_SPEC.md §3).
 *  `gym` is only shown when the signed-in user belongs to a gym — see
 *  `AppShell`, which filters `TABS` down to 4 items otherwise. */
export type Tab = 'home' | 'train' | 'gym' | 'health' | 'you';

/** Static tab list, gym-centred. `AppShell` drops the `gym` entry when
 *  `useGym().gym` is unset instead of this array changing shape. */
export const TABS: TabItem<Tab>[] = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'train', label: 'Train', icon: Dumbbell },
  { id: 'gym', label: 'My Gym', icon: Building2, center: true },
  { id: 'health', label: 'Health', icon: HeartPulse },
  { id: 'you', label: 'You', icon: User },
];

/** Which tab highlights for every existing `View` — most non-root
 *  views belong to a tab even though they navigate deeper than its
 *  root (e.g. `history` highlights `you`). `workout` is unused legacy
 *  state (pre-existing, kept as-is) and maps to `home`. */
export const viewToTab: Record<View, Tab> = {
  home: 'home',
  workout: 'home',
  train: 'train',
  templates: 'train',
  weekly: 'train',
  exercises: 'train',
  'common-templates': 'train',
  compare: 'train',
  active: 'train',
  health: 'health',
  'body-weight': 'health',
  'body-measurements': 'health',
  insights: 'health',
  zen: 'health',
  nutrition: 'health',
  'food-search': 'health',
  'food-scan': 'health',
  'nutrition-targets': 'health',
  activity: 'health',
  energy: 'health',
  phase: 'health',
  you: 'you',
  profile: 'you',
  history: 'you',
  progress: 'you',
  analysis: 'you',
  settings: 'you',
  buddies: 'you',
  'buddy-profile': 'you',
  'buddy-chat': 'you',
  'buddy-compare': 'you',
  'session-lobby': 'you',
  'admin-gyms': 'you',
  'admin-users': 'you',
  'admin-library': 'you',
  'gym-join': 'gym',
  'gym-home': 'gym',
  'gym-checkin': 'gym',
  'gym-classes': 'gym',
  'gym-class': 'gym',
  'gym-announcements': 'gym',
  'gym-membership': 'gym',
  'gym-dashboard': 'gym',
  'gym-members': 'gym',
  'gym-member': 'gym',
  'gym-console': 'gym',
  'gym-classes-manage': 'gym',
  'gym-settings': 'gym',
  'gym-create': 'gym',
};

/** Root view a tab navigates to on tap (also resets the history stack). */
export const tabRoot: Record<Tab, View> = {
  home: 'home',
  train: 'train',
  gym: 'gym-home',
  health: 'health',
  you: 'you',
};
