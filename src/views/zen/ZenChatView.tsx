import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Send, Sparkles, Trash2 } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useGym } from '../../gym/GymContext';
import {
  askZen, ZenError, buildZenContext, resolveZenDataRequest,
  getChatHistory, setChatHistory, clearChatHistory, toZenMessages, quickPrompts,
} from '../../zen';
import type { ChatEntry, ZenErrorKind, ZenRequest } from '../../zen';
import { AppBar, IconButton, Button, H2, CAPTION } from '../../ui';
import { PremiumBadge } from '../../premium';
import { renderZenMarkdown } from './zenMarkdown';

interface ZenChatViewProps {
  onBack: () => void;
  /** Pre-fills the composer once on mount (from a ZenCard follow-up
   *  prompt), then must be cleared via `onConsumePrompt` so it doesn't
   *  reappear on a later visit. */
  initialPrompt?: string | null;
  onConsumePrompt: () => void;
}

const THINKING_LINES = [
  'Reading your last sessions…',
  'Checking your numbers…',
  'Thinking it through…',
  'Putting it together…',
];

/**
 * Replaces `CoachChatView` (BYOK removed — Zen is server-proxied, see
 * `src/zen/client.ts`). History persists via `src/zen/history.ts`
 * (still the old `zenith_llm_chat` key so existing chats survive the
 * rename). A reply can take 5–60s (Gemma 4 "thinking"), so an in-flight
 * request always shows a `ThinkingBubble` rather than a blank screen.
 */
export function ZenChatView({ onBack, initialPrompt, onConsumePrompt }: ZenChatViewProps) {
  const { user } = useAuth();
  const { gym, membership } = useGym();
  const [history, setHistory] = useState<ChatEntry[]>(() => getChatHistory());
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  const [pendingSince, setPendingSince] = useState<number | null>(null);
  const [dataLine, setDataLine] = useState<string | null>(null);
  const lastUserMessageRef = useRef('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const suggestions = useMemo(() => quickPrompts(), []);
  const gymInput = useMemo(() => ({ gym, membership }), [gym, membership]);

  // Seed the composer from a ZenCard follow-up, once, then let the
  // parent clear its prefill state so a later visit starts blank.
  useEffect(() => {
    if (initialPrompt) {
      setInput(initialPrompt);
      onConsumePrompt();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [history, pending]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  }, [input]);

  useEffect(() => {
    setChatHistory(history);
  }, [history]);

  function appendError(kind: ZenErrorKind, message: string) {
    const entry: ChatEntry = {
      id: crypto.randomUUID(), role: 'assistant', content: errorCopy(kind, message), timestamp: Date.now(), errorKind: kind,
    };
    setHistory((prev) => [...prev, entry]);
  }

  const send = async (raw?: string) => {
    const text = (raw ?? input).trim();
    if (!text || pending) return;
    setInput('');
    lastUserMessageRef.current = text;

    if (!user) {
      appendError('auth', 'Please sign in again to talk to Zen.');
      return;
    }

    const userEntry: ChatEntry = { id: crypto.randomUUID(), role: 'user', content: text, timestamp: Date.now() };
    const nextHistory = [...history, userEntry];
    setHistory(nextHistory);
    setPending(true);
    setPendingSince(Date.now());
    setDataLine(null);

    try {
      const idToken = await user.getIdToken();
      const context = buildZenContext({ userName: user.displayName, gym: gymInput });
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const result = await askZen({
        idToken,
        messages: toZenMessages(nextHistory),
        context,
        tz,
        resolveData: (request) => {
          setDataLine(describeDataRequest(request));
          return resolveZenDataRequest(request, { gym: gymInput });
        },
      });
      const assistantEntry: ChatEntry = { id: crypto.randomUUID(), role: 'assistant', content: result.text, timestamp: Date.now() };
      setHistory((prev) => [...prev, assistantEntry]);
    } catch (err) {
      const kind: ZenErrorKind = err instanceof ZenError ? err.kind : 'unknown';
      const message = err instanceof ZenError ? err.message : 'Something went wrong. Please try again.';
      appendError(kind, message);
    } finally {
      setPending(false);
      setPendingSince(null);
      setDataLine(null);
    }
  };

  const retryLast = () => { if (lastUserMessageRef.current) send(lastUserMessageRef.current); };

  const clearAll = () => {
    if (history.length === 0) return;
    if (!confirm('Clear chat history? This cannot be undone.')) return;
    clearChatHistory();
    setHistory([]);
  };

  return (
    // pb-24 reserves space at the bottom for the fixed bottom-nav so
    // the composer is always visible — same pattern as BuddyChatView.
    <div className="flex flex-col h-full pb-24">
      <AppBar
        left={
          <div className="flex items-center gap-2 min-w-0">
            <IconButton icon={ArrowLeft} label="Back" size="sm" onClick={onBack} />
            <h1 className={`${H2} truncate`}>Zen</h1>
            <PremiumBadge />
          </div>
        }
        right={history.length > 0 ? <IconButton icon={Trash2} label="Clear chat" size="sm" onClick={clearAll} /> : undefined}
      />

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3">
        {history.length === 0 && !pending && <FirstUseState suggestions={suggestions} onPick={(s) => send(s)} />}

        {history.length > 0 && (
          <div className="space-y-3">
            {history.map((entry) => (
              <Bubble key={entry.id} entry={entry} onRetry={entry.errorKind ? retryLast : undefined} />
            ))}
          </div>
        )}

        {pending && pendingSince && (
          <div className="mt-3">
            <ThinkingBubble startedAt={pendingSince} dataLine={dataLine} />
          </div>
        )}
      </div>

      <div className="flex-none border-t border-border bg-surface px-3 py-2">
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                if (!pending) send();
              }
            }}
            placeholder="Ask Zen…"
            disabled={pending}
            rows={1}
            className="flex-1 px-3 py-2.5 rounded-control border border-border bg-surface-2 text-text placeholder:text-subtle text-sm resize-none outline-none focus:border-accent/50 disabled:opacity-50"
          />
          <Button variant="primary" size="md" icon={Send} disabled={pending || !input.trim()} onClick={() => send()} aria-label="Send" />
        </div>
        <p className="text-[11px] mt-1.5 px-1 text-subtle">Zen can be wrong — verify before acting on injury or program advice.</p>
      </div>
    </div>
  );
}

function Bubble({ entry, onRetry }: { entry: ChatEntry; onRetry?: () => void }) {
  if (entry.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="rounded-2xl px-3.5 py-2.5 max-w-[85%] text-sm leading-relaxed bg-accent text-white whitespace-pre-wrap">
          {entry.content}
        </div>
      </div>
    );
  }
  const isError = !!entry.errorKind;
  return (
    <div className="flex justify-start">
      <div
        className={`rounded-2xl px-3.5 py-2.5 max-w-[85%] text-sm leading-relaxed ${
          isError ? 'bg-danger/10 border border-danger/25 text-danger' : 'bg-surface border border-border text-text'
        }`}
      >
        {isError ? <p className="whitespace-pre-wrap">{entry.content}</p> : renderZenMarkdown(entry.content)}
        {isError && onRetry && (
          <button onClick={onRetry} className="mt-2 text-[13px] font-bold text-accent">Try again</button>
        )}
      </div>
    </div>
  );
}

function FirstUseState({ suggestions, onPick }: { suggestions: string[]; onPick: (s: string) => void }) {
  return (
    <div className="py-6 space-y-4">
      <div className="text-center">
        <Sparkles className="w-7 h-7 text-accent mx-auto mb-2" strokeWidth={1.75} />
        <h2 className={H2}>Ask me anything about your training</h2>
        <p className="text-sm text-muted max-w-xs mx-auto mt-1 leading-relaxed">
          I can see your recent workouts, streak, PRs and body stats. Replies are coaching guidance, not medical advice.
        </p>
      </div>
      <div className="space-y-1.5">
        <span className={`${CAPTION} px-1`}>Try one of these</span>
        {suggestions.map((s) => (
          <button
            key={s}
            onClick={() => onPick(s)}
            className="w-full text-left text-sm px-3.5 py-2.5 rounded-control border border-border bg-surface hover:bg-surface-2 transition-colors"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Ticks its own clock so the parent isn't re-rendering every 500ms. */
function ThinkingBubble({ startedAt, dataLine }: { startedAt: number; dataLine: string | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  const elapsedMs = now - startedAt;
  const elapsedSec = Math.floor(elapsedMs / 1000);
  const lineIndex = Math.floor(elapsedMs / 2500) % THINKING_LINES.length;
  const line = dataLine ?? THINKING_LINES[lineIndex];

  return (
    <div className="flex justify-start">
      <div className="rounded-2xl px-3.5 py-2.5 max-w-[85%] bg-surface border border-border text-sm text-muted flex flex-col gap-1">
        <span className="flex items-center gap-2">
          <ThinkingDots />
          {line}
        </span>
        {elapsedSec >= 10 && <span className="text-xs text-subtle">{elapsedSec}s</span>}
        {elapsedMs >= 35_000 && <span className="text-xs text-subtle">Still working — long answers take a little longer.</span>}
      </div>
    </div>
  );
}

function ThinkingDots() {
  return (
    <span className="flex gap-0.5" aria-hidden="true">
      <span className="w-1.5 h-1.5 rounded-full bg-accent animate-bounce" style={{ animationDelay: '0ms' }} />
      <span className="w-1.5 h-1.5 rounded-full bg-accent animate-bounce" style={{ animationDelay: '150ms' }} />
      <span className="w-1.5 h-1.5 rounded-full bg-accent animate-bounce" style={{ animationDelay: '300ms' }} />
    </span>
  );
}

function describeDataRequest(request: ZenRequest): string {
  switch (request.kind) {
    case 'exercise_history': return `Checking your ${request.exercise || 'exercise'} history…`;
    case 'workouts_range': return 'Checking your workout history…';
    case 'body_weight': return 'Checking your body weight log…';
    case 'streak_detail': return 'Checking your streak…';
    case 'plan_detail': return 'Checking your active plan…';
    case 'gym_summary': return 'Checking your gym membership…';
    case 'prs': return 'Checking your personal records…';
    case 'volume_by_muscle': return 'Checking your training volume by muscle group…';
    default: return 'Checking your data…';
  }
}

function errorCopy(kind: ZenErrorKind, message: string): string {
  switch (kind) {
    case 'auth': return 'Please sign in again to talk to Zen.';
    case 'rate-limit': return message;
    case 'busy': return 'Zen is busy right now. Try again in a moment.';
    case 'network': return "Can't reach Zen — check your connection and try again.";
    case 'unknown':
    default: return message || 'Something went wrong. Please try again.';
  }
}
