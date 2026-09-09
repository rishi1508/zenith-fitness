import { useEffect, useRef, useState } from 'react';
import { Camera, Dumbbell, Image as ImageIcon, Trash2 } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useGym } from '../../gym/GymContext';
import * as storage from '../../storage';
import type { GymFeedPost, Workout } from '../../types';
import { createPost, deletePost, getPostImage, listenToFeed, toggleReaction, workoutSummary } from '../../gymFeed';
import { prepareScanImage } from '../../nutrition/scan';
import { capturePhoto, nativePhotoCapture, PhotoCancelled } from '../../nativeCamera';
import { Button, Card, EmptyState, IconButton, Skeleton, useConfirm, useToast, CAPTION, SUB } from '../../ui';

/** The reactions a member can leave. Small set on purpose: a feed with
 *  twenty reactions is a chore, one with three is a nod across the floor. */
const REACTIONS = ['👊', '🔥', '💪'];

/** Photos go in at 720 px — recognisable, and small enough that a post
 *  document stays well under Firestore's 1 MiB ceiling. */
const PHOTO_PX = 720;

function timeAgo(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

/** The most recent completed session, if it was today or yesterday. */
function shareableWorkout(): Workout | null {
  const cutoff = Date.now() - 36 * 3600_000;
  return storage.getWorkouts()
    .filter((w) => w.completed && w.type !== 'rest' && new Date(w.date).getTime() > cutoff)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0] ?? null;
}

/**
 * The gym feed — what the people on the same floor did today, with a
 * fist-bump. Nothing is posted automatically: a member shares a session or
 * a progress photo deliberately, which is also why there is no follower
 * graph to manage. Members of your gym are the graph.
 */
export function GymFeedView() {
  const { gym } = useGym();
  const { user } = useAuth();
  const { showToast } = useToast();
  const { confirm } = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);

  const [posts, setPosts] = useState<GymFeedPost[] | null>(null);
  const [caption, setCaption] = useState('');
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    if (!gym?.id) return;
    return listenToFeed(gym.id, setPosts);
  }, [gym?.id]);

  const recent = shareableWorkout();

  const shareWorkout = async () => {
    if (!gym || !recent) return;
    setPosting(true);
    try {
      await createPost(gym.id, { workout: workoutSummary(recent), text: caption });
      setCaption('');
      showToast('Shared with your gym');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not post that.', 'error');
    } finally {
      setPosting(false);
    }
  };

  const sharePhoto = async (file: Blob | undefined) => {
    if (!gym || !file) return;
    setPosting(true);
    try {
      const { base64 } = await prepareScanImage(file, PHOTO_PX);
      await createPost(gym.id, { imageBase64: base64, text: caption });
      setCaption('');
      showToast('Photo shared');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not post that photo.', 'error');
    } finally {
      setPosting(false);
    }
  };

  const remove = async (post: GymFeedPost) => {
    if (!gym) return;
    const ok = await confirm({ title: 'Delete post?', message: 'It disappears from the gym feed.', confirmLabel: 'Delete', tone: 'danger' });
    if (!ok) return;
    try {
      await deletePost(gym.id, post.id, post.hasImage);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not delete that.', 'error');
    }
  };

  if (!gym) return null;

  return (
    <div className="space-y-3">
      {/* Composer */}
      <Card>
        <span className={CAPTION}>Share with your gym</span>
        <input
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          maxLength={280}
          placeholder="Say something (optional)"
          className="mt-2 w-full h-11 px-3 rounded-control border border-border bg-surface-2 text-text placeholder:text-subtle text-sm outline-none focus:border-accent/50"
        />
        <div className="mt-2 flex gap-2">
          <Button
            variant="secondary" size="md" icon={Dumbbell} full
            disabled={!recent || posting}
            onClick={() => { void shareWorkout(); }}
          >
            {recent ? `Share "${recent.name}"` : 'No recent session'}
          </Button>
          <Button
            variant="secondary" size="md" icon={Camera} full disabled={posting}
            onClick={() => {
              // Same reason as the plate scanner: on Android the file input
              // hands the screen to the camera app and the WebView may not
              // survive it (src/nativeCamera.ts).
              if (!nativePhotoCapture()) { fileRef.current?.click(); return; }
              void capturePhoto('camera')
                .then((blob) => sharePhoto(blob))
                .catch((err) => { if (!(err instanceof PhotoCancelled)) showToast(err instanceof Error ? err.message : 'The camera could not be opened.', 'error'); });
            }}
          >
            Progress photo
          </Button>
        </div>
        <input
          ref={fileRef} type="file" accept="image/*" className="hidden"
          onChange={(e) => { void sharePhoto(e.target.files?.[0]); e.target.value = ''; }}
        />
      </Card>

      {posts === null && <Skeleton className="h-28 w-full" />}

      {posts?.length === 0 && (
        <EmptyState
          icon={ImageIcon}
          title="Nothing here yet"
          body="Share a session or a progress photo and the rest of the gym sees it. Only members of this gym can."
        />
      )}

      {posts?.map((post) => (
        <FeedCard
          key={post.id}
          gymId={gym.id}
          post={post}
          mine={post.uid === user?.uid}
          myUid={user?.uid}
          onReact={(emoji) => { void toggleReaction(gym.id, post.id, emoji).catch(() => showToast('Could not react.', 'error')); }}
          onDelete={() => { void remove(post); }}
        />
      ))}
    </div>
  );
}

function FeedCard({ gymId, post, mine, myUid, onReact, onDelete }: {
  gymId: string;
  post: GymFeedPost;
  mine: boolean;
  myUid?: string;
  onReact: (emoji: string) => void;
  onDelete: () => void;
}) {
  const [image, setImage] = useState<string | null>(null);

  // The photo is a separate read, made only for posts that actually have
  // one and only when this card renders.
  useEffect(() => {
    if (!post.hasImage) return;
    let cancelled = false;
    void getPostImage(gymId, post.id).then((url) => { if (!cancelled) setImage(url); });
    return () => { cancelled = true; };
  }, [gymId, post.hasImage, post.id]);

  const counts = new Map<string, number>();
  for (const emoji of Object.values(post.reactions ?? {})) counts.set(emoji, (counts.get(emoji) ?? 0) + 1);
  const mineEmoji = myUid ? post.reactions?.[myUid] : undefined;

  return (
    <Card>
      <div className="flex items-center gap-2">
        {post.photoURL
          ? <img src={post.photoURL} alt="" className="w-8 h-8 rounded-full object-cover" />
          : <span className="w-8 h-8 rounded-full bg-surface-2 flex items-center justify-center text-xs font-bold text-subtle">{post.name.slice(0, 1)}</span>}
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-semibold text-text truncate">{post.name}</span>
          <span className={`${SUB} block`}>{timeAgo(post.at)}</span>
        </span>
        {mine && <IconButton icon={Trash2} label="Delete post" size="sm" onClick={onDelete} />}
      </div>

      {post.workout && (
        <div className="mt-2 flex items-center gap-2 text-sm">
          <Dumbbell className="w-4 h-4 text-accent shrink-0" strokeWidth={1.75} />
          <span className="font-semibold text-text truncate">{post.workout.name}</span>
          <span className={SUB}>
            {post.workout.sets} sets · {(post.workout.volumeKg / 1000).toFixed(1)} t
            {post.workout.durationMin ? ` · ${post.workout.durationMin} min` : ''}
          </span>
        </div>
      )}

      {post.text && <p className="mt-2 text-sm text-text whitespace-pre-wrap">{post.text}</p>}

      {post.hasImage && (
        !image
          ? <Skeleton className="mt-2 h-56 w-full" />
          : <img src={image} alt={`${post.name}'s progress photo`} className="mt-2 w-full rounded-card object-cover max-h-96" />
      )}

      <div className="mt-2 flex items-center gap-1.5">
        {REACTIONS.map((emoji) => {
          const count = counts.get(emoji) ?? 0;
          const on = mineEmoji === emoji;
          return (
            <button
              key={emoji}
              onClick={() => onReact(emoji)}
              aria-pressed={on}
              className={`min-h-9 px-2.5 rounded-full border text-sm flex items-center gap-1 transition-colors ${
                on ? 'border-accent bg-accent-soft text-accent' : 'border-border text-subtle'
              }`}
            >
              <span aria-hidden="true">{emoji}</span>
              {count > 0 && <span className="text-xs font-semibold tabular-nums">{count}</span>}
            </button>
          );
        })}
      </div>
    </Card>
  );
}
