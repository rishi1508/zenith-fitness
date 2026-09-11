import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, BarChart3, Building2, Camera, ChevronRight, ClipboardList, Dumbbell, Grid3x3, Image as ImageIcon,
  Library, Loader2, MessageCircle, Settings, Sparkles, TrendingUp, UserCog, UserPlus, Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { GymFeedPost, UserProfile, Workout } from '../../types';
import { useAuth } from '../../auth/AuthContext';
import { useGym } from '../../gym/GymContext';
import * as buddyService from '../../buddyService';
import { isAdmin } from '../../admin';
import { listenToFeed } from '../../gymFeed';
import { follow, isFollowing, listFollowers, listFollowing, unfollow } from '../../followService';
import { saveProfilePhoto, effectiveProfilePhoto } from '../../profilePhoto';
import { LevelRing } from '../../components/LevelRing';
import { ActivityHeatmap, AvatarPeek, BadgeArt, StreakModal } from '../../components';
import { usePremium, PremiumBadge, UpgradeSheet, FREE_BUDDY_LIMIT } from '../../premium';
import type { Tier } from '../../premium';
import {
  Card, EmptyState, IconButton, ListRow, Pill, SectionHeader, Sheet, Skeleton, StatTile, useToast, CAPTION, H2, SUB,
} from '../../ui';
import type { PillTone } from '../../ui';
import { formatVolume, levelTitle } from '../../levels';
import { BADGES, badgeById } from '../../badges';
import type { BadgeDef } from '../../badges';
import { getLocalBadges } from '../../badgeSync';
import * as storage from '../../storage';
import { ownStats, ownWorkouts, photosBy, postsBy, statsFromProfile, workoutSummaryLine } from './profileData';
import { PhotoViewer } from './PhotoViewer';

const TIER_LABEL: Record<Tier, string> = { admin: 'Admin', premium: 'Premium', gym: 'Gym premium', free: 'Free' };
const TIER_TONE: Record<Tier, PillTone> = { admin: 'info', premium: 'accent', gym: 'accent', free: 'neutral' };

/** Resize + JPEG-compress before it is stored on the profile document. */
async function compressImageFile(file: File, maxPx = 192, quality = 0.72): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxPx / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  ctx.drawImage(bitmap, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', quality);
}

type TabId = 'workouts' | 'photos' | 'more';

const TABS: Array<{ id: TabId; label: string; icon: LucideIcon }> = [
  { id: 'workouts', label: 'Workouts', icon: Dumbbell },
  { id: 'photos', label: 'Photos', icon: Grid3x3 },
  { id: 'more', label: 'More', icon: Settings },
];

export interface ProfileViewProps {
  /** Gym join screen, from the Premium sheet. */
  onJoinGym?: () => void;
  /** Whose profile. Absent = the signed-in user's own. */
  uid?: string;
  isDark: boolean;
  /** Back arrow — only shown when this is somebody else's profile. */
  onBack?: () => void;
  onOpenProgress: () => void;
  onOpenAnalysis: () => void;
  onOpenHistory: () => void;
  onOpenBuddies: () => void;
  onOpenSettings: () => void;
  onOpenAdminGyms: () => void;
  onOpenAdminUsers: () => void;
  onOpenAdminLibrary: () => void;
  onOpenChat?: (uid: string, name: string, photoURL?: string | null) => void;
  /** Opens another profile from the follower / following lists. */
  onOpenProfileUid?: (uid: string) => void;
  /** Buddy-only actions, shown once the two of you are buddies. */
  onCompare?: (uid: string, name: string, photoURL?: string | null) => void;
  onStartSession?: (uid: string, name: string, photoURL?: string | null) => void;
}

/**
 * One screen for "who is this person", used for the You tab and for anybody
 * you tap in the app. Strava's shape: an identity header, then Workouts /
 * Photos, with a third tab of your own settings that only you can see.
 *
 * Someone else's numbers come from their profile document and whatever they
 * shared to the gym feed — the app never pretends to know more about them
 * than they published.
 */
export function ProfileView({
  uid, isDark, onBack, onOpenProgress, onOpenAnalysis, onOpenHistory, onOpenBuddies, onOpenSettings,
  onOpenAdminGyms, onOpenAdminUsers, onOpenAdminLibrary, onOpenChat, onOpenProfileUid, onCompare, onStartSession, onJoinGym }: ProfileViewProps) {
  const { user } = useAuth();
  const { gym, role: gymRole } = useGym();
  const { tier, can } = usePremium();
  const [showUpgrade, setShowUpgrade] = useState<null | 'unlimited-buddies' | 'tier'>(null);
  const { showToast } = useToast();

  const self = !uid || uid === user?.uid;
  const targetUid = uid ?? user?.uid ?? '';

  const [tab, setTab] = useState<TabId>('workouts');
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(!self);
  const [following, setFollowing] = useState(false);
  const [busyFollow, setBusyFollow] = useState(false);
  const [posts, setPosts] = useState<GymFeedPost[]>([]);
  const [openPhoto, setOpenPhoto] = useState<GymFeedPost | null>(null);
  const [streakOpen, setStreakOpen] = useState(false);
  const [photoURL, setPhotoURL] = useState<string | null>(() => (self ? effectiveProfilePhoto(user?.photoURL) : null));
  const [uploading, setUploading] = useState(false);
  const [badgesOpen, setBadgesOpen] = useState(false);
  const [people, setPeople] = useState<'followers' | 'following' | null>(null);
  const [badgeDetail, setBadgeDetail] = useState<(BadgeDef & { at: string }) | null>(null);
  const [buddyState, setBuddyState] = useState<'unknown' | 'none' | 'requested' | 'buddies'>('unknown');

  useEffect(() => {
    if (!targetUid) return;
    let cancelled = false;
    setLoading(!self);
    void buddyService.getUserProfile(targetUid)
      .then((p) => { if (!cancelled) setProfile(p); })
      .catch(() => { /* a profile that will not load simply shows less */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [targetUid, self]);

  useEffect(() => {
    if (self || !targetUid) return;
    void isFollowing(targetUid).then(setFollowing);
    void buddyService.areBuddies(user?.uid ?? '', targetUid)
      .then((yes) => setBuddyState(yes ? 'buddies' : 'none'))
      .catch(() => setBuddyState('none'));
  }, [self, targetUid, user?.uid]);

  // The gym feed is the only place anyone's posts live, so a profile reads a
  // page of it and keeps this person's.
  useEffect(() => {
    if (!gym?.id) return;
    return listenToFeed(gym.id, setPosts, 60);
  }, [gym?.id]);

  const stats = useMemo(() => (self ? ownStats() : statsFromProfile(profile)), [self, profile]);
  // Your own come from the device (instant); somebody else's from what they
  // published on their profile.
  const badges = useMemo(
    () => (self ? getLocalBadges() : (profile?.badges ?? [])),
    [self, profile],
  );
  const myWorkouts = useMemo(() => (self ? ownWorkouts() : []), [self]);
  const theirPosts = useMemo(() => postsBy(posts, targetUid), [posts, targetUid]);
  const theirPhotos = useMemo(() => photosBy(posts, targetUid), [posts, targetUid]);

  const name = self ? (user?.displayName || 'You') : (profile?.displayName || 'Zenith member');

  /** "The Sweat Zone · owner" — the gym's own vocabulary, not the app's. */
  const gymRoleLabel = useMemo(() => {
    const sameGym = self || profile?.gym?.gymId === gym?.id;
    if (!gym?.name || !sameGym) return null;
    const role = self ? gymRole : profile?.gym?.gymRole;
    const word = role === 'owner' ? 'owner' : role === 'manager' ? 'manager' : role === 'trainer' ? 'trainer' : 'member';
    return `${gym.name} · ${word}`;
  }, [self, gym, gymRole, profile]);
  const avatar = self ? photoURL : (profile?.photoURL ?? null);

  const toggleFollow = useCallback(async () => {
    if (busyFollow) return;
    setBusyFollow(true);
    try {
      if (following) { await unfollow(targetUid); setFollowing(false); }
      else { await follow(targetUid); setFollowing(true); }
      setProfile((p) => (p ? { ...p, followerCount: Math.max(0, (p.followerCount ?? 0) + (following ? -1 : 1)) } : p));
    } catch {
      showToast('Could not update that just now.', 'error');
    } finally {
      setBusyFollow(false);
    }
  }, [busyFollow, following, targetUid, showToast]);

  const onPickPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !user) return;
    setUploading(true);
    try {
      const dataUri = await compressImageFile(file);
      await saveProfilePhoto(dataUri);
      setPhotoURL(dataUri);
      showToast('Photo updated');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Photo upload failed', 'error');
    } finally {
      setUploading(false);
    }
  };

  const visibleTabs = self ? TABS : TABS.filter((t) => t.id !== 'more');
  const followers = profile?.followerCount ?? 0;
  const followingCount = profile?.followingCount ?? 0;

  return (
    <div className="space-y-4 animate-fadeIn">
      {onBack && (
        <div className="flex items-center gap-3">
          <IconButton icon={ArrowLeft} label="Back" onClick={onBack} />
          <h1 className={`${H2} truncate`}>{name}</h1>
        </div>
      )}

      {/* Identity */}
      <div className="flex items-start gap-3">
        <div className="relative shrink-0">
          <AvatarPeek photoURL={avatar} name={name}>
            <LevelRing size={76} totalVolumeKg={stats.totalVolumeKg} photoURL={avatar} name={name} />
          </AvatarPeek>
          {self && (
            <>
              {/* Bottom-LEFT: the level badge already owns bottom-right, and
                  the two used to sit on top of each other. */}
              <label
                className="absolute -bottom-0.5 -left-0.5 w-7 h-7 rounded-full bg-accent border-2 border-bg flex items-center justify-center cursor-pointer"
                title="Change profile picture"
              >
                {uploading
                  ? <Loader2 className="w-3.5 h-3.5 text-white animate-spin" />
                  : <Camera className="w-3.5 h-3.5 text-white" />}
                <input type="file" accept="image/*" className="hidden" onChange={onPickPhoto} disabled={uploading} />
              </label>
              <span className="absolute -bottom-1 -right-1 min-w-6 h-6 px-1.5 rounded-full bg-surface border border-border text-[11px] font-bold text-accent tabular-nums flex items-center justify-center">
                {stats.level}
              </span>
            </>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <h2 className="font-display text-lg font-bold text-text truncate">{name}</h2>
          <div className="flex flex-wrap items-center gap-1.5 mt-1">
            {/* "Admin" means Zenith admin and nothing else. A gym has owners,
                trainers and members — never admins — so the two can no longer
                both print "Admin" next to each other. */}
            {isAdmin(targetUid)
              ? <Pill tone="info">Admin</Pill>
              : self && (tier !== 'free'
                ? <Pill tone={TIER_TONE[tier]}>{TIER_LABEL[tier]}</Pill>
                // The one quiet place a free account is told there is more.
                : <button type="button" onClick={() => setShowUpgrade('tier')} aria-label="About Premium" className="rounded-full"><Pill tone="neutral">Free</Pill></button>)}
            {gymRoleLabel && <Pill tone="neutral">{gymRoleLabel}</Pill>}
            <Pill tone="accent">Lv {stats.level} · {levelTitle(stats.level)}</Pill>
          </div>

          {/* Padded out to a thumb-sized target without moving the text:
              the row was 18px tall, which is half of what a tap needs. */}
          <div className="flex items-center gap-1 mt-1 -ml-2">
            <button onClick={() => setPeople('followers')} className={`${SUB} px-2 py-2`}>
              <b className="text-text tabular-nums">{followers}</b> followers
            </button>
            <button onClick={() => setPeople('following')} className={`${SUB} px-2 py-2`}>
              <b className="text-text tabular-nums">{followingCount}</b> following
            </button>
          </div>
        </div>
      </div>

      {!self && buddyState === 'buddies' && (onCompare || onStartSession) && (
        <div className="flex gap-2">
          {onStartSession && (
            <button
              onClick={() => onStartSession(targetUid, name, avatar)}
              className="flex-1 min-h-11 rounded-control border border-border text-sm font-bold text-text flex items-center justify-center gap-1.5"
            >
              <Dumbbell className="w-4 h-4" strokeWidth={2} /> Train together
            </button>
          )}
          {onCompare && (
            <button
              onClick={() => onCompare(targetUid, name, avatar)}
              className="flex-1 min-h-11 rounded-control border border-border text-sm font-bold text-text flex items-center justify-center gap-1.5"
            >
              <BarChart3 className="w-4 h-4" strokeWidth={2} /> Compare
            </button>
          )}
        </div>
      )}

      {!self && (
        <div className="flex gap-2">
          <button
            onClick={() => { void toggleFollow(); }}
            disabled={busyFollow || buddyState === 'buddies'}
            className={`flex-1 min-h-11 rounded-control text-sm font-bold transition-colors disabled:opacity-60 ${
              following ? 'border border-border text-text' : 'bg-accent text-white'
            }`}
          >
            {buddyState === 'buddies' ? 'Buddy · following' : following ? 'Following' : 'Follow'}
          </button>
          <button
            onClick={() => {
              // Already training partners? The useful action is talking to
              // them, not asking again.
              if (buddyState === 'buddies') { onOpenChat?.(targetUid, name, avatar); return; }
              if (buddyState !== 'none') return;
              if (!can('unlimited-buddies')) {
                // Free accounts train with a few buddies; one read to know where they stand.
                void buddyService.getBuddies().then((rels) => {
                  if (rels.length >= FREE_BUDDY_LIMIT) { setShowUpgrade('unlimited-buddies'); return; }
                  setBuddyState('requested');
                  void buddyService.sendBuddyRequest(targetUid, name, avatar ?? undefined)
                    .then(() => showToast(`Buddy request sent to ${name}`))
                    .catch((err) => { setBuddyState('none'); showToast(err instanceof Error ? err.message : 'Could not send that request.', 'error'); });
                });
                return;
              }
              setBuddyState('requested');
              void buddyService.sendBuddyRequest(targetUid, name, avatar ?? undefined)
                .then(() => showToast(`Buddy request sent to ${name}`))
                .catch((err) => {
                  setBuddyState('none');
                  showToast(err instanceof Error ? err.message : 'Could not send that request.', 'error');
                });
            }}
            disabled={buddyState === 'requested' || buddyState === 'unknown'}
            className="flex-1 min-h-11 rounded-control border border-border text-sm font-bold text-text flex items-center justify-center gap-1.5 disabled:opacity-60"
          >
            {buddyState === 'buddies' ? (
              <><MessageCircle className="w-4 h-4" strokeWidth={2} /> Message</>
            ) : (
              <><UserPlus className="w-4 h-4" strokeWidth={2} /> {buddyState === 'requested' ? 'Requested' : 'Add buddy'}</>
            )}
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-control bg-surface-2 border border-border">
        {visibleTabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex-1 min-h-10 rounded-[9px] text-[13px] font-bold flex items-center justify-center gap-1.5 transition-colors ${
              tab === id ? 'bg-surface text-text shadow-sm' : 'text-subtle'
            }`}
          >
            <Icon className="w-4 h-4" strokeWidth={1.75} />
            {label}
          </button>
        ))}
      </div>

      {loading && <Skeleton className="h-40 w-full" />}

      {tab === 'workouts' && !loading && (
        <div className="space-y-4">
          <Card>
            <div className="flex items-baseline justify-between gap-2">
              <span className={CAPTION}>Level {stats.level} · {levelTitle(stats.level)}</span>
              <span className="text-[11px] font-semibold text-subtle tabular-nums">{formatVolume(stats.totalVolumeKg)} lifted</span>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <StatTile eyebrow="Workouts" value={stats.workouts} compact onClick={self ? onOpenHistory : undefined} />
              <StatTile eyebrow="Streak" value={stats.streak} unit="w" compact onClick={self ? () => setStreakOpen(true) : undefined} />
              <StatTile eyebrow="Volume" value={formatVolume(stats.totalVolumeKg)} compact onClick={self ? onOpenProgress : undefined} />
            </div>
          </Card>

          {self && <ActivityHeatmap workouts={storage.getWorkouts()} isDark={isDark} />}

          {/* Below the heatmap on purpose: badges are a nice thing to find,
              not the headline of a profile. */}
          {badges.length > 0 && (
            <Card>
              <SectionHeader
                caption={`Badges · ${badges.length} of ${BADGES.length}`}
                trailing={{ label: 'All', onClick: () => setBadgesOpen(true) }}
              />
              <div className="mt-2 flex flex-wrap gap-2.5">
                {badges.slice(0, 8).map((b) => {
                  const def = badgeById(b.id);
                  if (!def) return null;
                  return (
                    <button
                      key={b.id}
                      onClick={() => setBadgeDetail({ ...def, at: b.at })}
                      title={`${def.name} — ${def.detail}`}
                      aria-label={`${def.name}: ${def.detail}`}
                    >
                      <BadgeArt badge={def} size={48} />
                    </button>
                  );
                })}
              </div>
            </Card>
          )}

          <SectionHeader caption={self ? 'Your sessions' : 'Shared sessions'} />
          {self ? (
            myWorkouts.length === 0
              ? <EmptyState icon={Dumbbell} title="No sessions yet" body="Finish a workout and it shows up here." />
              : (
                <Card padding="list">
                  {myWorkouts.slice(0, 12).map((w) => (
                    <SessionRow key={w.id} workout={w} onOpen={onOpenHistory} />
                  ))}
                </Card>
              )
          ) : theirPosts.filter((p) => p.workout).length === 0 ? (
            <EmptyState icon={Dumbbell} title="Nothing shared yet" body={`${name} has not posted a session to your gym's feed.`} />
          ) : (
            <div className="space-y-2">
              {theirPosts.filter((p) => p.workout).map((p) => (
                <Card key={p.id}>
                  <div className="flex items-center gap-2">
                    <Dumbbell className="w-4 h-4 text-accent shrink-0" strokeWidth={1.75} />
                    <span className="flex-1 min-w-0 text-sm font-bold text-text truncate">{p.workout!.name}</span>
                    <span className={`${SUB} shrink-0`}>{new Date(p.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>
                  </div>
                  <p className={`${SUB} mt-1`}>
                    {(p.workout!.volumeKg / 1000).toFixed(1)} t · {p.workout!.sets} sets
                    {p.workout!.durationMin ? ` · ${p.workout!.durationMin} min` : ''}
                    {p.workout!.kcal ? ` · ${p.workout!.kcal} kcal` : ''}
                  </p>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'photos' && !loading && (
        theirPhotos.length === 0 ? (
          <EmptyState
            icon={ImageIcon}
            title="No photos yet"
            body={self ? 'Photos you share to your gym feed collect here.' : `${name} has not shared a photo.`}
          />
        ) : (
          <div className="grid grid-cols-3 gap-1">
            {theirPhotos.map((p) => (
              <button
                key={p.id}
                onClick={() => setOpenPhoto(p)}
                className="aspect-square rounded-sm overflow-hidden bg-surface-2"
                aria-label={`Open photo from ${new Date(p.at).toLocaleDateString('en-IN')}`}
              >
                <PhotoThumb gymId={gym?.id ?? ''} post={p} />
              </button>
            ))}
          </div>
        )
      )}

      {tab === 'more' && self && (
        <div className="space-y-4">
          <Card padding="list">
            <ListRow icon={Users} iconTone="accent" title="Buddies" subtitle="Training partners, invites and requests" onClick={onOpenBuddies} />
          </Card>
          <Card padding="list">
            <ListRow icon={TrendingUp} title="Progress" subtitle="Per-exercise trends and PRs" onClick={onOpenProgress} />
            <ListRow
              icon={BarChart3}
              title="Analysis"
              subtitle="Muscle balance · deload"
              onClick={onOpenAnalysis}
              trailing={<><PremiumBadge /><ChevronRight className="w-[18px] h-[18px] text-subtle shrink-0" strokeWidth={1.75} /></>}
            />
            <ListRow icon={ClipboardList} title="Workout history" subtitle={`${stats.workouts} sessions`} onClick={onOpenHistory} />
          </Card>
          <ListRow icon={Settings} title="Settings" subtitle="Account, appearance, data and more" onClick={onOpenSettings} />
          {isAdmin(user?.uid) && (
            <>
              <SectionHeader caption="Admin" />
              <Card padding="list">
                <ListRow icon={Building2} title="Gyms" subtitle="Create and manage gyms" onClick={onOpenAdminGyms} />
                <ListRow icon={UserCog} title="Users" subtitle="Accounts, tiers, premium grants" onClick={onOpenAdminUsers} />
                <ListRow icon={Library} title="Shared library" subtitle="Exercise definitions" onClick={onOpenAdminLibrary} />
              </Card>
            </>
          )}
          <p className={`${SUB} text-center flex items-center justify-center gap-1.5`}>
            <Sparkles className="w-3.5 h-3.5" /> Zenith Fitness v{__APP_VERSION__}
          </p>
        </div>
      )}

      {people && (
        <PeopleSheet
          uid={targetUid}
          mode={people}
          onClose={() => setPeople(null)}
          onOpen={(u) => { setPeople(null); onOpenProfileUid?.(u); }}
        />
      )}

      {badgesOpen && (
        <Sheet open onClose={() => setBadgesOpen(false)} title={`Badges · ${badges.length}`}>
          <div className="grid grid-cols-4 gap-3">
            {badges.map((b) => {
              const def = badgeById(b.id);
              if (!def) return null;
              return (
                <button key={b.id} onClick={() => { setBadgesOpen(false); setBadgeDetail({ ...def, at: b.at }); }} className="flex flex-col items-center gap-1">
                  <BadgeArt badge={def} size={56} />
                  <span className="text-[10px] text-subtle text-center leading-tight">{def.name}</span>
                </button>
              );
            })}
          </div>
          {/* What is still out there, so the collection has an edge to it. */}
          {BADGES.length > badges.length && (
            <>
              <span className={CAPTION}>Not yet</span>
              <div className="grid grid-cols-4 gap-3 text-subtle">
                {BADGES.filter((d) => !badges.some((b) => b.id === d.id)).map((def) => (
                  <div key={def.id} className="flex flex-col items-center gap-1">
                    <BadgeArt badge={def} size={56} locked />
                    <span className="text-[10px] text-subtle text-center leading-tight">{def.detail}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </Sheet>
      )}

      {badgeDetail && (
        <Sheet open onClose={() => setBadgeDetail(null)} title={badgeDetail.name}>
          <div className="flex flex-col items-center text-center gap-2 py-2">
            <BadgeArt badge={badgeDetail} size={96} />
            <p className="text-[15px] font-semibold text-text">{badgeDetail.detail}</p>
            <p className={SUB}>
              Earned {new Date(badgeDetail.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
          </div>
        </Sheet>
      )}

      <UpgradeSheet

        open={showUpgrade !== null}

        onClose={() => setShowUpgrade(null)}

        feature={showUpgrade === 'unlimited-buddies' ? 'unlimited-buddies' : undefined}

        onJoinGym={onJoinGym}

      />


      {openPhoto && gym?.id && (
        <PhotoViewer gymId={gym.id} post={openPhoto} onClose={() => setOpenPhoto(null)} />
      )}
      {streakOpen && <StreakModal isDark={isDark} onClose={() => setStreakOpen(false)} />}
    </div>
  );
}

function SessionRow({ workout, onOpen }: { workout: Workout; onOpen: () => void }) {
  return (
    <ListRow
      icon={Dumbbell}
      title={workout.name}
      subtitle={`${new Date(workout.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} · ${workoutSummaryLine(workout)}`}
      onClick={onOpen}
    />
  );
}

/** Grid thumbnail — one read per photo, and only for the ones on screen. */
function PhotoThumb({ gymId, post }: { gymId: string; post: GymFeedPost }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void import('../../gymFeed').then(({ getPostImage }) => getPostImage(gymId, post.id))
      .then((url) => { if (!cancelled) setSrc(url); });
    return () => { cancelled = true; };
  }, [gymId, post.id]);
  return src
    ? <img src={src} alt="" className="w-full h-full object-cover" />
    : <span className="block w-full h-full animate-pulse bg-surface-2" />;
}

/** Who follows this person, or who they follow. Names resolved on open —
 *  a handful of profile reads, and only when somebody asks. */
function PeopleSheet({ uid, mode, onClose, onOpen }: {
  uid: string;
  mode: 'followers' | 'following';
  onClose: () => void;
  onOpen: (uid: string) => void;
}) {
  const [rows, setRows] = useState<Array<{ uid: string; name: string; photoURL?: string | null }> | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const uids = mode === 'followers' ? await listFollowers(uid) : await listFollowing(uid);
      const people = await Promise.all(uids.map(async (u) => {
        const p = await buddyService.getUserProfile(u).catch(() => null);
        return { uid: u, name: p?.displayName ?? 'Zenith member', photoURL: p?.photoURL };
      }));
      if (!cancelled) setRows(people);
    })();
    return () => { cancelled = true; };
  }, [uid, mode]);

  return (
    <Sheet open onClose={onClose} title={mode === 'followers' ? 'Followers' : 'Following'}>
      {rows === null && <Skeleton className="h-12 w-full" />}
      {rows?.length === 0 && (
        <p className={SUB}>{mode === 'followers' ? 'Nobody yet.' : 'Not following anyone yet.'}</p>
      )}
      {rows && rows.length > 0 && (
        <Card padding="list">
          {rows.map((r) => (
            <ListRow
              key={r.uid}
              leading={<LevelRing size={32} totalVolumeKg={0} photoURL={r.photoURL} name={r.name} />}
              title={r.name}
              onClick={() => onOpen(r.uid)}
            />
          ))}
        </Card>
      )}
    </Sheet>
  );
}
