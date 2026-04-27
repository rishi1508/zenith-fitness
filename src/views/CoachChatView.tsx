import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, Sparkles, Send, Loader2, Settings, Trash2, AlertCircle, Square, Key,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { BYOKSetup } from '../components';
import {
  buildSystemPrompt, getChatHistory, setChatHistory, clearChatHistory,
  toLLMMessages, getLLMConfig, hasLLMConfig, streamCompletion, quickPrompts,
  LLMError, type ChatEntry,
} from '../llm';
import { buildCoachReport } from '../coachService';

interface Props {
  isDark: boolean;
  onBack: () => void;
}

/**
 * Streaming chat view backed by BYOK LLM. The chat is grounded with
 * the rule-based Coach report (insights + weekly summary + form cues
 * if the user mentions a known lift) so the LLM is always working
 * from real data, not hallucinated assumptions.
 *
 * History persists in localStorage (last 50 turns). Stop generating
 * cancels the in-flight stream via AbortController.
 */
export function CoachChatView({ isDark, onBack }: Props) {
  const { user } = useAuth();
  const [history, setHistory] = useState<ChatEntry[]>(() => getChatHistory());
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [hasKey, setHasKey] = useState(() => hasLLMConfig());
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Re-derive the Coach report once at mount AND once per send. Doing
  // it per-send means stale insights don't drift across a long chat
  // session.
  const reportAtMount = useMemo(() => buildCoachReport(), []);
  const suggestions = useMemo(() => quickPrompts(reportAtMount), [reportAtMount]);

  // Auto-scroll to bottom on new content.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [history, streaming]);

  // Auto-resize textarea (manual — react-textarea-autosize would be
  // overkill for one input).
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  }, [input]);

  // Persist whenever history changes.
  useEffect(() => {
    setChatHistory(history);
  }, [history]);

  // Clean up any in-flight request on unmount.
  useEffect(() => () => abortRef.current?.abort(), []);

  const send = async (raw?: string) => {
    const text = (raw ?? input).trim();
    if (!text || streaming) return;
    if (!hasKey) {
      setShowSetup(true);
      return;
    }
    setInput('');
    setError(null);

    const userEntry: ChatEntry = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };
    const assistantEntry: ChatEntry = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
    };
    const nextHistory = [...history, userEntry, assistantEntry];
    setHistory(nextHistory);
    setStreaming(true);

    const config = getLLMConfig();
    if (!config) {
      setHistory((prev) => prev.slice(0, -1));
      setError('No API key. Open setup to add one.');
      setStreaming(false);
      return;
    }

    // Refresh report each turn so the system prompt reflects the
    // latest training context (e.g. user logged a workout between
    // turns).
    const report = buildCoachReport();
    const systemPrompt = buildSystemPrompt({
      userName: user?.displayName?.split(' ')[0] ?? null,
      report,
      todayISO: new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }),
      latestUserMessage: text,
    });

    const ac = new AbortController();
    abortRef.current = ac;

    let accumulated = '';
    try {
      const messages = toLLMMessages([...history, userEntry]);
      for await (const chunk of streamCompletion(config, systemPrompt, messages, ac.signal)) {
        if (chunk.done) break;
        accumulated += chunk.text;
        const assistantId = assistantEntry.id;
        setHistory((prev) => prev.map((e) =>
          e.id === assistantId ? { ...e, content: accumulated } : e
        ));
      }
    } catch (err) {
      if (ac.signal.aborted) {
        // User stopped — keep partial reply if any, mark error so UI
        // can show "(stopped by you)".
        setHistory((prev) => prev.map((e) =>
          e.id === assistantEntry.id
            ? { ...e, content: accumulated || '(stopped)', errorKind: 'aborted' }
            : e
        ));
      } else if (err instanceof LLMError) {
        setError(humanizeError(err));
        setHistory((prev) => prev.map((e) =>
          e.id === assistantEntry.id
            ? { ...e, content: humanizeError(err), errorKind: err.kind }
            : e
        ));
      } else {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        setError(msg);
        setHistory((prev) => prev.map((e) =>
          e.id === assistantEntry.id
            ? { ...e, content: msg, errorKind: 'unknown' }
            : e
        ));
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

  const stop = () => {
    abortRef.current?.abort();
  };

  const clearAll = () => {
    if (history.length === 0) return;
    if (!confirm('Clear chat history? This cannot be undone.')) return;
    clearChatHistory();
    setHistory([]);
    setError(null);
  };

  // ----- styling tokens -----
  const surfaceBg = isDark ? 'bg-[#0f0f0f]' : 'bg-gray-50';
  const cardBg = isDark ? 'bg-[#1a1a1a]' : 'bg-white';
  const cardBorder = isDark ? 'border-[#2e2e2e]' : 'border-gray-200';
  const veryDim = isDark ? 'text-zinc-500' : 'text-gray-500';
  const hoverBg = isDark ? 'hover:bg-[#222]' : 'hover:bg-gray-100';

  return (
    <div className="flex flex-col h-full min-h-[calc(100vh-9rem)]">
      {/* Header */}
      <div className={`flex items-center justify-between px-3 py-2 border-b ${cardBorder} ${cardBg}`}>
        <div className="flex items-center gap-2 min-w-0">
          <button onClick={onBack} className={`p-1.5 rounded-lg ${hoverBg}`}>
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-1.5 min-w-0">
            <Sparkles className="w-4 h-4 text-orange-400 flex-shrink-0" />
            <h1 className="font-bold text-base truncate">AI Coach</h1>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {history.length > 0 && (
            <button
              onClick={clearAll}
              className={`p-1.5 rounded-lg ${veryDim} ${hoverBg}`}
              title="Clear chat"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={() => setShowSetup(true)}
            className={`p-1.5 rounded-lg ${veryDim} ${hoverBg}`}
            title="BYOK settings"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className={`flex-1 overflow-y-auto ${surfaceBg}`}>
        {!hasKey && (
          <NoKeyState
            isDark={isDark}
            onOpenSetup={() => setShowSetup(true)}
          />
        )}

        {hasKey && history.length === 0 && (
          <FirstUseState
            isDark={isDark}
            suggestions={suggestions}
            onPick={(s) => send(s)}
          />
        )}

        {history.length > 0 && (
          <div className="px-4 py-3 space-y-3">
            {history.map((entry) => (
              <Bubble key={entry.id} entry={entry} isDark={isDark} />
            ))}
            {streaming && (
              <div className={`text-xs ${veryDim} flex items-center gap-1.5 px-1`}>
                <Loader2 className="w-3 h-3 animate-spin" />
                Thinking…
              </div>
            )}
          </div>
        )}
      </div>

      {/* Error banner */}
      {error && hasKey && (
        <div className={`px-3 py-2 text-xs flex items-start gap-2 ${
          isDark ? 'bg-red-500/10 border-t border-red-500/25 text-red-300' : 'bg-red-50 border-t border-red-200 text-red-900'
        }`}>
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="text-[10px] uppercase tracking-wide opacity-70 hover:opacity-100">
            dismiss
          </button>
        </div>
      )}

      {/* Composer */}
      <div className={`border-t ${cardBorder} ${cardBg} px-3 py-2`}>
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                if (!streaming) send();
              }
            }}
            placeholder={hasKey ? 'Ask your coach…' : 'Add an API key to start chatting'}
            disabled={!hasKey}
            rows={1}
            className={`flex-1 px-3 py-2 rounded-xl border text-sm resize-none outline-none focus:border-orange-500/50 ${
              isDark ? 'bg-[#0f0f0f] border-[#2e2e2e] text-white placeholder-zinc-600' : 'bg-gray-50 border-gray-200 text-gray-900 placeholder-gray-400'
            } disabled:opacity-50`}
          />
          {streaming ? (
            <button
              onClick={stop}
              className="px-3 py-2 rounded-xl bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-colors flex items-center gap-1 text-xs font-medium"
              title="Stop"
            >
              <Square className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={() => send()}
              disabled={!input.trim() || !hasKey}
              className="px-3 py-2 rounded-xl bg-gradient-to-r from-orange-500 to-red-600 text-white hover:opacity-90 disabled:opacity-40 transition-opacity"
              title="Send"
            >
              <Send className="w-4 h-4" />
            </button>
          )}
        </div>
        <p className={`text-[10px] mt-1.5 px-1 ${veryDim}`}>
          AI can be wrong — verify before acting on injury or program advice.
        </p>
      </div>

      {showSetup && (
        <BYOKSetup
          isDark={isDark}
          onClose={() => setShowSetup(false)}
          onConfigured={() => setHasKey(true)}
        />
      )}
    </div>
  );
}

function Bubble({ entry, isDark }: { entry: ChatEntry; isDark: boolean }) {
  const isUser = entry.role === 'user';
  const containerCls = isUser ? 'flex justify-end' : 'flex justify-start';
  const bubbleCls = isUser
    ? 'bg-gradient-to-r from-orange-500 to-red-600 text-white'
    : entry.errorKind
      ? (isDark ? 'bg-red-500/10 border border-red-500/25 text-red-300' : 'bg-red-50 border border-red-200 text-red-900')
      : (isDark ? 'bg-[#1a1a1a] border border-[#2e2e2e]' : 'bg-white border border-gray-200');

  return (
    <div className={containerCls}>
      <div className={`rounded-2xl px-3.5 py-2.5 max-w-[85%] text-sm leading-relaxed whitespace-pre-wrap ${bubbleCls}`}>
        {entry.content || (isUser ? '' : <span className="opacity-60 italic">…</span>)}
      </div>
    </div>
  );
}

function NoKeyState({ isDark, onOpenSetup }: { isDark: boolean; onOpenSetup: () => void }) {
  const cardBg = isDark ? 'bg-[#1a1a1a]' : 'bg-white';
  const cardBorder = isDark ? 'border-[#2e2e2e]' : 'border-gray-200';
  const subtle = isDark ? 'text-zinc-400' : 'text-gray-600';
  return (
    <div className="px-4 py-8">
      <div className={`rounded-2xl border p-5 text-center ${cardBg} ${cardBorder}`}>
        <Key className="w-8 h-8 text-orange-400 mx-auto mb-3" />
        <div className="font-bold text-base mb-1">Bring your own key</div>
        <p className={`text-xs leading-relaxed ${subtle} mb-4`}>
          The AI Coach uses your own API key — Google AI Studio (free tier) is recommended. Your key stays on this device. Requests go directly to the provider; nothing routes through Zenith.
        </p>
        <button
          onClick={onOpenSetup}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-medium bg-gradient-to-r from-orange-500 to-red-600 text-white hover:opacity-90 transition-opacity"
        >
          <Sparkles className="w-4 h-4" />
          Set up AI Coach
        </button>
      </div>
    </div>
  );
}

function FirstUseState({
  isDark, suggestions, onPick,
}: { isDark: boolean; suggestions: string[]; onPick: (s: string) => void }) {
  const cardBg = isDark ? 'bg-[#1a1a1a]' : 'bg-white';
  const cardBorder = isDark ? 'border-[#2e2e2e]' : 'border-gray-200';
  const subtle = isDark ? 'text-zinc-400' : 'text-gray-600';
  const veryDim = isDark ? 'text-zinc-500' : 'text-gray-500';
  const hoverBg = isDark ? 'hover:bg-[#222]' : 'hover:bg-gray-50';
  return (
    <div className="px-4 py-6 space-y-4">
      <div className="text-center">
        <Sparkles className="w-7 h-7 text-orange-400 mx-auto mb-2" />
        <div className="font-bold text-base mb-1">Ask me anything about your training</div>
        <p className={`text-xs ${subtle} max-w-xs mx-auto leading-relaxed`}>
          I can see your last few weeks of workouts, your active insights, and form-cue references for common lifts. Replies are coaching guidance, not medical advice.
        </p>
      </div>
      <div className="space-y-1.5">
        <div className={`text-[10px] font-semibold uppercase tracking-wider ${veryDim} px-1`}>Try one of these</div>
        {suggestions.map((s) => (
          <button
            key={s}
            onClick={() => onPick(s)}
            className={`w-full text-left text-sm px-3.5 py-2.5 rounded-xl border ${cardBorder} ${cardBg} ${hoverBg} transition-colors`}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function humanizeError(err: LLMError): string {
  switch (err.kind) {
    case 'auth':
      return 'Your API key was rejected. Open settings and double-check the key.';
    case 'rate-limit':
      return 'Free-tier quota hit. Wait a minute and try again, or pick a model with a larger free quota.';
    case 'not-found':
      return 'Model or endpoint not found. Open settings and pick a different model / endpoint.';
    case 'network':
      return 'Network problem reaching the LLM provider. Check connectivity and retry.';
    case 'invalid-config':
      return err.message;
    case 'unknown':
    default:
      return err.message || 'The provider returned an unexpected response.';
  }
}
