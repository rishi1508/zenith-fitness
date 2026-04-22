import { useState, useEffect } from 'react';
import {
  ArrowLeft, Search, UserPlus, Users, Bell, Check, X,
  Dumbbell, Flame, MessageCircle, ChevronRight, Loader2, UserCheck, Clock, MessagesSquare,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { Avatar } from '../components';
import type { UserProfile, BuddyRequest, BuddyRelationship, BuddyNotification } from '../types';
import * as buddyService from '../buddyService';
import { StartSessionModal } from '../components';
import { computeWeekStreak } from '../streakService';

/**
 * Recompute a buddy's weekly streak LOCALLY from their activityDays
 * snapshot. We can't trust profile.currentStreak — older clients still
 * write it as a day count, so a buddy with an actually-modest 3-week
 * streak can display as "219 week streak" if they used to workout daily.
 *
 * Falls back to profile.currentStreak only when activityDays isn't
 * present — and we clamp that to a sane ceiling so stale day-counts
 * don't leak into the UI.
 */
function buddyWeekStreak(profile: UserProfile | undefined): number {
  if (!profile) return 0;
  const activity = profile.compareStats?.activityDays;
  if (activity) {
    const synthetic = Object.entries(activity)
      .filter(([, v]) => v > 0)
      .map(([ds]) => ({
        completed: true, type: 'workout' as const, date: ds,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any));
    return computeWeekStreak(synthetic, new Set()).current;
  }
  // No activityDays snapshot → legacy client. The number is almost
  // certainly a day-count, so we show 0 rather than lie with a week
  // unit. Better to under-display than mislead.
  return 0;
}

interface BuddyViewProps {
  isDark: boolean;
  onBack: () => void;
  onViewProfile: (buddyUid: string, buddyName: string, photoURL?: string | null) => void;
  onOpenChat: (buddyUid: string, chatId: string, buddyName: string, photoURL?: string | null) => void;
  onOpenSession: (sessionId: string) => void;
}

type Tab = 'buddies' | 'requests' | 'notifications';

export function BuddyView({ isDark, onBack, onViewProfile, onOpenChat, onOpenSession }: BuddyViewProps) {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>('buddies');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<UserProfile[]>([]);
  const [searching, setSearching] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [buddies, setBuddies] = useState<BuddyRelationship[]>([]);
  const [buddyProfiles, setBuddyProfiles] = useState<Map<string, UserProfile>>(new Map());
  const [incomingRequests, setIncomingRequests] = useState<BuddyRequest[]>([]);
  const [outgoingRequests, setOutgoingRequests] = useState<BuddyRequest[]>([]);
  const [notifications, setNotifications] = useState<BuddyNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [sentRequests, setSentRequests] = useState<Set<string>>(new Set());
  const [sessionModalBuddy, setSessionModalBuddy] = useState<{ uid: string; name: string; photoURL: string | null } | null>(null);

  // Load data on mount
  useEffect(() => {
    if (!user) return;

    // Ensure user profile exists
    buddyService.upsertUserProfile();

    const loadData = async () => {
      try {
        const [incoming, outgoing, notifs] = await Promise.all([
          buddyService.getIncomingRequests(),
          buddyService.getOutgoingRequests(),
          buddyService.getNotifications(),
        ]);
        setIncomingRequests(incoming);
        setOutgoingRequests(outgoing);
        setNotifications(notifs);
        setSentRequests(new Set(outgoing.map((r) => r.toUid)));
      } catch (err) {
        console.error('[Buddy] Failed to load data:', err);
      } finally {
        setLoading(false);
      }
    };

    loadData();

    // Real-time listeners
    const unsubBuddies = buddyService.listenToBuddies((b) => {
      setBuddies(b);
      // Fetch profiles for each buddy
      b.forEach(async (buddy) => {
        const buddyUid = buddy.users.find((u) => u !== user.uid);
        if (buddyUid) {
          const profile = await buddyService.getUserProfile(buddyUid);
          if (profile) {
            setBuddyProfiles((prev) => new Map(prev).set(buddyUid, profile));
          }
        }
      });
    });

    const unsubRequests = buddyService.listenToIncomingRequests((r) => {
      setIncomingRequests(r);
    });

    const unsubNotifs = buddyService.listenToNotifications((n) => {
      setNotifications(n);
    });

    return () => {
      unsubBuddies();
      unsubRequests();
      unsubNotifs();
    };
  }, [user]);

  // Load all users when search panel opens; filter with debounce on type
  useEffect(() => {
    if (!showSearch) {
      setSearchResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const results = await buddyService.searchUsers(searchQuery);
        setSearchResults(results);
      } catch (err) {
        console.error('[Buddy] Search failed:', err);
      } finally {
        setSearching(false);
      }
    }, searchQuery.trim().length > 0 ? 400 : 0);

    return () => clearTimeout(timer);
  }, [searchQuery, showSearch]);

  const handleSendRequest = async (profile: UserProfile) => {
    setActionLoading(profile.uid);
    try {
      await buddyService.sendBuddyRequest(profile.uid, profile.displayName, profile.photoURL);
      setSentRequests((prev) => new Set(prev).add(profile.uid));
    } catch (err: unknown) {
      console.error('[Buddy] sendBuddyRequest failed:', err);
      const msg = err instanceof Error ? err.message : 'Failed to send request';
      // If request already exists, just mark as sent instead of showing error
      if (msg.includes('already sent') || msg.includes('Already')) {
        setSentRequests((prev) => new Set(prev).add(profile.uid));
      } else {
        alert(msg);
      }
    } finally {
      setActionLoading(null);
    }
  };

  const handleAccept = async (request: BuddyRequest) => {
    setActionLoading(request.id);
    try {
      await buddyService.acceptBuddyRequest(request.id);
      setIncomingRequests((prev) => prev.filter((r) => r.id !== request.id));
    } catch (err: any) {
      console.error('[Buddy] acceptBuddyRequest failed:', err);
      alert(err.message || 'Failed to accept request');
    } finally {
      setActionLoading(null);
    }
  };

  const handleDecline = async (request: BuddyRequest) => {
    setActionLoading(request.id);
    try {
      await buddyService.declineBuddyRequest(request.id);
      setIncomingRequests((prev) => prev.filter((r) => r.id !== request.id));
    } catch (err: any) {
      console.error('[Buddy] declineBuddyRequest failed:', err);
      alert(err.message || 'Failed to decline request');
    } finally {
      setActionLoading(null);
    }
  };

  const handleNotificationTap = async (notif: BuddyNotification) => {
    await buddyService.markNotificationRead(notif.id);
    setNotifications((prev) => prev.filter((n) => n.id !== notif.id));

    if (notif.type === 'buddy_request') {
      setTab('requests');
    } else if (notif.type === 'session_invite') {
      const sessionId = notif.data?.sessionId;
      if (sessionId) onOpenSession(sessionId);
    } else if (notif.type === 'chat_message') {
      const chatId = notif.data?.chatId;
      if (chatId) onOpenChat(notif.fromUid, chatId, notif.fromName);
    } else if (notif.type === 'buddy_accepted' || notif.type === 'workout_started') {
      onViewProfile(notif.fromUid, notif.fromName);
    }
  };

  const buddyUids = new Set(
    buddies.flatMap((b) => b.users).filter((uid) => uid !== user?.uid)
  );
  const requestCount = incomingRequests.length;
  const notifCount = notifications.length;

  const cardBg = isDark ? 'bg-[#1a1a1a]' : 'bg-white';
  const cardBorder = isDark ? 'border-[#2e2e2e]' : 'border-gray-200';
  const subtleText = isDark ? 'text-zinc-400' : 'text-gray-500';
  const hoverBg = isDark ? 'hover:bg-[#222]' : 'hover:bg-gray-50';

  return (
    <div className="space-y-4 animate-fadeIn">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className={`p-2 rounded-lg transition-colors ${hoverBg}`}>
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-xl font-bold">Buddies</h1>
        </div>
        <button
          onClick={() => setShowSearch(!showSearch)}
          className={`p-2 rounded-lg transition-colors ${
            showSearch ? 'text-orange-400 bg-orange-500/10' : subtleText + ' ' + hoverBg
          }`}
        >
          <Search className="w-5 h-5" />
        </button>
      </div>

      {/* Search Bar */}
      {showSearch && (
        <div className="space-y-3">
          <div className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border ${cardBg} ${cardBorder}`}>
            <Search className={`w-4 h-4 ${subtleText}`} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by name..."
              className={`flex-1 bg-transparent outline-none text-sm ${isDark ? 'placeholder-zinc-600' : 'placeholder-gray-400'}`}
              autoFocus
            />
            {searching && <Loader2 className="w-4 h-4 animate-spin text-orange-400" />}
          </div>

          {/* Search Results */}
          {searchResults.length > 0 && (
            <div className={`rounded-xl border overflow-hidden ${cardBg} ${cardBorder}`}>
              {searchResults.map((profile) => {
                const isBuddy = buddyUids.has(profile.uid);
                const isPending = sentRequests.has(profile.uid);
                return (
                  <div
                    key={profile.uid}
                    className={`flex items-center justify-between p-3 border-b last:border-b-0 ${cardBorder}`}
                  >
                    <button
                      onClick={() => onViewProfile(profile.uid, profile.displayName, profile.photoURL)}
                      className="flex items-center gap-3 flex-1 text-left min-w-0"
                    >
                      <Avatar name={profile.displayName} photoURL={profile.photoURL} presence={buddyService.computePresence(profile)} />
                      <div className="min-w-0">
                        <div className="font-medium text-sm truncate">{profile.displayName}</div>
                        <div className={`text-xs ${subtleText}`}>
                          {profile.totalWorkouts || 0} workouts
                        </div>
                      </div>
                    </button>
                    {isBuddy ? (
                      <span className="text-xs text-emerald-400 font-medium flex items-center gap-1 flex-shrink-0">
                        <UserCheck className="w-3.5 h-3.5" /> Buddy
                      </span>
                    ) : isPending ? (
                      <span className={`text-xs ${subtleText} font-medium flex items-center gap-1 flex-shrink-0`}>
                        <Clock className="w-3.5 h-3.5" /> Pending
                      </span>
                    ) : (
                      <button
                        onClick={() => handleSendRequest(profile)}
                        disabled={actionLoading === profile.uid}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-gradient-to-r from-orange-500 to-red-600 text-white hover:opacity-90 transition-opacity disabled:opacity-50 flex-shrink-0"
                      >
                        {actionLoading === profile.uid ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <UserPlus className="w-3.5 h-3.5" />
                        )}
                        Add Buddy
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {!searching && searchResults.length === 0 && (
            <p className={`text-sm text-center py-4 ${subtleText}`}>
              No users found. If your Firestore rules don't allow reads on the "userProfiles" collection, search won't work.
            </p>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className={`flex rounded-xl border overflow-hidden ${cardBg} ${cardBorder}`}>
        {([
          { key: 'buddies' as Tab, label: 'Buddies', icon: <Users className="w-4 h-4" />, count: buddies.length },
          { key: 'requests' as Tab, label: 'Requests', icon: <UserPlus className="w-4 h-4" />, count: requestCount },
          { key: 'notifications' as Tab, label: 'Alerts', icon: <Bell className="w-4 h-4" />, count: notifCount },
        ]).map(({ key, label, icon, count }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-xs font-medium transition-colors ${
              tab === key
                ? 'text-orange-400 bg-orange-500/10'
                : subtleText + ' ' + hoverBg
            }`}
          >
            {icon}
            {label}
            {count > 0 && (
              <span className={`ml-1 min-w-[18px] h-[18px] rounded-full text-[10px] font-bold inline-flex items-center justify-center px-1 ${
                tab === key ? 'bg-orange-500 text-white' : isDark ? 'bg-zinc-700 text-zinc-300' : 'bg-gray-200 text-gray-600'
              }`}>
                {count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-orange-400" />
        </div>
      ) : (
        <>
          {/* My Buddies Tab */}
          {tab === 'buddies' && (
            <div className="space-y-2">
              {buddies.length === 0 ? (
                <div className="text-center py-12 space-y-3">
                  <Users className={`w-12 h-12 mx-auto ${subtleText}`} />
                  <p className={`text-sm ${subtleText}`}>No buddies yet</p>
                  <p className={`text-xs ${subtleText}`}>
                    Search for people and send them a buddy request!
                  </p>
                  <button
                    onClick={() => { setShowSearch(true); setTab('buddies'); }}
                    className="mx-auto flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-gradient-to-r from-orange-500 to-red-600 text-white hover:opacity-90 transition-opacity"
                  >
                    <Search className="w-4 h-4" /> Find Buddies
                  </button>
                </div>
              ) : (
                buddies.map((buddy) => {
                  const buddyUid = buddy.users.find((u) => u !== user?.uid)!;
                  const profile = buddyProfiles.get(buddyUid);
                  const buddyName = profile?.displayName || buddy.userNames[buddyUid] || 'Buddy';
                  const isWorkingOut = profile?.isWorkingOut;

                  return (
                    <div
                      key={buddy.id}
                      className={`rounded-xl border p-4 ${cardBg} ${cardBorder}`}
                    >
                      <div className="flex items-center justify-between">
                        <button
                          onClick={() => onViewProfile(buddyUid, buddyName, profile?.photoURL)}
                          className="flex items-center gap-3 flex-1 text-left"
                        >
                          <Avatar
                            name={buddyName}
                            photoURL={profile?.photoURL}
                            size="lg"
                            presence={buddyService.computePresence(profile)}
                          />
                          <div className="flex-1">
                            <div className="font-medium">{buddyName}</div>
                            {isWorkingOut ? (
                              <div className="text-xs text-emerald-400 flex items-center gap-1">
                                <Flame className="w-3 h-3" />
                                Working out: {profile?.activeWorkoutName || 'In progress'}
                              </div>
                            ) : (
                              <div className={`text-xs ${subtleText}`}>
                                {profile?.totalWorkouts || 0} workouts &middot; {buddyWeekStreak(profile)} week streak
                              </div>
                            )}
                          </div>
                          <ChevronRight className={`w-4 h-4 ${subtleText}`} />
                        </button>
                      </div>

                      {/* Quick Actions */}
                      <div className="grid grid-cols-3 gap-2 mt-3">
                        <button
                          onClick={() => onOpenChat(buddyUid, buddy.chatId, buddyName, profile?.photoURL)}
                          className={`flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-colors ${
                            isDark ? 'bg-zinc-800 hover:bg-zinc-700' : 'bg-gray-100 hover:bg-gray-200'
                          }`}
                        >
                          <MessageCircle className="w-3.5 h-3.5" /> Chat
                        </button>
                        <button
                          onClick={() => onViewProfile(buddyUid, buddyName, profile?.photoURL)}
                          className={`flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-colors ${
                            isDark ? 'bg-zinc-800 hover:bg-zinc-700' : 'bg-gray-100 hover:bg-gray-200'
                          }`}
                        >
                          <UserCheck className="w-3.5 h-3.5" /> Profile
                        </button>
                        <button
                          onClick={() => setSessionModalBuddy({ uid: buddyUid, name: buddyName, photoURL: profile?.photoURL || null })}
                          className="flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium bg-gradient-to-r from-orange-500 to-red-600 text-white hover:opacity-90 transition-opacity"
                        >
                          <Dumbbell className="w-3.5 h-3.5" /> Together
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* Requests Tab */}
          {tab === 'requests' && (
            <div className="space-y-3">
              {/* Incoming Requests */}
              {incomingRequests.length > 0 && (
                <div className="space-y-2">
                  <h3 className={`text-xs font-semibold uppercase tracking-wider ${subtleText}`}>
                    Incoming Requests
                  </h3>
                  {incomingRequests.map((req) => (
                    <div
                      key={req.id}
                      className={`flex items-center justify-between p-3 rounded-xl border ${cardBg} ${cardBorder}`}
                    >
                      <div className="flex items-center gap-3">
                        <Avatar name={req.fromName} photoURL={req.fromPhoto} />
                        <div>
                          <div className="font-medium text-sm">{req.fromName}</div>
                          <div className={`text-xs ${subtleText}`}>Wants to be your buddy</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleDecline(req)}
                          disabled={actionLoading === req.id}
                          className={`p-2 rounded-lg transition-colors ${
                            isDark ? 'bg-zinc-800 hover:bg-zinc-700' : 'bg-gray-100 hover:bg-gray-200'
                          } disabled:opacity-50`}
                        >
                          <X className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleAccept(req)}
                          disabled={actionLoading === req.id}
                          className="p-2 rounded-lg bg-gradient-to-r from-orange-500 to-red-600 text-white hover:opacity-90 transition-opacity disabled:opacity-50"
                        >
                          {actionLoading === req.id ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Check className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Outgoing Requests */}
              {outgoingRequests.length > 0 && (
                <div className="space-y-2">
                  <h3 className={`text-xs font-semibold uppercase tracking-wider ${subtleText}`}>
                    Sent Requests
                  </h3>
                  {outgoingRequests.map((req) => (
                    <div
                      key={req.id}
                      className={`flex items-center justify-between p-3 rounded-xl border ${cardBg} ${cardBorder}`}
                    >
                      <div className="flex items-center gap-3">
                        <Avatar name={req.toName} photoURL={req.toPhoto} />
                        <div>
                          <div className="font-medium text-sm">{req.toName}</div>
                          <div className={`text-xs ${subtleText} flex items-center gap-1`}>
                            <Clock className="w-3 h-3" /> Pending
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={async () => {
                          setActionLoading(req.id);
                          try {
                            await buddyService.cancelBuddyRequest(req.id);
                            setOutgoingRequests((prev) => prev.filter((r) => r.id !== req.id));
                            setSentRequests((prev) => { const s = new Set(prev); s.delete(req.toUid); return s; });
                          } catch { /* ignore */ }
                          setActionLoading(null);
                        }}
                        disabled={actionLoading === req.id}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                          isDark ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300' : 'bg-gray-100 hover:bg-gray-200 text-gray-600'
                        } disabled:opacity-50`}
                      >
                        Cancel
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {incomingRequests.length === 0 && outgoingRequests.length === 0 && (
                <div className="text-center py-12 space-y-2">
                  <UserPlus className={`w-12 h-12 mx-auto ${subtleText}`} />
                  <p className={`text-sm ${subtleText}`}>No pending requests</p>
                </div>
              )}
            </div>
          )}

          {/* Notifications Tab */}
          {tab === 'notifications' && (
            <div className="space-y-2">
              {notifications.length === 0 ? (
                <div className="text-center py-12 space-y-2">
                  <Bell className={`w-12 h-12 mx-auto ${subtleText}`} />
                  <p className={`text-sm ${subtleText}`}>No new notifications</p>
                </div>
              ) : (
                <>
                  <button
                    onClick={async () => {
                      await buddyService.markAllNotificationsRead();
                      setNotifications([]);
                    }}
                    className={`text-xs font-medium ${subtleText} hover:text-orange-400 transition-colors`}
                  >
                    Mark all as read
                  </button>
                  {notifications.map((notif) => (
                    <button
                      key={notif.id}
                      onClick={() => handleNotificationTap(notif)}
                      className={`w-full text-left flex items-center gap-3 p-3 rounded-xl border transition-colors ${cardBg} ${cardBorder} ${hoverBg}`}
                    >
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                        notif.type === 'workout_started' || notif.type === 'session_invite'
                          ? 'bg-emerald-500/20 text-emerald-400'
                          : notif.type === 'buddy_accepted'
                            ? 'bg-blue-500/20 text-blue-400'
                            : notif.type === 'chat_message'
                              ? 'bg-purple-500/20 text-purple-400'
                              : 'bg-orange-500/20 text-orange-400'
                      }`}>
                        {notif.type === 'workout_started' || notif.type === 'session_invite' ? (
                          <Dumbbell className="w-5 h-5" />
                        ) : notif.type === 'buddy_accepted' ? (
                          <UserCheck className="w-5 h-5" />
                        ) : notif.type === 'chat_message' ? (
                          <MessagesSquare className="w-5 h-5" />
                        ) : (
                          <UserPlus className="w-5 h-5" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{notif.message}</div>
                        <div className={`text-xs ${subtleText}`}>
                          {new Date(notif.createdAt).toLocaleDateString('en-IN', {
                            day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                          })}
                        </div>
                      </div>
                      <ChevronRight className={`w-4 h-4 ${subtleText}`} />
                    </button>
                  ))}
                </>
              )}
            </div>
          )}
        </>
      )}
      {sessionModalBuddy && (
        <StartSessionModal
          buddyUid={sessionModalBuddy.uid}
          buddyName={sessionModalBuddy.name}
          buddyPhotoURL={sessionModalBuddy.photoURL}
          onClose={() => setSessionModalBuddy(null)}
          onStarted={(sid) => {
            setSessionModalBuddy(null);
            onOpenSession(sid);
          }}
        />
      )}
    </div>
  );
}
