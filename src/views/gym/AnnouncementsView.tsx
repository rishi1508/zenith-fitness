import { useEffect, useState } from 'react';
import { ArrowLeft, Megaphone, Send } from 'lucide-react';
import type { GymViewProps } from './types';
import type { GymAnnouncement, GymClass } from '../../types';
import { useGym } from '../../gym/GymContext';
import { listenToAnnouncements, listClasses, postAnnouncement } from '../../gymService';
import { formatDateTime } from '../../gymMemberHelpers';
import {  } from '../../components';
import { useToast } from '../../ui';

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
  const { showToast } = useToast();

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

  const handlePost = async () => {
    if (!gym || !text.trim() || posting) return;
    setPosting(true);
    try {
      await postAnnouncement(gym.id, text.trim(), audience === EVERYONE ? 'all' : { classId: audience });
      setText('');
      setAudience(EVERYONE);
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
        <button onClick={onBack} className={`p-2 rounded-lg transition-colors ${isDark ? 'hover:bg-[#222]' : 'hover:bg-gray-50'}`}>
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
              disabled={!text.trim() || posting}
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
            <div key={a.id} className={`rounded-xl border p-4 ${cardBg} ${cardBorder}`}>
              <p className="text-sm whitespace-pre-wrap">{a.text}</p>
              <p className={`text-xs mt-2 ${subtle}`}>{a.byName} · {formatDateTime(a.at)} · {audienceLabel(a.audience)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
