import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Camera, Image as ImageIcon, Megaphone, Send, Trash2, X } from 'lucide-react';
import type { GymViewProps } from './types';
import type { GymAnnouncement, GymClass } from '../../types';
import { useGym } from '../../gym/GymContext';
import {
  deleteAnnouncement, getAnnouncementImage, listenToAnnouncements, listClasses, postAnnouncement,
} from '../../gymService';
import { prepareScanImage } from '../../nutrition/scan';
import { capturePhoto, nativePhotoCapture, PhotoCancelled } from '../../nativeCamera';
import { Avatar } from '../../components';
import { formatDateTime } from '../../gymMemberHelpers';
import {  } from '../../components';
import { useConfirm, useToast } from '../../ui';

const EVERYONE = 'all';

/** Reverse-chronological announcements; staff (trainer/manager/owner)
 *  get a composer at the top with an audience picker (everyone or one
 *  class — Tier A still notifies every member either way, see
 *  postAnnouncement's doc comment). */
export function AnnouncementsView({ isDark, onBack }: GymViewProps) {
  const { gym, role } = useGym();
  const [announcements, setAnnouncements] = useState<GymAnnouncement[] | null>(null);
  const [classes, setClasses] = useState<GymClass[]>([]);
  const [text, setText] = useState('');
  const [audience, setAudience] = useState(EVERYONE);
  const [posting, setPosting] = useState(false);
  const [photo, setPhoto] = useState<{ base64: string; preview: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { showToast } = useToast();
  const { confirm } = useConfirm();

  const cardBg = isDark ? 'bg-[#1a1a1a]' : 'bg-white';
  const cardBorder = isDark ? 'border-[#2e2e2e]' : 'border-gray-200';
  const subtle = isDark ? 'text-zinc-500' : 'text-gray-500';
  const isStaff = role === 'trainer' || role === 'manager' || role === 'owner';

  useEffect(() => {
    if (!gym?.id) return;
    return listenToAnnouncements(gym.id, setAnnouncements);
  }, [gym?.id]);

  useEffect(() => {
    if (!gym?.id || !isStaff) return;
    listClasses(gym.id).then(setClasses).catch((err) => console.warn('[Announcements] failed to load classes:', err));
  }, [gym?.id, isStaff]);

  const attach = async (blob: Blob) => {
    try {
      const { base64, preview } = await prepareScanImage(blob, 900);
      setPhoto({ base64, preview: URL.createObjectURL(preview) });
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'That photo could not be used.', 'error');
    }
  };

  /** Camera and gallery, the same two intentions the feed composer offers. */
  const pick = async (source: 'camera' | 'gallery') => {
    if (!nativePhotoCapture()) { fileRef.current?.click(); return; }
    try {
      await attach(await capturePhoto(source));
    } catch (err) {
      if (err instanceof PhotoCancelled) return;
      showToast(err instanceof Error ? err.message : 'The camera could not be opened.', 'error');
    }
  };

  const handlePost = async () => {
    if (!gym || (!text.trim() && !photo) || posting) return;
    setPosting(true);
    try {
      await postAnnouncement(gym.id, text.trim(), audience === EVERYONE ? 'all' : { classId: audience }, photo?.base64);
      setText('');
      setAudience(EVERYONE);
      setPhoto(null);
      showToast('Announcement posted.');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not post announcement.', 'error');
    } finally {
      setPosting(false);
    }
  };

  const audienceLabel = (a: GymAnnouncement['audience']) => {
    if (a === 'all') return 'Everyone';
    const cls = classes.find((c) => c.id === a.classId);
    return cls ? cls.name : 'A class';
  };

  return (
    <div className="space-y-4 animate-fadeIn">
      <div className="flex items-center gap-3">
        <button aria-label="Back" onClick={onBack} className={`p-2 rounded-lg transition-colors ${isDark ? 'hover:bg-[#222]' : 'hover:bg-gray-50'}`}>
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-xl font-bold">Announcements</h1>
      </div>

      {isStaff && (
        <div className={`rounded-xl border p-4 space-y-3 ${cardBg} ${cardBorder}`}>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Write an announcement…"
            rows={3}
            className={`w-full rounded-lg px-3 py-2 text-sm border focus:outline-none focus:border-orange-500 resize-none ${
              isDark ? 'bg-[#0f0f0f] border-[#2e2e2e] text-white placeholder-zinc-600' : 'bg-gray-50 border-gray-200 placeholder-gray-400'
            }`}
          />
          {photo ? (
            <div className="relative">
              <img src={photo.preview} alt="" className="w-full max-h-56 object-cover rounded-lg border border-border" />
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
              <button
                onClick={() => { void pick('camera'); }}
                className={`min-h-10 rounded-lg border text-sm font-medium flex items-center justify-center gap-1.5 ${isDark ? 'border-[#2e2e2e] text-zinc-300' : 'border-gray-200 text-gray-700'}`}
              >
                <Camera className="w-4 h-4" /> Camera
              </button>
              <button
                onClick={() => { void pick('gallery'); }}
                className={`min-h-10 rounded-lg border text-sm font-medium flex items-center justify-center gap-1.5 ${isDark ? 'border-[#2e2e2e] text-zinc-300' : 'border-gray-200 text-gray-700'}`}
              >
                <ImageIcon className="w-4 h-4" /> Gallery
              </button>
            </div>
          )}
          <input
            ref={fileRef} type="file" accept="image/*" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void attach(f); }}
          />

          <div className="flex gap-2">
            <select
              value={audience}
              onChange={(e) => setAudience(e.target.value)}
              className={`flex-1 rounded-lg px-3 py-2 text-sm border focus:outline-none focus:border-orange-500 ${
                isDark ? 'bg-[#0f0f0f] border-[#2e2e2e] text-white' : 'bg-gray-50 border-gray-200'
              }`}
            >
              <option value={EVERYONE}>Everyone</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <button
              onClick={handlePost}
              disabled={(!text.trim() && !photo) || posting}
              className="px-4 rounded-lg text-sm font-semibold bg-gradient-to-r from-orange-500 to-red-600 text-white disabled:opacity-50 flex items-center gap-1.5"
            >
              <Send className="w-4 h-4" /> {posting ? 'Posting…' : 'Post'}
            </button>
          </div>
        </div>
      )}

      {announcements === null ? (
        <div className={`rounded-xl border p-6 text-center text-sm ${cardBg} ${cardBorder} ${subtle}`}>Loading…</div>
      ) : announcements.length === 0 ? (
        <div className={`rounded-xl border p-6 text-center text-sm ${cardBg} ${cardBorder} ${subtle}`}>
          <Megaphone className="w-6 h-6 mx-auto mb-2 opacity-50" />
          Nothing posted yet.
        </div>
      ) : (
        <div className="space-y-2">
          {announcements.map((a) => (
            <AnnouncementCard
              key={a.id}
              gymId={gym!.id}
              announcement={a}
              audience={audienceLabel(a.audience)}
              isDark={isDark}
              canDelete={isStaff}
              onDelete={async () => {
                if (!await confirm({ title: 'Delete announcement?', message: 'Members will no longer see it.', confirmLabel: 'Delete', tone: 'danger' })) return;
                await deleteAnnouncement(gym!.id, a.id, a.hasImage).catch(() => showToast('Could not delete that.', 'error'));
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** One notice: who posted it, the words, the photo if there is one. Built
 *  like a feed post because it is one — the audience just happens to be the
 *  whole gym. */
function AnnouncementCard({ gymId, announcement, audience, isDark, canDelete, onDelete }: {
  gymId: string;
  announcement: GymAnnouncement;
  audience: string;
  isDark: boolean;
  canDelete: boolean;
  onDelete: () => void;
}) {
  const [image, setImage] = useState<string | null>(null);
  useEffect(() => {
    if (!announcement.hasImage) return;
    let cancelled = false;
    void getAnnouncementImage(gymId, announcement.id).then((url) => { if (!cancelled) setImage(url); });
    return () => { cancelled = true; };
  }, [gymId, announcement.hasImage, announcement.id]);

  const cardBg = isDark ? 'bg-[#1a1a1a]' : 'bg-white';
  const cardBorder = isDark ? 'border-[#2e2e2e]' : 'border-gray-200';
  const subtle = isDark ? 'text-zinc-500' : 'text-gray-500';

  return (
    <div className={`rounded-xl border overflow-hidden ${cardBg} ${cardBorder}`}>
      <div className="flex items-center gap-2 px-4 pt-3">
        <Avatar name={announcement.byName} photoURL={announcement.byPhotoURL} size="sm" />
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-semibold truncate">{announcement.byName}</span>
          <span className={`block text-xs truncate ${subtle}`}>{formatDateTime(announcement.at)} · {audience}</span>
        </span>
        {canDelete && (
          <button onClick={onDelete} aria-label="Delete announcement" className={`p-2 shrink-0 ${subtle} hover:text-red-400`}>
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>
      {announcement.text && <p className="px-4 pt-2 text-sm whitespace-pre-wrap break-words">{announcement.text}</p>}
      {announcement.hasImage && (
        image
          ? <img src={image} alt="" className="mt-3 w-full max-h-96 object-cover" />
          : <div className={`mt-3 h-40 w-full animate-pulse ${isDark ? 'bg-[#252525]' : 'bg-gray-100'}`} />
      )}
      <div className="h-3" />
    </div>
  );
}
