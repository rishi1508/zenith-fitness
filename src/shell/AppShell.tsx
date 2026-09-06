import type { ReactNode } from 'react';
import { Settings, Users } from 'lucide-react';
import { AppBar, TabBar, Sidebar, IconButton, TAB_BAR_HEIGHT } from '../ui';
import { StreakButton } from '../components';
import { TABS, viewToTab } from './tabs';
import type { Tab } from './tabs';
import { GetAppBanner } from './GetAppBanner';
import type { View } from '../App';
import type { UserStats } from '../types';

/** Views whose content should span the full available width on desktop
 *  instead of the 760px centred column (docs/REVAMP_SPEC.md §3). */
const FULL_WIDTH_VIEWS = new Set<View>(['gym-dashboard', 'gym-members']);
/** Views that lay out their own full-height scroll region (chat) — no
 *  shell padding, or the header would scroll out of reach. */
const NO_PADDING_VIEWS = new Set<View>(['buddy-chat', 'zen']);

function barContent(view: View, gymName: string | undefined, firstName: string): { eyebrow?: string; title?: string } {
  switch (view) {
    case 'home': {
      const today = new Date();
      return {
        eyebrow: today.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' }).toUpperCase(),
        title: `Hey ${firstName}!`,
      };
    }
    case 'train': return { title: 'Train' };
    case 'health': return { title: 'Health' };
    case 'you': return { title: 'You' };
    case 'gym-home': return { eyebrow: 'My gym', title: gymName ?? 'My Gym' };
    default: return {};
  }
}

interface AppShellProps {
  view: View;
  onTabChange: (tab: Tab) => void;
  hasGym: boolean;
  gymName?: string;
  isGymOwner: boolean;
  firstName: string;
  stats: UserStats | null;
  isDark: boolean;
  showBuddiesIcon: boolean;
  buddyAlertCount: number;
  onOpenBuddies: () => void;
  onOpenSettings: () => void;
  onOpenGymSettings: () => void;
  userName: string;
  userSub?: string;
  userAvatar?: ReactNode;
  onOpenProfile: () => void;
  /** Pinned group-session reminder — sits between the AppBar and the
   *  routed content, above everything else. */
  banner?: ReactNode;
  children: ReactNode;
}

/**
 * Shell around the routed view content (docs/REVAMP_SPEC.md §3): the
 * kit `AppBar` (title/eyebrow per tab root, blank for pushed sub-views
 * which render their own back + title inline), the phone `TabBar` /
 * desktop `Sidebar`, and the "Get the app" web banner. App.tsx keeps
 * all state, effects and handlers — this only owns layout. Not
 * rendered for the `active` workout view, which stays full-screen.
 */
export function AppShell({
  view, onTabChange, hasGym, gymName, isGymOwner, firstName, stats, isDark,
  showBuddiesIcon, buddyAlertCount, onOpenBuddies, onOpenSettings, onOpenGymSettings,
  userName, userSub, userAvatar, onOpenProfile, banner, children,
}: AppShellProps) {
  const tab = viewToTab[view];
  const items = hasGym ? TABS : TABS.filter((t) => t.id !== 'gym');
  const { title, eyebrow } = barContent(view, gymName, firstName);

  const right =
    view === 'you' ? (
      <IconButton icon={Settings} label="Settings" onClick={onOpenSettings} />
    ) : (
      <>
        {stats && (
          <StreakButton streakCount={stats.currentStreak} level={stats.streakLevel ?? 1} active={stats.thisWeekWorkouts > 0} isDark={isDark} />
        )}
        {showBuddiesIcon && <IconButton icon={Users} label="Buddies" badge={buddyAlertCount} onClick={onOpenBuddies} />}
        {view === 'gym-home' && isGymOwner && <IconButton icon={Settings} label="Gym settings" onClick={onOpenGymSettings} />}
      </>
    );

  return (
    <div className="flex-1 flex min-h-0">
      <Sidebar
        items={items}
        active={tab}
        onChange={onTabChange}
        user={{
          name: userName,
          sub: userSub,
          avatar: userAvatar ?? (
            <span className="w-8 h-8 rounded-full bg-accent-soft text-accent flex items-center justify-center font-display text-sm font-bold">
              {userName.charAt(0).toUpperCase() || '?'}
            </span>
          ),
          onClick: onOpenProfile,
        }}
      />
      <div className="flex-1 flex flex-col min-w-0">
        <AppBar title={title} eyebrow={eyebrow} right={right} />
        <GetAppBanner />
        {banner}
        <main
          className={`flex-1 overflow-y-auto overflow-x-hidden ${NO_PADDING_VIEWS.has(view) ? 'p-0' : 'px-5 pt-1'}`}
          style={{ overscrollBehavior: 'none' }}
        >
          {NO_PADDING_VIEWS.has(view) ? (
            children
          ) : (
            <div className={`mx-auto w-full ${FULL_WIDTH_VIEWS.has(view) ? '' : 'lg:max-w-[760px]'} lg:py-6`}>
              {children}
              {/* Reserves room below the last card so the fixed phone
                  TabBar never covers it; collapses away on desktop
                  where the sidebar takes over. */}
              <div className="lg:hidden" style={{ height: `calc(${TAB_BAR_HEIGHT}px + 24px + env(safe-area-inset-bottom, 0px))` }} />
            </div>
          )}
        </main>
        <TabBar items={items} active={tab} onChange={onTabChange} />
      </div>
    </div>
  );
}
