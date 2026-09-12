import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { Settings, Users } from 'lucide-react';
import { AppBar, TabBar, Sidebar, IconButton, TAB_BAR_HEIGHT } from '../ui';
import { StreakButton } from '../components';
import { LevelRing } from '../components/LevelRing';
import { TABS, viewToTab } from './tabs';
import { useElasticScroll } from '../hooks/useElasticScroll';
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
      const date = today.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' }).toUpperCase();
      // The gym's name rides on the eyebrow: the member opens their gym's app.
      return {
        eyebrow: gymName ? `${gymName.toUpperCase()} · ${date}` : date,
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
  /** Raw photo URL, so the You tab can wear it inside its level ring. */
  userPhotoURL?: string | null;
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
  userName, userSub, userAvatar, userPhotoURL, onOpenProfile, banner, children,
}: AppShellProps) {
  const tab = viewToTab[view];
  const base = hasGym ? TABS : TABS.filter((t) => t.id !== 'gym');
  // "You" is the user's own face, ringed by their experience level.
  const items = base.map((t) => (t.id === 'you'
    ? {
      ...t,
      render: (active: boolean) => (
        <LevelRing size={26} totalVolumeKg={stats?.totalVolume ?? 0} photoURL={userPhotoURL} name={userName} muted={!active} />
      ),
    }
    : t));
  const { title, eyebrow } = barContent(view, gymName, firstName);

  // `main` is one persistent scroll container for every route, so without
  // this a new screen inherits the previous screen's scrollTop — and with
  // lazy chunks the browser's scroll anchoring lands you at the bottom of
  // the page you just opened. Every navigation starts at the top.
  const scrollRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => { scrollRef.current?.scrollTo({ top: 0 }); }, [view]);
  // Both ends give a little and spring back, so anything sitting under the
  // tab bar or a floating button can be pulled into view. Not for the chat
  // views: they scroll themselves inside an h-full box, so <main> never
  // scrolls and every swipe looked like a pull on the whole app.
  useElasticScroll(scrollRef, contentRef, !NO_PADDING_VIEWS.has(view));

  // Tab roots own the bar (title, streak, buddies). A pushed screen draws
  // its own back arrow and title inline, so the bar above it was ~66px of
  // empty chrome on every sub-screen — gone, with a little top padding in
  // its place so the inline header does not sit against the status bar.
  const showBar = !!(title || eyebrow);

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
        {showBar && <AppBar title={title} eyebrow={eyebrow} right={right} />}
        <GetAppBanner />
        {banner}
        <main
          ref={scrollRef}
          className={`flex-1 overflow-y-auto overflow-x-hidden ${NO_PADDING_VIEWS.has(view) ? 'p-0' : showBar ? 'px-5 pt-1' : 'px-5 pt-4'}`}
          style={{ overscrollBehavior: 'none', overflowAnchor: 'none' }}
        >
          {/* Chat and Zen lay themselves out with `h-full`, which only
              resolves if this wrapper has a definite height too. */}
          <div ref={contentRef} className={NO_PADDING_VIEWS.has(view) ? 'h-full' : ''}>
          {NO_PADDING_VIEWS.has(view) ? (
            children
          ) : (
            <div className={`mx-auto w-full ${FULL_WIDTH_VIEWS.has(view) ? '' : 'lg:max-w-[760px]'} lg:py-6`}>
              {children}
              {/* Room below the last card for the fixed TabBar AND anything
                  floating above it (the diary's Log food button is 56px plus
                  its own 16px gap). Too little here is why the bottom of
                  several screens sat under the bar. Collapses away on desktop
                  where the sidebar takes over. */}
              <div className="lg:hidden" style={{ height: `calc(${TAB_BAR_HEIGHT}px + 96px + env(safe-area-inset-bottom, 0px))` }} />
            </div>
          )}
          </div>
        </main>
        <TabBar items={items} active={tab} onChange={onTabChange} />
      </div>
    </div>
  );
}
