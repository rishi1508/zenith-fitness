import { useState, useEffect, useRef } from 'react';
import {
  ArrowLeft, Send, Dumbbell, Loader2, Smile, Copy, Trash2, X,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { Avatar } from '../components';
import type { ChatMessage } from '../types';
import * as buddyService from '../buddyService';
import * as storage from '../storage';
import { StartSessionModal } from '../components';

interface BuddyChatViewProps {
  chatId: string;
  buddyUid: string;
  buddyName: string;
  buddyPhotoURL?: string | null;
  isDark: boolean;
  onBack: () => void;
  onStartSession: (sessionId: string) => void;
}

export function BuddyChatView({ chatId, buddyUid, buddyName, buddyPhotoURL, isDark, onBack, onStartSession }: BuddyChatViewProps) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  // Multi-select: long-press a message to enter selection mode, then tap to
  // toggle. Copy/Delete act on all selected messages at once. Delete is only
  // available when every selected message belongs to the current user.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showStartSession, setShowStartSession] = useState(false);
  const [buddyTyping, setBuddyTyping] = useState(false);
  const [buddyPresence, setBuddyPresence] = useState<'online' | 'in-workout' | 'offline'>('offline');
  const typingThrottleRef = useRef<number>(0);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const inSelectionMode = selectedIds.size > 0;
  const selectedMessages = messages.filter((m) => selectedIds.has(m.id));
  const allMine = selectedMessages.length > 0 && selectedMessages.every((m) => m.senderId === user?.uid);

  const toggleSelection = (msg: ChatMessage) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(msg.id)) next.delete(msg.id); else next.add(msg.id);
      return next;
    });
  };
  const clearSelection = () => setSelectedIds(new Set());

  // Listen to messages in real-time
  useEffect(() => {
    const unsub = buddyService.listenToMessages(chatId, (msgs) => {
      setMessages(msgs);
      setLoading(false);
    });
    return unsub;
  }, [chatId]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Listen for the buddy's typing activity + presence (lastActive + isWorkingOut).
  useEffect(() => {
    const unsubTyping = buddyService.listenToTyping(chatId, (uids) => {
      setBuddyTyping(uids.has(buddyUid));
    });
    // Refresh presence every 30s from profile. Cheap one-off read.
    let cancelled = false;
    const refreshPresence = async () => {
      const p = await buddyService.getUserProfile(buddyUid);
      if (!cancelled) setBuddyPresence(buddyService.computePresence(p));
    };
    refreshPresence();
    const interval = setInterval(refreshPresence, 30_000);
    return () => {
      cancelled = true;
      unsubTyping();
      clearInterval(interval);
    };
  }, [chatId, buddyUid]);

  // Throttle typing writes so rapid keystrokes produce at most one write
  // every 2 s — plenty to keep the indicator alive (4 s expiry) without
  // spamming Firestore.
  const bumpTyping = () => {
    const now = Date.now();
    if (now - typingThrottleRef.current < 2000) return;
    typingThrottleRef.current = now;
    buddyService.setTypingActive(chatId);
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;

    setInput('');
    setSending(true);
    try {
      await buddyService.sendMessage(chatId, text, 'text', undefined, buddyUid);
    } catch (err) {
      console.error('[Chat] Send failed:', err);
      setInput(text); // Restore on failure
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const sendWorkoutInvite = async () => {
    setSending(true);
    try {
      const plan = storage.getActivePlan();
      const workoutName = plan ? plan.name : 'a workout';
      const exerciseCount = plan?.days?.[0]?.exercises?.length ?? 0;
      await buddyService.sendWorkoutInvite(chatId, workoutName, exerciseCount, buddyUid);
    } catch (err) {
      console.error('[Chat] Invite failed:', err);
    } finally {
      setSending(false);
    }
  };

  // Long-press detection that distinguishes from scrolling: the timer only
  // fires if the finger hasn't moved more than a few px. Any touchmove
  // beyond the threshold cancels the pending long-press so scrolling
  // through the feed never triggers the context menu.
  const longPressStart = useRef<{ x: number; y: number } | null>(null);
  const LONG_PRESS_MOVE_PX = 8;

  const handleLongPressStart = (msg: ChatMessage, e: React.TouchEvent) => {
    const t = e.touches[0];
    longPressStart.current = { x: t.clientX, y: t.clientY };
    longPressTimer.current = setTimeout(() => {
      setSelectedIds(new Set([msg.id]));
    }, 500);
  };

  const handleLongPressMove = (e: React.TouchEvent) => {
    if (!longPressStart.current || !longPressTimer.current) return;
    const t = e.touches[0];
    const dx = t.clientX - longPressStart.current.x;
    const dy = t.clientY - longPressStart.current.y;
    if (Math.hypot(dx, dy) > LONG_PRESS_MOVE_PX) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const handleLongPressEnd = () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = null;
    longPressStart.current = null;
  };

  const handleCopy = async () => {
    if (selectedMessages.length === 0) return;
    const text = selectedMessages
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
      .map((m) => m.text)
      .join('\n');
    try { await navigator.clipboard.writeText(text); } catch { /* ignore */ }
    clearSelection();
  };

  const handleDelete = async () => {
    if (selectedMessages.length === 0) return;
    const myOwn = selectedMessages.filter((m) => m.senderId === user?.uid);
    if (myOwn.length === 0) {
      alert("You can only delete your own messages.");
      return;
    }
    const msg = myOwn.length === selectedMessages.length
      ? `Delete ${myOwn.length} message${myOwn.length === 1 ? '' : 's'}?`
      : `Delete your ${myOwn.length} message${myOwn.length === 1 ? '' : 's'}? (${selectedMessages.length - myOwn.length} not yours will be kept.)`;
    if (!confirm(msg)) return;
    await Promise.all(myOwn.map((m) => buddyService.deleteMessage(chatId, m.id)));
    clearSelection();
  };

  const cardBg = isDark ? 'bg-[#1a1a1a]' : 'bg-white';
  const cardBorder = isDark ? 'border-[#2e2e2e]' : 'border-gray-200';
  const subtleText = isDark ? 'text-zinc-400' : 'text-gray-500';
  const hoverBg = isDark ? 'hover:bg-[#222]' : 'hover:bg-gray-50';

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday = date.toDateString() === yesterday.toDateString();

    const time = date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

    if (isToday) return time;
    if (isYesterday) return `Yesterday ${time}`;
    return `${date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} ${time}`;
  };

  // Group messages by date
  const groupedMessages: { date: string; messages: ChatMessage[] }[] = [];
  let currentDate = '';
  for (const msg of messages) {
    const msgDate = new Date(msg.timestamp).toDateString();
    if (msgDate !== currentDate) {
      currentDate = msgDate;
      groupedMessages.push({ date: msgDate, messages: [msg] });
    } else {
      groupedMessages[groupedMessages.length - 1].messages.push(msg);
    }
  }

  return (
    // h-full fills the scrollable <main> area. Main drops its own padding
    // when this view is active so we can take the full content box without
    // overflowing. We re-apply horizontal padding and a bottom pad that
    // clears the fixed bottom nav (h-20 ≈ 80px).
    <div className="flex flex-col h-full px-4 pt-3 pb-24">
      {/* Chat Header — swapped for the selection-mode action bar when
          one or more messages are selected (long-press → multi-select). */}
      {inSelectionMode ? (
        <div className={`flex flex-col gap-2 pb-3 rounded-lg px-2 py-1.5 ${isDark ? 'bg-orange-500/10' : 'bg-orange-50'}`}>
          <div className="flex items-center gap-2">
            <button
              onClick={clearSelection}
              className={`p-2 rounded-lg transition-colors ${hoverBg}`}
              title="Cancel selection"
            >
              <X className="w-5 h-5" />
            </button>
            <div className="flex-1 text-sm font-semibold text-orange-400">
              {selectedIds.size} selected
            </div>
            <button
              onClick={handleCopy}
              className={`p-2 rounded-lg transition-colors ${isDark ? 'hover:bg-orange-500/20 text-zinc-200' : 'hover:bg-orange-100 text-gray-700'}`}
              title="Copy"
            >
              <Copy className="w-5 h-5" />
            </button>
            <button
              onClick={handleDelete}
              className={`p-2 rounded-lg transition-colors ${isDark ? 'hover:bg-red-500/20 text-red-400' : 'hover:bg-red-50 text-red-600'}`}
              title={allMine ? 'Delete selected' : "Delete (only your own messages will be removed)"}
            >
              <Trash2 className="w-5 h-5" />
            </button>
          </div>
          {/* Reaction picker — only shown when exactly one message is
              selected, since reactions apply per-message. */}
          {selectedIds.size === 1 && (
            <div className="flex items-center justify-center gap-1 px-2">
              {['👍', '❤️', '💪', '🔥', '😂', '😢'].map((emoji) => (
                <button
                  key={emoji}
                  onClick={async () => {
                    const targetId = [...selectedIds][0];
                    await buddyService.toggleMessageReaction(chatId, targetId, emoji);
                    clearSelection();
                  }}
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-base transition-colors ${
                    isDark ? 'hover:bg-orange-500/20' : 'hover:bg-orange-100'
                  }`}
                  title={`React with ${emoji}`}
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-3 pb-3">
          <button onClick={onBack} className={`p-2 rounded-lg transition-colors ${hoverBg}`}>
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <Avatar name={buddyName} photoURL={buddyPhotoURL} size="sm" presence={buddyPresence} />
            <div className="min-w-0">
              <div className="font-semibold text-sm truncate">{buddyName}</div>
              <div className="text-[11px] text-emerald-400 min-h-[14px]">
                {buddyTyping ? 'typing…' : ''}
              </div>
            </div>
          </div>
          <button
            onClick={sendWorkoutInvite}
            disabled={sending}
            className={`p-2 rounded-lg transition-colors ${
              isDark ? 'text-orange-400 bg-orange-500/10 hover:bg-orange-500/20' : 'text-orange-600 bg-orange-50 hover:bg-orange-100'
            } disabled:opacity-50`}
            title="Invite to workout"
          >
            <Dumbbell className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* Messages Area */}
      <div className={`flex-1 overflow-y-auto rounded-xl border p-3 space-y-4 ${cardBg} ${cardBorder}`}>
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="w-5 h-5 animate-spin text-orange-400" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center space-y-2">
            <Smile className={`w-10 h-10 ${subtleText}`} />
            <p className={`text-sm ${subtleText}`}>No messages yet</p>
            <p className={`text-xs ${subtleText}`}>Say hey to your buddy!</p>
          </div>
        ) : (
          groupedMessages.map((group) => (
            <div key={group.date}>
              {/* Date Separator */}
              <div className="flex items-center gap-2 my-3">
                <div className={`flex-1 h-px ${isDark ? 'bg-zinc-800' : 'bg-gray-200'}`} />
                <span className={`text-[10px] font-medium ${subtleText}`}>
                  {(() => {
                    const d = new Date(group.date);
                    const now = new Date();
                    if (d.toDateString() === now.toDateString()) return 'Today';
                    const yesterday = new Date(now);
                    yesterday.setDate(yesterday.getDate() - 1);
                    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
                    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
                  })()}
                </span>
                <div className={`flex-1 h-px ${isDark ? 'bg-zinc-800' : 'bg-gray-200'}`} />
              </div>

              {/* Messages */}
              {group.messages.map((msg) => {
                const isMe = msg.senderId === user?.uid;
                const isInvite = msg.type === 'workout_invite';
                const isUpdate = msg.type === 'workout_update';
                const isSelected = selectedIds.has(msg.id);

                return (
                  <div
                    key={msg.id}
                    onClick={() => { if (inSelectionMode) toggleSelection(msg); }}
                    // WhatsApp-style full-row tint on the selected message
                    // (orange for dark, warmer for light). Covers the entire
                    // row including the gutter, not just the bubble.
                    className={`flex mb-2 -mx-3 px-3 py-0.5 transition-colors ${
                      isMe ? 'justify-end' : 'justify-start'
                    } ${
                      isSelected
                        ? isDark
                          ? 'bg-orange-500/15'
                          : 'bg-orange-100/70'
                        : ''
                    }`}
                  >
                    <div
                      onTouchStart={(e) => handleLongPressStart(msg, e)}
                      onTouchMove={handleLongPressMove}
                      onTouchEnd={handleLongPressEnd}
                      onTouchCancel={handleLongPressEnd}
                      onContextMenu={(e) => { e.preventDefault(); setSelectedIds(new Set([msg.id])); }}
                      className={`max-w-[80%] rounded-2xl px-3.5 py-2 select-none ${
                        isInvite || isUpdate
                          ? isDark
                            ? 'bg-emerald-500/15 border border-emerald-500/30'
                            : 'bg-emerald-50 border border-emerald-200'
                          : isMe
                            ? 'bg-gradient-to-r from-orange-500 to-red-600 text-white'
                            : isDark
                              ? 'bg-zinc-800 text-zinc-100'
                              : 'bg-gray-100 text-gray-900'
                      }`}
                    >
                      {(isInvite || isUpdate) && (
                        <div className={`flex items-center gap-1 mb-1 text-xs font-medium ${
                          isDark ? 'text-emerald-400' : 'text-emerald-600'
                        }`}>
                          <Dumbbell className="w-3 h-3" />
                          {isInvite ? 'Workout Invite' : 'Workout Update'}
                        </div>
                      )}
                      <p className="text-sm leading-relaxed">{msg.text}</p>
                      {isInvite && !isMe && (
                        <button
                          onClick={async () => {
                            try {
                              await buddyService.sendMessage(
                                chatId,
                                `I'm in! Let's do "${msg.workoutData?.workoutName || 'it'}" together!`,
                                'workout_update',
                                undefined,
                                buddyUid,
                              );
                            } catch { /* still proceed */ }
                            setShowStartSession(true);
                          }}
                          className="mt-2 w-full py-1.5 rounded-lg text-xs font-medium bg-emerald-500 text-white hover:bg-emerald-600 transition-colors flex items-center justify-center gap-1"
                        >
                          <Dumbbell className="w-3 h-3" /> Accept & Start
                        </button>
                      )}
                      <p className={`text-[10px] mt-1 ${
                        isMe ? 'text-white/60' : subtleText
                      } text-right`}>
                        {formatTime(msg.timestamp)}
                      </p>
                      {/* Reactions pills — clicking toggles the current
                          user's reaction (remove if already reacted). */}
                      {msg.reactions && Object.keys(msg.reactions).length > 0 && (
                        <div className={`flex flex-wrap gap-1 mt-1 ${isMe ? 'justify-end' : 'justify-start'}`}>
                          {Object.entries(msg.reactions).map(([emoji, uids]) => {
                            const youReacted = user ? uids.includes(user.uid) : false;
                            return (
                              <button
                                key={emoji}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  buddyService.toggleMessageReaction(chatId, msg.id, emoji);
                                }}
                                className={`px-1.5 py-0.5 rounded-full text-[10px] flex items-center gap-0.5 border transition-colors ${
                                  youReacted
                                    ? isDark ? 'bg-orange-500/25 border-orange-500/50 text-orange-200' : 'bg-orange-100 border-orange-300 text-orange-700'
                                    : isDark ? 'bg-zinc-800/80 border-zinc-700 text-zinc-300' : 'bg-white border-gray-200 text-gray-600'
                                }`}
                              >
                                <span>{emoji}</span>
                                <span className="font-semibold">{uids.length}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="pt-3">
        <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border ${cardBg} ${cardBorder}`}>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => { setInput(e.target.value); bumpTyping(); }}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            className={`flex-1 bg-transparent outline-none text-sm ${isDark ? 'placeholder-zinc-600' : 'placeholder-gray-400'}`}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || sending}
            className={`p-2 rounded-lg transition-all ${
              input.trim()
                ? 'bg-gradient-to-r from-orange-500 to-red-600 text-white hover:opacity-90'
                : isDark ? 'bg-zinc-800 text-zinc-600' : 'bg-gray-100 text-gray-400'
            } disabled:opacity-50`}
          >
            {sending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>

      {showStartSession && (
        <StartSessionModal
          buddyUid={buddyUid}
          buddyName={buddyName}
          buddyPhotoURL={buddyPhotoURL || null}
          onClose={() => setShowStartSession(false)}
          onStarted={(sid) => {
            setShowStartSession(false);
            onStartSession(sid);
          }}
        />
      )}
    </div>
  );
}
