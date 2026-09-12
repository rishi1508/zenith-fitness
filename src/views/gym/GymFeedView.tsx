import { useEffect, useRef, useState } from 'react';
import {
  Camera, Dumbbell, Flame, Image as ImageIcon, MessageCircle, PenLine, Send, Timer, Trash2, Trophy, Weight, X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { isAdmin } from '../../admin';
import { useGym } from '../../gym/GymContext';
import * as storage from '../../storage';
import type { GymFeedComment, GymFeedPost, Workout } from '../../types';
import {
  addComment, createPost, deletePost, getPostImage, listComments, listenToFeed, toggleReaction, workoutSummary,
} from '../../gymFeed';
import { listenToAnnouncements } from '../../gymService';
import { announcementsSeenKey } from '../../gym/announcementsSeen';
import { prepareScanImage } from '../../nutrition/scan';
import { capturePhoto, nativePhotoCapture, PhotoCancelled } from '../../nativeCamera';
import { consumeRestoredPhoto, hasRestoredPhoto } from '../../captureRestore';
import { Button, Card, EmptyState, SegmentedControl, Sheet, Skeleton, useConfirm, useToast, CAPTION, SUB } from '../../ui';
import { getUserProfile } from '../../buddyService';
import { AnnouncementComposer, AnnouncementsPanel } from './AnnouncementsPanel';
import { friendlyError } from '../../friendlyError';

/** Three reactions, not twenty: a nod across the floor, not a taxonomy. */
const REACTIONS = ['👊', '🔥', '💪'];

/** 900 px keeps a post document well under Firestore's 1 MiB ceiling. */
const PHOTO_PX = 900;

function timeAgo(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

/** The most recent completed session, if it was today or yesterday. */
function shareableWorkouts(): Workout[] {
  const cutoff = Date.now() - 36 * 3600_000;
  return storage.getWorkouts()
    .filter((w) => w.completed && w.type !== 'rest' && new Date(w.date).getTime() > cutoff)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 5);
}

type Composing = 'text' | 'photo' | 'workout' | null;

type FeedTab = 'public' | 'announcements';

/** Survives the feed unmounting while a gym sub-screen is open, the way
 *  GymHomeView remembers its segment. */
let lastTab: FeedTab = 'public';

const seenKey = announcementsSeenKey;

function readSeen(gymId: string): string {
  try {
    return localStorage.getItem(seenKey(gymId)) ?? '';
  } catch {
    return '';
  }
}

/**
 * The gym feed — what the people on the same floor did today.
 *
 * Modelled on Strava's athlete posts rather than a workout-only wall: every
 * post is the member's own words, optionally carrying a session, a photo, a
 * PR or an achievement. Nothing posts itself; sharing is always a tap.
 */
export function GymFeedView({ onOpenProfile }: { onOpenProfile?: (uid: string) => void } = {}) {
  const { gym, role, unseenAnnouncements, markAnnouncementsSeen } = useGym();
  const { user } = useAuth();
  const { showToast } = useToast();
  const { confirm } = useConfirm();

  const [posts, setPosts] = useState<GymFeedPost[] | null>(null);
  // A photo taken for the feed just before Android recycled the app comes
  // back here (src/captureRestore.ts): reopen the photo composer with it.
  const [composing, setComposing] = useState<Composing>(() => (hasRestoredPhoto('gym-feed') ? 'photo' : null));
  const [tab, setTabState] = useState<FeedTab>(() => (hasRestoredPhoto('gym-announcement') ? 'announcements' : lastTab));
  const tabRef = useRef<FeedTab>(lastTab);
  const [newestNotice, setNewestNotice] = useState<string | null>(null);
  const [seenNotice, setSeenNotice] = useState(() => (gym ? readSeen(gym.id) : ''));

  /** Looking at the tab is what marks a notice seen — on this device only. */
  const markSeen = (gymId: string, at: string | null) => {
    if (!at) return;
    try { localStorage.setItem(seenKey(gymId), at); } catch { /* quota ignore */ }
    setSeenNotice(at);
  };

  const setTab = (next: FeedTab) => {
    lastTab = next;
    tabRef.current = next;
    setTabState(next);
    if (next === 'announcements' && gym) { markSeen(gym.id, newestNotice); markAnnouncementsSeen(); }
  };

  useEffect(() => {
    if (!gym?.id) return;
    return listenToFeed(gym.id, setPosts);
  }, [gym?.id]);

  // One document, just to know whether there is something new to look at. A
  // notice that lands while the tab is open counts as seen straight away.
  useEffect(() => {
    if (!gym?.id) return;
    const gymId = gym.id;
    return listenToAnnouncements(gymId, (rows) => {
      const at = rows[0]?.at ?? null;
      setNewestNotice(at);
      if (tabRef.current === 'announcements') { markSeen(gymId, at); markAnnouncementsSeen(); }
    }, 1);
  // markAnnouncementsSeen is recreated as notices arrive; the listener only needs the gym.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gym?.id]);

  // Staff and Zenith admins can take down anything; rules agree.
  const canModerate = role === 'owner' || role === 'manager' || role === 'trainer' || isAdmin(user?.uid);

  const remove = async (post: GymFeedPost) => {
    if (!gym) return;
    const mine = post.uid === user?.uid;
    const ok = await confirm({
      title: mine ? 'Delete post?' : `Remove ${post.name}'s post?`,
      message: mine
        ? 'It disappears from the gym feed.'
        : 'It disappears from the gym feed for everyone. They are not told who removed it.',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await deletePost(gym.id, post.id, post.hasImage);
    } catch (err) {
      showToast(friendlyError(err, 'Could not delete that.'), 'error');
    }
  };

  // Sitting on the tab while notices arrive (or landing on it directly)
  // counts as seeing them — the badge must never outlive the open tab.
  useEffect(() => {
    if (tab === 'announcements' && unseenAnnouncements > 0) markAnnouncementsSeen();
  }, [tab, unseenAnnouncements, markAnnouncementsSeen]);

  if (!gym) return null;

  const unseenNotice = tab !== 'announcements' && !!newestNotice && newestNotice > seenNotice;
  const unseenCount = tab !== 'announcements' ? unseenAnnouncements : 0;

  return (
    <div className="space-y-3">
      <SegmentedControl
        label="Feed section"
        options={[
          { value: 'public', label: 'Public feed' },
          {
            value: 'announcements',
            label: (
              <span className="inline-flex items-center gap-1.5">
                Announcements
                {unseenCount > 0 ? (
                  <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-accent text-white text-[11px] font-bold leading-[18px] text-center shrink-0" aria-label={`${unseenCount} new`}>
                    {unseenCount > 9 ? '9+' : unseenCount}
                  </span>
                ) : unseenNotice ? (
                  <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" aria-label="new" />
                ) : null}
              </span>
            ),
          },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'announcements' ? (
        <>
          <AnnouncementComposer />
          <AnnouncementsPanel onOpenProfile={onOpenProfile} />
        </>
      ) : (
        <>
          {/* Composer: three ways in, each one a chip that fits. */}
          <Card padding="md">
            <div className="flex items-center gap-2">
              <Avatar name={user?.displayName || 'You'} photoURL={user?.photoURL} />
              <button
                onClick={() => setComposing('text')}
                className="flex-1 min-w-0 h-10 px-3 rounded-full bg-surface-2 border border-border text-left text-sm text-subtle truncate"
              >
                Share something with {gym.name}
              </button>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <ComposerChip icon={Dumbbell} label="Session" onClick={() => setComposing('workout')} />
              <ComposerChip icon={Camera} label="Photo" onClick={() => setComposing('photo')} />
              <ComposerChip icon={PenLine} label="Post" onClick={() => setComposing('text')} />
            </div>
          </Card>

          {posts === null && <><Skeleton className="h-40 w-full" /><Skeleton className="h-40 w-full" /></>}

          {posts?.length === 0 && (
            <EmptyState
              icon={ImageIcon}
              title="Nothing here yet"
              body="Share a session, a progress photo or just how training is going. Only members of this gym can see it."
            />
          )}

          {posts?.map((post) => (
            <PostCard
              key={post.id}
              gymId={gym.id}
              post={post}
              myUid={user?.uid}
              mine={post.uid === user?.uid}
              canModerate={canModerate}
              onOpenProfile={onOpenProfile}
              onReact={(emoji) => {
                void toggleReaction(gym.id, post.id, emoji).catch(() => showToast('Could not react.', 'error'));
              }}
              onDelete={() => { void remove(post); }}
            />
          ))}

          {composing && (
            <ComposerSheet
              gymId={gym.id}
              mode={composing}
              onClose={() => setComposing(null)}
              onPosted={() => { setComposing(null); showToast(`Shared with ${gym.name}`); }}
            />
          )}
        </>
      )}
    </div>
  );
}

function ComposerChip({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="min-h-10 px-2 rounded-control border border-border flex items-center justify-center gap-1.5 text-[13px] font-semibold text-muted hover:text-text hover:border-accent/40 transition-colors"
    >
      <Icon className="w-4 h-4 shrink-0 text-accent" strokeWidth={1.75} />
      <span className="truncate">{label}</span>
    </button>
  );
}

// ------------------------------------------------------------------ composer

function ComposerSheet({ gymId, mode, onClose, onPosted }: {
  gymId: string;
  mode: Exclude<Composing, null>;
  onClose: () => void;
  onPosted: () => void;
}) {
  const { showToast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [photo, setPhoto] = useState<{ base64: string; preview: string } | null>(null);
  const [workout, setWorkout] = useState<Workout | null>(() => (mode === 'workout' ? shareableWorkouts()[0] ?? null : null));
  const recent = mode === 'workout' ? shareableWorkouts() : [];

  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.preview); }, [photo]);

  const attach = async (blob: Blob) => {
    try {
      const { base64, preview } = await prepareScanImage(blob, PHOTO_PX);
      setPhoto({ base64, preview: URL.createObjectURL(preview) });
    } catch (err) {
      showToast(friendlyError(err, 'That photo could not be used.'), 'error');
    }
  };

  // The shot that survived a restart, attached as if the camera had just
  // returned. Deferred a tick so the sheet paints first.
  useEffect(() => {
    if (mode !== 'photo') return;
    const restoredPhoto = consumeRestoredPhoto('gym-feed');
    if (!restoredPhoto) return;
    const t = window.setTimeout(() => { void attach(restoredPhoto.blob); }, 0);
    return () => window.clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per sheet
  }, [mode]);

  /** Camera and gallery are separate on purpose — "take a photo" and "choose
   *  one I already have" are different intentions, and the second was missing. */
  const pick = async (source: 'camera' | 'gallery') => {
    if (!nativePhotoCapture()) { fileRef.current?.click(); return; }
    try {
      await attach(await capturePhoto(source, 'gym-feed', { gymId }));
    } catch (err) {
      if (err instanceof PhotoCancelled) return;
      showToast(friendlyError(err, 'The camera could not be opened.'), 'error');
    }
  };

  const submit = async () => {
    if (busy) return;
    if (!text.trim() && !photo && !workout) { showToast('Add a few words, a photo or a session.', 'error'); return; }
    setBusy(true);
    try {
      await createPost(gymId, {
        text,
        ...(workout ? { workout: workoutSummary(workout) } : {}),
        ...(photo ? { imageBase64: photo.base64 } : {}),
      });
      onPosted();
    } catch (err) {
      showToast(friendlyError(err, 'Could not post that.'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const title = mode === 'workout' ? 'Share a session' : mode === 'photo' ? 'Share a photo' : 'Write a post';

  return (
    <Sheet open onClose={onClose} title={title}>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={500}
        rows={3}
        autoFocus={mode === 'text'}
        placeholder={mode === 'workout' ? 'How did it go? (optional)' : "What's happening?"}
        className="w-full px-3 py-2.5 rounded-control border border-border bg-surface-2 text-text placeholder:text-subtle text-sm outline-none focus:border-accent/50 resize-none"
      />

      {mode === 'workout' && (
        recent.length === 0 ? (
          <p className={SUB}>No session in the last day and a half. Log one and it will show up here.</p>
        ) : (
          <div className="space-y-1.5">
            <span className={CAPTION}>Session</span>
            {recent.map((w) => (
              <button
                key={w.id}
                onClick={() => setWorkout(w)}
                className={`w-full min-h-12 px-3 rounded-control border text-left flex items-center gap-2 ${
                  workout?.id === w.id ? 'border-accent bg-accent-soft' : 'border-border'
                }`}
              >
                <Dumbbell className="w-4 h-4 text-accent shrink-0" strokeWidth={1.75} />
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-semibold text-text truncate">{w.name}</span>
                  <span className={`${SUB} block truncate`}>
                    {new Date(w.date).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}
                    {w.duration ? ` · ${w.duration} min` : ''}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )
      )}

      {photo ? (
        <div className="relative">
          <img src={photo.preview} alt="" className="w-full max-h-64 object-cover rounded-card border border-border" />
          <button
            onClick={() => setPhoto(null)}
            aria-label="Remove photo"
            className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/70 text-white flex items-center justify-center"
          >
            <X className="w-4 h-4" strokeWidth={2} />
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" size="md" icon={Camera} full onClick={() => { void pick('camera'); }}>Camera</Button>
          <Button variant="secondary" size="md" icon={ImageIcon} full onClick={() => { void pick('gallery'); }}>Gallery</Button>
        </div>
      )}
      <input
        ref={fileRef} type="file" accept="image/*" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void attach(f); }}
      />

      <Button variant="primary" size="lg" full disabled={busy} onClick={() => { void submit(); }}>
        {busy ? 'Sharing…' : 'Share'}
      </Button>
    </Sheet>
  );
}

// ---------------------------------------------------------------- post card

function PostCard({ gymId, post, mine, canModerate, myUid, onReact, onDelete, onOpenProfile }: {
  onOpenProfile?: (uid: string) => void;
  gymId: string;
  post: GymFeedPost;
  mine: boolean;
  /** Gym staff or a Zenith admin — may remove somebody else's post. */
  canModerate: boolean;
  myUid?: string;
  onReact: (emoji: string) => void;
  onDelete: () => void;
}) {
  const [image, setImage] = useState<string | null>(null);
  const [comments, setComments] = useState<GymFeedComment[] | null>(null);
  const [showComments, setShowComments] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [whoReacted, setWhoReacted] = useState<string | null>(null);
  const holdRef = useRef<number | null>(null);
  /** Set by a completed hold, so the release does not also toggle. */
  const heldRef = useRef(false);

  // The photo is a separate read, made only for posts that have one and only
  // when this card renders.
  useEffect(() => {
    if (!post.hasImage) return;
    let cancelled = false;
    void getPostImage(gymId, post.id).then((url) => { if (!cancelled) setImage(url); });
    return () => { cancelled = true; };
  }, [gymId, post.hasImage, post.id]);

  useEffect(() => {
    if (!showComments) return;
    let cancelled = false;
    void listComments(gymId, post.id).then((rows) => { if (!cancelled) setComments(rows); }).catch(() => {
      if (!cancelled) setComments([]);
    });
    return () => { cancelled = true; };
  }, [showComments, gymId, post.id]);

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const comment = await addComment(gymId, post.id, text);
      setComments((prev) => [...(prev ?? []), comment]);
      setDraft('');
    } finally {
      setSending(false);
    }
  };

  const counts = new Map<string, number>();
  for (const emoji of Object.values(post.reactions ?? {})) counts.set(emoji, (counts.get(emoji) ?? 0) + 1);
  const mineEmoji = myUid ? post.reactions?.[myUid] : undefined;
  const commentCount = post.commentCount ?? 0;

  return (
    <Card padding="none" className="overflow-hidden">
      {/* Head */}
      <div className="flex items-center gap-2 px-4 pt-3">
        <button onClick={() => onOpenProfile?.(post.uid)} aria-label={`${post.name}'s profile`} className="shrink-0">
          <Avatar name={post.name} photoURL={post.photoURL} />
        </button>
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-semibold text-text truncate">{post.name}</span>
          <span className={`${SUB} block truncate`}>{headline(post)} · {timeAgo(post.at)}</span>
        </span>
        {(mine || canModerate) && (
          <button
            onClick={onDelete}
            aria-label={mine ? 'Delete post' : `Remove ${post.name}'s post`}
            title={mine ? 'Delete' : 'Remove as staff'}
            className="w-9 h-9 rounded-control flex items-center justify-center text-subtle hover:text-danger shrink-0"
          >
            <Trash2 className="w-[18px] h-[18px]" strokeWidth={1.75} />
          </button>
        )}
      </div>

      {post.text && <p className="px-4 pt-2 text-[15px] leading-[22px] text-text whitespace-pre-wrap break-words">{post.text}</p>}

      {post.workout && (
        <div className="mx-4 mt-3 rounded-card border border-border bg-surface-2 overflow-hidden">
          <div className="flex items-center gap-2 px-3 pt-2.5 min-w-0">
            <Dumbbell className="w-4 h-4 text-accent shrink-0" strokeWidth={1.75} />
            <span className="min-w-0 flex-1 text-sm font-bold text-text truncate">{post.workout.name}</span>
          </div>
          <div className="grid grid-cols-4 gap-px px-3 py-2.5">
            <Metric icon={Weight} value={`${(post.workout.volumeKg / 1000).toFixed(1)} t`} label="volume" />
            <Metric icon={Dumbbell} value={String(post.workout.sets)} label="sets" />
            <Metric icon={Timer} value={post.workout.durationMin ? `${post.workout.durationMin}m` : '—'} label="time" />
            <Metric icon={Flame} value={post.workout.kcal ? String(post.workout.kcal) : '—'} label="kcal" />
          </div>
          {!!post.workout.prs && (
            <div className="px-3 pb-2.5 flex items-center gap-1.5 text-xs font-semibold text-warn">
              <Trophy className="w-3.5 h-3.5 shrink-0" strokeWidth={2} />
              {post.workout.prs} personal record{post.workout.prs === 1 ? '' : 's'}
            </div>
          )}
        </div>
      )}

      {post.pr && (
        <div className="mx-4 mt-3 rounded-card border border-warn/40 bg-warn/10 px-3 py-2.5 flex items-center gap-2">
          <Trophy className="w-4 h-4 text-warn shrink-0" strokeWidth={2} />
          <span className="text-sm font-semibold text-text truncate">
            {post.pr.exercise} — {post.pr.weight} kg × {post.pr.reps}
          </span>
        </div>
      )}

      {post.achievement && (
        <div className="mx-4 mt-3 rounded-card border border-accent/40 bg-accent-soft px-3 py-2.5">
          <span className="text-sm font-semibold text-text">{post.achievement.label}</span>
          {post.achievement.detail && <span className={`${SUB} block`}>{post.achievement.detail}</span>}
        </div>
      )}

      {post.hasImage && (
        image
          ? <img src={image} alt={`Shared by ${post.name}`} className="mt-3 w-full max-h-[420px] object-cover" />
          : <Skeleton className="mt-3 h-56 w-full rounded-none" />
      )}

      {/* Reactions + comments */}
      <div className="px-4 py-2.5 flex items-center gap-1.5">
        {REACTIONS.map((emoji) => {
          const count = counts.get(emoji) ?? 0;
          const on = mineEmoji === emoji;
          return (
            <button
              key={emoji}
              onClick={() => { if (!heldRef.current) onReact(emoji); heldRef.current = false; }}
              // Hold to see who — a count with no names is a dead end.
              onPointerDown={() => {
                if (count === 0) return;
                holdRef.current = window.setTimeout(() => { heldRef.current = true; setWhoReacted(emoji); }, 400);
              }}
              onPointerUp={() => { if (holdRef.current) { clearTimeout(holdRef.current); holdRef.current = null; } }}
              onPointerLeave={() => { if (holdRef.current) { clearTimeout(holdRef.current); holdRef.current = null; } }}
              onContextMenu={(e) => e.preventDefault()}
              aria-pressed={on}
              aria-label={`React ${emoji}${count > 0 ? ` — hold to see who` : ''}`}
              className={`h-9 px-2.5 rounded-full border text-sm flex items-center gap-1 shrink-0 transition-colors ${
                on ? 'border-accent bg-accent-soft text-accent' : 'border-border text-subtle'
              }`}
            >
              <span aria-hidden="true">{emoji}</span>
              {count > 0 && <span className="text-xs font-semibold tabular-nums">{count}</span>}
            </button>
          );
        })}
        <button
          onClick={() => setShowComments((v) => !v)}
          className="ml-auto h-9 px-2.5 rounded-full border border-border text-subtle text-sm flex items-center gap-1.5 shrink-0"
        >
          <MessageCircle className="w-4 h-4" strokeWidth={1.75} />
          {commentCount > 0 && <span className="text-xs font-semibold tabular-nums">{commentCount}</span>}
        </button>
      </div>

      {whoReacted && (
        <ReactedBySheet
          emoji={whoReacted}
          uids={Object.entries(post.reactions ?? {}).filter(([, e]) => e === whoReacted).map(([uid]) => uid)}
          onClose={() => setWhoReacted(null)}
        />
      )}

      {showComments && (
        <div className="px-4 pb-3 space-y-2 border-t border-border pt-2.5">
          {comments === null && <Skeleton className="h-8 w-full" />}
          {comments?.length === 0 && <p className={SUB}>No comments yet.</p>}
          {comments?.map((c) => (
            <div key={c.id} className="flex items-start gap-2">
              <Avatar name={c.name} photoURL={c.photoURL} small />
              <p className="flex-1 min-w-0 text-[13px] leading-[19px] text-text break-words">
                <span className="font-semibold">{c.name}</span>{' '}
                <span className="text-muted">{c.text}</span>
              </p>
            </div>
          ))}
          <div className="flex items-center gap-2 pt-1">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void send(); }}
              maxLength={500}
              placeholder="Add a comment…"
              aria-label="Add a comment"
              className="flex-1 min-w-0 h-10 px-3 rounded-full border border-border bg-surface-2 text-text placeholder:text-subtle text-sm outline-none focus:border-accent/50"
            />
            <button
              onClick={() => { void send(); }}
              disabled={!draft.trim() || sending}
              aria-label="Send comment"
              className="w-10 h-10 rounded-full bg-accent text-white flex items-center justify-center shrink-0 disabled:opacity-40"
            >
              <Send className="w-4 h-4" strokeWidth={2} />
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}

/** "did Push Day" / "shared a photo" — the line under the name. */
function headline(post: GymFeedPost): string {
  switch (post.kind) {
    case 'workout': return `did ${post.workout?.name ?? 'a session'}`;
    case 'pr': return 'hit a personal record';
    case 'achievement': return 'unlocked something';
    case 'photo': return 'shared a photo';
    default: return 'posted';
  }
}

function Metric({ icon: Icon, value, label }: { icon: LucideIcon; value: string; label: string }) {
  return (
    <div className="min-w-0 flex flex-col items-center text-center">
      <Icon className="w-3.5 h-3.5 text-subtle mb-0.5" strokeWidth={1.75} />
      <span className="text-sm font-bold text-text tabular-nums truncate w-full">{value}</span>
      <span className="text-[10px] text-subtle truncate w-full">{label}</span>
    </div>
  );
}

/** Class names are written out, not composed — Tailwind only ships the
 *  utilities it can see in the source. */
function Avatar({ name, photoURL, small }: { name: string; photoURL?: string | null; small?: boolean }) {
  // A Google avatar URL can 403 once the token behind it rotates, which left
  // a broken-image glyph in the feed. Fall back to the initial when it does.
  const [failed, setFailed] = useState(false);
  const cls = `${small ? 'w-7 h-7' : 'w-9 h-9'} rounded-full shrink-0`;
  if (photoURL && !failed) {
    return <img src={photoURL} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} className={`${cls} object-cover`} />;
  }
  return (
    <span className={`${cls} bg-surface-2 border border-border flex items-center justify-center ${small ? 'text-[10px]' : 'text-xs'} font-bold text-subtle`}>
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

/** Everyone who left this reaction. Names resolved on open — a few profile
 *  reads, and only when somebody actually asks who. */
function ReactedBySheet({ emoji, uids, onClose }: { emoji: string; uids: string[]; onClose: () => void }) {
  const [rows, setRows] = useState<Array<{ uid: string; name: string; photoURL?: string | null }> | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all(uids.map(async (uid) => {
      const p = await getUserProfile(uid).catch(() => null);
      return { uid, name: p?.displayName ?? 'A member', photoURL: p?.photoURL };
    })).then((people) => { if (!cancelled) setRows(people); });
    return () => { cancelled = true; };
  }, [uids]);

  return (
    <Sheet open onClose={onClose} title={`${emoji}  ${uids.length} ${uids.length === 1 ? 'person' : 'people'}`}>
      {rows === null && <Skeleton className="h-12 w-full" />}
      {rows?.map((r) => (
        <div key={r.uid} className="flex items-center gap-2.5 min-h-12">
          <Avatar name={r.name} photoURL={r.photoURL} small />
          <span className="text-sm font-semibold text-text truncate">{r.name}</span>
        </div>
      ))}
    </Sheet>
  );
}
