import { useState, useEffect, useRef } from 'react';
import {
  ArrowLeft, Send, Dumbbell, Loader2, Smile, Copy, Trash2, X,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { Avatar } from '../components';
import type { ChatMessage } from '../types';
import * as buddyService from '../buddyService';
import * as sessionService from '../workoutSessionService';
import * as storage from '../storage';

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
  const [selectedMsg, setSelectedMsg] = useState<ChatMessage | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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

  const handleLongPressStart = (msg: ChatMessage) => {
    longPressTimer.current = setTimeout(() => setSelectedMsg(msg), 500);
  };

  const handleLongPressEnd = () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
  };

  const handleCopy = async () => {
    if (selectedMsg) {
      try { await navigator.clipboard.writeText(selectedMsg.text); } catch { /* ignore */ }
      setSelectedMsg(null);
    }
  };

  const handleDelete = async () => {
    if (selectedMsg && selectedMsg.senderId === user?.uid) {
      await buddyService.deleteMessage(chatId, selectedMsg.id);
      setSelectedMsg(null);
    }
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
    <div className="flex flex-col h-[calc(100vh-140px)]">
      {/* Chat Header */}
      <div className="flex items-center gap-3 pb-3">
        <button onClick={onBack} className={`p-2 rounded-lg transition-colors ${hoverBg}`}>
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-2 flex-1">
          <Avatar name={buddyName} photoURL={buddyPhotoURL} size="sm" />
          <div>
            <div className="font-semibold text-sm">{buddyName}</div>
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

                return (
                  <div
                    key={msg.id}
                    className={`flex mb-2 ${isMe ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      onTouchStart={() => handleLongPressStart(msg)}
                      onTouchEnd={handleLongPressEnd}
                      onContextMenu={(e) => { e.preventDefault(); setSelectedMsg(msg); }}
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
                            // Turn the chat invite into a real group session:
                            // the accepter creates the session, invites the inviter,
                            // and navigates both to the lobby (via notification for the other side).
                            const plan = storage.getActivePlan();
                            if (!plan) { alert('Set an active workout plan first!'); return; }
                            const day = plan.days.find((d) => !d.isRestDay) || plan.days[0];
                            if (!day.exercises || day.exercises.length === 0) {
                              alert('Your active plan has no exercises for this day.');
                              return;
                            }
                            try {
                              await buddyService.sendMessage(
                                chatId,
                                `I'm in! Let's do "${msg.workoutData?.workoutName || 'it'}" together!`,
                                'workout_update',
                                undefined,
                                buddyUid,
                              );
                              const sid = await sessionService.createSession(
                                `${plan.name} - ${day.name}`,
                                'custom',
                                day.exercises,
                              );
                              await sessionService.inviteToSession(sid, buddyUid, buddyName, buddyPhotoURL || null);
                              onStartSession(sid);
                            } catch (err) {
                              console.error('[Chat] Accept & Start failed:', err);
                              alert(`Couldn't start the session: ${err instanceof Error ? err.message : 'unknown error'}`);
                            }
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
                    </div>
                  </div>
                );
              })}
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Long-press Context Menu */}
      {selectedMsg && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setSelectedMsg(null)}
        >
          <div
            className={`rounded-xl shadow-xl overflow-hidden w-48 ${isDark ? 'bg-[#222] border border-[#333]' : 'bg-white border border-gray-200'}`}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={handleCopy}
              className={`w-full flex items-center gap-3 px-4 py-3 text-sm transition-colors ${isDark ? 'hover:bg-[#2a2a2a]' : 'hover:bg-gray-50'}`}
            >
              <Copy className="w-4 h-4 text-zinc-400" /> Copy
            </button>
            {selectedMsg.senderId === user?.uid && (
              <button
                onClick={handleDelete}
                className={`w-full flex items-center gap-3 px-4 py-3 text-sm text-red-400 transition-colors ${isDark ? 'hover:bg-[#2a2a2a]' : 'hover:bg-gray-50'}`}
              >
                <Trash2 className="w-4 h-4" /> Delete
              </button>
            )}
            <button
              onClick={() => setSelectedMsg(null)}
              className={`w-full flex items-center gap-3 px-4 py-3 text-sm transition-colors ${isDark ? 'hover:bg-[#2a2a2a] text-zinc-500' : 'hover:bg-gray-50 text-gray-400'}`}
            >
              <X className="w-4 h-4" /> Cancel
            </button>
          </div>
        </div>
      )}

      {/* Input Area */}
      <div className="pt-3">
        <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border ${cardBg} ${cardBorder}`}>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
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
    </div>
  );
}
