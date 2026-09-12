import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { MessageCircle, Send, X } from 'lucide-react';
import type { GymFeedComment, GymFeedPost } from '../../types';
import { useAuth } from '../../auth/AuthContext';
import { addComment, getPostImage, listComments, toggleReaction } from '../../gymFeed';
import { Skeleton, SUB } from '../../ui';
import { registerBackHandler } from '../../backHandlerRegistry';

const REACTIONS = ['👊', '🔥', '💪'];

/**
 * One photo, full width, with its reactions and comments underneath — the
 * same post the feed shows, opened from the profile grid.
 */
export function PhotoViewer({ gymId, post, onClose }: { gymId: string; post: GymFeedPost; onClose: () => void }) {
  const { user } = useAuth();
  const [src, setSrc] = useState<string | null>(null);
  const [comments, setComments] = useState<GymFeedComment[] | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [reactions, setReactions] = useState<Record<string, string>>(post.reactions ?? {});

  useEffect(() => {
    let cancelled = false;
    void getPostImage(gymId, post.id).then((url) => { if (!cancelled) setSrc(url); });
    void listComments(gymId, post.id).then((rows) => { if (!cancelled) setComments(rows); }).catch(() => {
      if (!cancelled) setComments([]);
    });
    return () => { cancelled = true; };
  }, [gymId, post.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    // The phone's back button closes it too — every other overlay in the app
    // registers here, and one that does not is a trap.
    const unregister = registerBackHandler(() => { onClose(); return true; });
    return () => { window.removeEventListener('keydown', onKey); unregister(); };
  }, [onClose]);

  const react = (emoji: string) => {
    const mine = user ? reactions[user.uid] : undefined;
    setReactions((prev) => {
      const next = { ...prev };
      if (!user) return next;
      if (mine === emoji) delete next[user.uid];
      else next[user.uid] = emoji;
      return next;
    });
    void toggleReaction(gymId, post.id, emoji).catch(() => {});
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const c = await addComment(gymId, post.id, text);
      setComments((prev) => [...(prev ?? []), c]);
      setDraft('');
    } finally {
      setSending(false);
    }
  };

  const counts = new Map<string, number>();
  for (const emoji of Object.values(reactions)) counts.set(emoji, (counts.get(emoji) ?? 0) + 1);
  const mineEmoji = user ? reactions[user.uid] : undefined;

  // Portaled: rendered inside the profile it would sit inside the shell's
  // scroll content, and a rubber-band pull transforms that content — which
  // re-anchors a fixed element to it. Full screen means a child of <body>.
  return createPortal(
    <div className="fixed inset-0 z-[120] flex flex-col bg-bg" role="dialog" aria-modal="true" aria-label="Photo">
      <div
        className="flex-none flex items-center gap-2 px-4 pb-2"
        style={{ paddingTop: 'calc(var(--top-inset) + 14px)' }}
      >
        <button onClick={onClose} aria-label="Close" className="w-9 h-9 rounded-full flex items-center justify-center text-text">
          <X className="w-5 h-5" strokeWidth={2} />
        </button>
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-semibold text-text truncate">{post.name}</span>
          <span className={`${SUB} block truncate`}>
            {new Date(post.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
          </span>
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {src ? <img src={src} alt="" className="w-full object-contain" /> : <Skeleton className="h-72 w-full rounded-none" />}

        {post.text && <p className="px-4 pt-3 text-[15px] leading-[22px] text-text whitespace-pre-wrap">{post.text}</p>}

        <div className="px-4 py-3 flex items-center gap-1.5">
          {REACTIONS.map((emoji) => {
            const count = counts.get(emoji) ?? 0;
            const on = mineEmoji === emoji;
            return (
              <button
                key={emoji}
                onClick={() => react(emoji)}
                aria-pressed={on}
                aria-label={`React ${emoji}`}
                className={`h-9 px-2.5 rounded-full border text-sm flex items-center gap-1 ${
                  on ? 'border-accent bg-accent-soft text-accent' : 'border-border text-subtle'
                }`}
              >
                <span aria-hidden="true">{emoji}</span>
                {count > 0 && <span className="text-xs font-semibold tabular-nums">{count}</span>}
              </button>
            );
          })}
          <span className={`${SUB} ml-auto flex items-center gap-1`}>
            <MessageCircle className="w-4 h-4" strokeWidth={1.75} />
            {comments?.length ?? post.commentCount ?? 0}
          </span>
        </div>

        <div className="px-4 pb-4 space-y-2 border-t border-border pt-3">
          {comments === null && <Skeleton className="h-8 w-full" />}
          {comments?.length === 0 && <p className={SUB}>No comments yet.</p>}
          {comments?.map((c) => (
            <p key={c.id} className="text-[13px] leading-[19px] text-text break-words">
              <span className="font-semibold">{c.name}</span> <span className="text-muted">{c.text}</span>
            </p>
          ))}
        </div>
      </div>

      <div
        className="flex-none flex items-center gap-2 px-4 pt-2 border-t border-border"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)' }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void send(); }}
          maxLength={500}
          placeholder="Add a comment…"
          aria-label="Add a comment"
          className="flex-1 min-w-0 h-11 px-3 rounded-full border border-border bg-surface-2 text-text placeholder:text-subtle text-sm outline-none focus:border-accent/50"
        />
        <button
          onClick={() => { void send(); }}
          disabled={!draft.trim() || sending}
          aria-label="Send comment"
          className="w-11 h-11 rounded-full bg-accent text-white flex items-center justify-center shrink-0 disabled:opacity-40"
        >
          <Send className="w-4 h-4" strokeWidth={2} />
        </button>
      </div>
    </div>,
    document.body,
  );
}
