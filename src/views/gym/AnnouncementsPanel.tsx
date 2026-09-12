import { useEffect, useRef, useState } from 'react';
import { Camera, Image as ImageIcon, Megaphone, Trash2, X } from 'lucide-react';
import type { GymAnnouncement, GymClass } from '../../types';
import { useAuth } from '../../auth/AuthContext';
import { isAdmin } from '../../admin';
import { useGym } from '../../gym/GymContext';
import {
  deleteAnnouncement, getAnnouncementImage, listenToAnnouncements, listClasses, postAnnouncement,
} from '../../gymService';
import { prepareScanImage } from '../../nutrition/scan';
import { capturePhoto, nativePhotoCapture, PhotoCancelled } from '../../nativeCamera';
import { consumeRestoredPhoto, hasRestoredPhoto } from '../../captureRestore';
import { Avatar } from '../../components';
import { formatDateTime } from '../../gymMemberHelpers';
import { friendlyError } from '../../friendlyError';
import { Button, Card, Chip, EmptyState, Sheet, Skeleton, useConfirm, useToast, CAPTION, SUB } from '../../ui';

const EVERYONE = 'all';

/** 900 px keeps an announcement's image under Firestore's 1 MiB ceiling. */
const PHOTO_PX = 900;

/** Staff post and take down notices — the three gym roles plus a Zenith
 *  admin, which is what firestore.rules allows on announcements. */
function useIsStaff(): boolean {
  const { role } = useGym();
  const { user } = useAuth();
  return role === 'trainer' || role === 'manager' || role === 'owner' || isAdmin(user?.uid);
}

/** Who may take a notice down: its author, a manager or an admin (mirrors firestore.rules). */
function useCanRemove(): (a: GymAnnouncement) => boolean {
  const { role } = useGym();
  const { user } = useAuth();
  return (a) => role === 'manager' || role === 'owner' || isAdmin(user?.uid) || (!!user && a.byUid === user.uid && role === 'trainer');
}

/** Classes, for naming an announcement's audience and for the picker. */
function useClasses(gymId: string | undefined): GymClass[] {
  const [classes, setClasses] = useState<GymClass[]>([]);
  useEffect(() => {
    if (!gymId) return;
    let cancelled = false;
    listClasses(gymId)
      .then((rows) => { if (!cancelled) setClasses(rows); })
      .catch((err) => console.warn('[Announcements] failed to load classes:', err));
    return () => { cancelled = true; };
  }, [gymId]);
  return classes;
}

/**
 * The gym's notices, newest first — shown both under the Feed tab and on the
 * pushed Announcements screen, so there is one list to keep right.
 */
export function AnnouncementsPanel({ onOpenProfile }: { onOpenProfile?: (uid: string) => void } = {}) {
  const { gym } = useGym();
  const { showToast } = useToast();
  const { confirm } = useConfirm();
  const isStaff = useIsStaff();
  const canRemove = useCanRemove();
  const classes = useClasses(gym?.id);
  const [announcements, setAnnouncements] = useState<GymAnnouncement[] | null>(null);

  useEffect(() => {
    if (!gym?.id) return;
    return listenToAnnouncements(gym.id, setAnnouncements);
  }, [gym?.id]);

  if (!gym) return null;

  const audienceLabel = (audience: GymAnnouncement['audience']) => (
    audience === 'all' ? 'Everyone' : classes.find((c) => c.id === audience.classId)?.name ?? 'A class'
  );

  const remove = async (announcement: GymAnnouncement) => {
    const ok = await confirm({
      title: 'Delete announcement?',
      message: 'Members will no longer see it.',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await deleteAnnouncement(gym.id, announcement.id, announcement.hasImage);
    } catch (err) {
      showToast(friendlyError(err, 'Could not delete that.'), 'error');
    }
  };

  if (announcements === null) {
    return <div className="space-y-3"><Skeleton className="h-28 w-full" /><Skeleton className="h-28 w-full" /></div>;
  }

  if (announcements.length === 0) {
    return (
      <EmptyState
        icon={Megaphone}
        title="Nothing posted yet"
        body={isStaff ? 'Post the first notice — every member sees it here.' : "Your gym's notices will show up here."}
      />
    );
  }

  return (
    <div className="space-y-3">
      {announcements.map((a) => (
        <AnnouncementCard
          key={a.id}
          gymId={gym.id}
          announcement={a}
          audience={audienceLabel(a.audience)}
          canDelete={canRemove(a)}
          onOpenProfile={onOpenProfile}
          onDelete={() => { void remove(a); }}
        />
      ))}
    </div>
  );
}

/** One notice: who posted it, the words, the photo if there is one. Built
 *  like a feed post because it is one — the audience just happens to be the
 *  whole gym. */
function AnnouncementCard({ gymId, announcement, audience, canDelete, onDelete, onOpenProfile }: {
  gymId: string;
  announcement: GymAnnouncement;
  audience: string;
  canDelete: boolean;
  onDelete: () => void;
  onOpenProfile?: (uid: string) => void;
}) {
  const [image, setImage] = useState<string | null>(null);

  // The photo is a separate read, made only for notices that have one.
  useEffect(() => {
    if (!announcement.hasImage) return;
    let cancelled = false;
    void getAnnouncementImage(gymId, announcement.id).then((url) => { if (!cancelled) setImage(url); });
    return () => { cancelled = true; };
  }, [gymId, announcement.hasImage, announcement.id]);

  return (
    <Card padding="none" className="overflow-hidden">
      <div className="flex items-center gap-2 px-4 pt-3">
        <button
          onClick={() => onOpenProfile?.(announcement.byUid)}
          aria-label={`${announcement.byName}'s profile`}
          className="flex-1 min-w-0 flex items-center gap-2 text-left"
        >
          <Avatar name={announcement.byName} photoURL={announcement.byPhotoURL} />
          <span className="flex-1 min-w-0">
            <span className="block text-sm font-semibold text-text truncate">{announcement.byName}</span>
            <span className={`${SUB} block truncate`}>{formatDateTime(announcement.at)} · {audience}</span>
          </span>
        </button>
        {canDelete && (
          <button
            onClick={onDelete}
            aria-label="Delete announcement"
            className="w-10 h-10 rounded-control flex items-center justify-center text-subtle hover:text-danger shrink-0"
          >
            <Trash2 className="w-[18px] h-[18px]" strokeWidth={1.75} />
          </button>
        )}
      </div>

      {announcement.text && (
        <p className="px-4 pt-2 text-[15px] leading-[22px] text-text whitespace-pre-wrap break-words">{announcement.text}</p>
      )}

      {announcement.hasImage && (
        image
          ? <img src={image} alt="" className="mt-3 w-full max-h-[420px] object-cover" />
          : <Skeleton className="mt-3 h-56 w-full rounded-none" />
      )}

      <div className="h-3" />
    </Card>
  );
}

// ------------------------------------------------------------------ composer

/** The staff composer, shaped like the feed's: a line you tap, then a sheet.
 *  Renders nothing for a plain member. */
export function AnnouncementComposer({ onPosted }: { onPosted?: () => void } = {}) {
  const { gym } = useGym();
  const { user } = useAuth();
  const isStaff = useIsStaff();
  // Reopens itself when a notice photo came back after Android recycled the
  // app mid-capture (src/captureRestore.ts).
  const [open, setOpen] = useState(() => hasRestoredPhoto('gym-announcement'));

  if (!gym || !isStaff) return null;

  return (
    <>
      <Card padding="md">
        <div className="flex items-center gap-2">
          <Avatar name={user?.displayName || 'You'} photoURL={user?.photoURL} />
          <button
            onClick={() => setOpen(true)}
            className="flex-1 min-w-0 h-10 px-3 rounded-full bg-surface-2 border border-border text-left text-sm text-subtle truncate"
          >
            Post an announcement to {gym.name}
          </button>
        </div>
      </Card>

      {open && (
        <ComposerSheet
          gymId={gym.id}
          onClose={() => setOpen(false)}
          onPosted={() => { setOpen(false); onPosted?.(); }}
        />
      )}
    </>
  );
}

function ComposerSheet({ gymId, onClose, onPosted }: {
  gymId: string;
  onClose: () => void;
  onPosted: () => void;
}) {
  const { showToast } = useToast();
  const classes = useClasses(gymId);
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [audience, setAudience] = useState(EVERYONE);
  const [photo, setPhoto] = useState<{ base64: string; preview: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.preview); }, [photo]);

  const attach = async (blob: Blob) => {
    try {
      const { base64, preview } = await prepareScanImage(blob, PHOTO_PX);
      setPhoto({ base64, preview: URL.createObjectURL(preview) });
    } catch (err) {
      showToast(friendlyError(err, 'That photo could not be used.'), 'error');
    }
  };

  // The shot that survived a restart, attached as if the camera had just returned.
  useEffect(() => {
    const restoredPhoto = consumeRestoredPhoto('gym-announcement');
    if (!restoredPhoto) return;
    const t = window.setTimeout(() => { void attach(restoredPhoto.blob); }, 0);
    return () => window.clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per sheet
  }, []);

  /** Camera and gallery, the same two intentions the feed composer offers. */
  const pick = async (source: 'camera' | 'gallery') => {
    if (!nativePhotoCapture()) { fileRef.current?.click(); return; }
    try {
      await attach(await capturePhoto(source, 'gym-announcement', { gymId }));
    } catch (err) {
      if (err instanceof PhotoCancelled) return;
      showToast(friendlyError(err, 'The camera could not be opened.'), 'error');
    }
  };

  const submit = async () => {
    if (busy) return;
    if (!text.trim() && !photo) { showToast('Add a few words or a photo.', 'error'); return; }
    setBusy(true);
    try {
      await postAnnouncement(gymId, text.trim(), audience === EVERYONE ? 'all' : { classId: audience }, photo?.base64);
      showToast('Announcement posted.');
      onPosted();
    } catch (err) {
      showToast(friendlyError(err, 'Could not post announcement.'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open onClose={onClose} title="New announcement">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        autoFocus
        placeholder="What should the gym know?"
        className="w-full px-3 py-2.5 rounded-control border border-border bg-surface-2 text-text placeholder:text-subtle text-sm outline-none focus:border-accent/50 resize-none"
      />

      {photo ? (
        <div className="relative">
          <img src={photo.preview} alt="" className="w-full max-h-64 object-cover rounded-card border border-border" />
          <button
            onClick={() => setPhoto(null)}
            aria-label="Remove photo"
            className="absolute top-2 right-2 w-10 h-10 rounded-full bg-black/70 text-white flex items-center justify-center"
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

      {/* Everyone, or one class — chips rather than a select, so the choice is
          visible without opening anything. */}
      <div className="space-y-1.5">
        <span className={CAPTION}>Who sees it</span>
        <div className="flex flex-wrap gap-2">
          <Chip size="lg" on={audience === EVERYONE} onClick={() => setAudience(EVERYONE)}>Everyone</Chip>
          {classes.filter((c) => c.active).map((c) => (
            <Chip key={c.id} size="lg" on={audience === c.id} onClick={() => setAudience(c.id)}>{c.name}</Chip>
          ))}
        </div>
      </div>

      <Button variant="primary" size="lg" full disabled={busy} onClick={() => { void submit(); }}>
        {busy ? 'Posting…' : 'Post'}
      </Button>
    </Sheet>
  );
}
