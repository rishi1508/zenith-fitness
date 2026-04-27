import { useEffect, useState } from 'react';
import {
  X, Key, ExternalLink, CheckCircle2, AlertCircle, Loader2, Eye, EyeOff, Trash2,
} from 'lucide-react';
import {
  PROVIDER_PRESETS, getLLMConfig, setLLMConfig, clearLLMConfig, testConnection,
  type LLMProviderType, type LLMConfig,
} from '../llm';

interface Props {
  isDark: boolean;
  onClose: () => void;
  /** Called after a successful save so the parent can refresh whatever
   *  it shows differently when a key is configured. */
  onConfigured?: () => void;
}

/**
 * BYOK ("Bring Your Own Key") setup modal. Lets the user pick an LLM
 * provider, paste an API key, optionally pick a model + custom
 * endpoint, and run a "Test connection" check before saving.
 *
 * The key is stored locally with light obfuscation (see ../llm/storage).
 * It's never sent to any server we control — every request goes from
 * the user's device directly to the provider they chose.
 */
export function BYOKSetup({ isDark, onClose, onConfigured }: Props) {
  const existing = getLLMConfig();
  const [provider, setProvider] = useState<LLMProviderType>(existing?.provider || 'gemini');
  const [apiKey, setApiKey] = useState(existing?.apiKey || '');
  const [model, setModel] = useState(existing?.model || PROVIDER_PRESETS[existing?.provider || 'gemini'].defaultModel);
  const [endpoint, setEndpoint] = useState(
    existing?.endpoint
    || PROVIDER_PRESETS[existing?.provider || 'gemini'].defaultEndpoint
    || '',
  );
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: 'ok' | 'err'; message: string } | null>(null);

  const preset = PROVIDER_PRESETS[provider];
  const isOpenAICompat = provider === 'openai-compatible';

  // Reset model + endpoint sensibly when the provider switches — the
  // model id from one provider is rarely valid for another.
  useEffect(() => {
    if (provider === existing?.provider) return;
    setModel(preset.defaultModel);
    setEndpoint(preset.defaultEndpoint || '');
    setStatus(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider]);

  const handleSwitchPreset = (suggestion: { url: string; defaultModel: string }) => {
    setEndpoint(suggestion.url);
    setModel(suggestion.defaultModel);
    setStatus(null);
  };

  const buildConfig = (): LLMConfig => ({
    provider,
    apiKey: apiKey.trim(),
    model: model.trim(),
    endpoint: isOpenAICompat ? (endpoint.trim() || undefined) : undefined,
  });

  const handleTest = async () => {
    if (!apiKey.trim() || !model.trim()) {
      setStatus({ kind: 'err', message: 'API key and model are required.' });
      return;
    }
    setStatus(null);
    setBusy(true);
    const result = await testConnection(buildConfig());
    setBusy(false);
    if (result.ok) {
      setStatus({ kind: 'ok', message: 'Connection works. Save when ready.' });
    } else {
      const e = result.error;
      const hint = e.kind === 'auth' ? ' Re-check the key.'
        : e.kind === 'not-found' ? ' Re-check the model id and (if applicable) endpoint URL.'
        : e.kind === 'rate-limit' ? ' Free-tier quota may be exhausted — try again in a minute.'
        : '';
      setStatus({ kind: 'err', message: `${e.message}${hint}` });
    }
  };

  const handleSave = async () => {
    if (!apiKey.trim() || !model.trim()) {
      setStatus({ kind: 'err', message: 'API key and model are required.' });
      return;
    }
    setLLMConfig(buildConfig());
    onConfigured?.();
    onClose();
  };

  const handleClear = () => {
    if (!confirm('Remove your stored API key and model from this device? You\'ll need to re-enter it next time.')) return;
    clearLLMConfig();
    setApiKey('');
    setStatus({ kind: 'ok', message: 'Cleared. Add a key to use the AI Coach again.' });
  };

  const surface = isDark ? 'bg-[#1a1a1a]' : 'bg-white';
  const border = isDark ? 'border-[#2e2e2e]' : 'border-gray-200';
  const subtle = isDark ? 'text-zinc-400' : 'text-gray-600';
  const veryDim = isDark ? 'text-zinc-500' : 'text-gray-500';
  const inputBg = isDark ? 'bg-[#0f0f0f]' : 'bg-gray-50';
  const inputBorder = isDark ? 'border-[#2e2e2e]' : 'border-gray-200';
  const placeholder = isDark ? 'placeholder-zinc-600' : 'placeholder-gray-400';

  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center animate-fadeIn"
      onClick={onClose}
    >
      <div
        className={`${surface} w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl max-h-[92vh] overflow-y-auto`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`sticky top-0 ${surface} px-4 py-3 border-b ${border} flex items-center justify-between`}>
          <div className="flex items-center gap-2">
            <Key className="w-4.5 h-4.5 text-orange-400" />
            <h3 className="font-bold">AI Coach Setup</h3>
          </div>
          <button onClick={onClose} className={`p-1.5 rounded-lg ${isDark ? 'hover:bg-[#252525] text-zinc-500 hover:text-white' : 'hover:bg-gray-100 text-gray-500 hover:text-gray-900'}`}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4 text-sm">
          {/* Privacy explainer */}
          <div className={`rounded-lg p-3 text-xs ${isDark ? 'bg-blue-500/10 border border-blue-500/25 text-blue-200' : 'bg-blue-50 border border-blue-200 text-blue-900'}`}>
            <p className="leading-relaxed">
              Bring your own API key. The key is stored only on this device, lightly obfuscated. Requests go directly from your phone to the provider — they never pass through any Zenith server.
            </p>
          </div>

          {/* Provider */}
          <div className="space-y-1.5">
            <label className={`text-[11px] font-semibold uppercase tracking-wider ${veryDim}`}>Provider</label>
            <div className="grid grid-cols-1 gap-1.5">
              {(Object.keys(PROVIDER_PRESETS) as LLMProviderType[]).map((p) => (
                <button
                  key={p}
                  onClick={() => setProvider(p)}
                  className={`p-3 rounded-lg border text-left transition-colors ${
                    provider === p
                      ? 'border-orange-500/60 bg-orange-500/10'
                      : `${inputBorder} ${isDark ? 'hover:border-orange-500/40' : 'hover:border-orange-400'}`
                  }`}
                >
                  <div className="text-sm font-medium">{PROVIDER_PRESETS[p].label}</div>
                  <div className={`text-[11px] ${subtle} mt-0.5`}>
                    Get a key:{' '}
                    <a
                      href={PROVIDER_PRESETS[p].keyUrl}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="text-orange-400 underline inline-flex items-center gap-0.5"
                    >
                      {PROVIDER_PRESETS[p].keyUrl.replace('https://', '')} <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Endpoint suggestions for OpenAI-compatible */}
          {isOpenAICompat && preset.endpointSuggestions && (
            <div className="space-y-1.5">
              <label className={`text-[11px] font-semibold uppercase tracking-wider ${veryDim}`}>Quick endpoint preset</label>
              <div className="flex flex-wrap gap-1.5">
                {preset.endpointSuggestions.map((s) => (
                  <button
                    key={s.url}
                    onClick={() => handleSwitchPreset(s)}
                    className={`px-2.5 py-1 rounded-md text-[11px] border transition-colors ${
                      endpoint === s.url
                        ? 'border-orange-500/60 bg-orange-500/10 text-orange-300'
                        : `${inputBorder} ${subtle} ${isDark ? 'hover:border-orange-500/40' : 'hover:border-orange-400'}`
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Endpoint URL (only OpenAI-compatible) */}
          {isOpenAICompat && (
            <div className="space-y-1.5">
              <label className={`text-[11px] font-semibold uppercase tracking-wider ${veryDim}`}>Endpoint base URL</label>
              <input
                type="url"
                inputMode="url"
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
                placeholder="https://api.openai.com/v1"
                className={`w-full px-3 py-2 rounded-lg border text-sm font-mono ${inputBg} ${inputBorder} ${placeholder} outline-none focus:border-orange-500/50`}
              />
              <p className={`text-[10px] ${veryDim}`}>
                Don't include /chat/completions — we'll append it automatically.
              </p>
            </div>
          )}

          {/* API key */}
          <div className="space-y-1.5">
            <label className={`text-[11px] font-semibold uppercase tracking-wider ${veryDim}`}>API key</label>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={provider === 'gemini' ? 'AIza...' : 'sk-...'}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                className={`w-full px-3 py-2 pr-10 rounded-lg border text-sm font-mono ${inputBg} ${inputBorder} ${placeholder} outline-none focus:border-orange-500/50`}
              />
              <button
                onClick={() => setShowKey(!showKey)}
                className={`absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded ${veryDim} hover:text-orange-400`}
                aria-label={showKey ? 'Hide key' : 'Show key'}
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Model picker */}
          <div className="space-y-1.5">
            <label className={`text-[11px] font-semibold uppercase tracking-wider ${veryDim}`}>Model</label>
            <div className="grid grid-cols-1 gap-1.5 mb-1.5">
              {preset.models.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setModel(m.id)}
                  className={`px-3 py-2 rounded-lg border text-left text-xs transition-colors ${
                    model === m.id
                      ? 'border-orange-500/60 bg-orange-500/10'
                      : `${inputBorder} ${isDark ? 'hover:border-orange-500/40' : 'hover:border-orange-400'}`
                  }`}
                >
                  <div className="font-medium">{m.label}</div>
                  {m.hint && <div className={`text-[10px] ${subtle} mt-0.5`}>{m.hint}</div>}
                </button>
              ))}
            </div>
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="Or type a custom model id..."
              spellCheck={false}
              autoCapitalize="off"
              className={`w-full px-3 py-2 rounded-lg border text-xs font-mono ${inputBg} ${inputBorder} ${placeholder} outline-none focus:border-orange-500/50`}
            />
          </div>

          {/* Status banner */}
          {status && (
            <div className={`rounded-lg p-3 text-xs flex items-start gap-2 ${
              status.kind === 'ok'
                ? (isDark ? 'bg-emerald-500/10 border border-emerald-500/25 text-emerald-300' : 'bg-emerald-50 border border-emerald-200 text-emerald-900')
                : (isDark ? 'bg-red-500/10 border border-red-500/25 text-red-300' : 'bg-red-50 border border-red-200 text-red-900')
            }`}>
              {status.kind === 'ok'
                ? <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
                : <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />}
              <span>{status.message}</span>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2">
            <button
              onClick={handleTest}
              disabled={busy || !apiKey.trim() || !model.trim()}
              className={`flex-1 py-2.5 rounded-xl font-medium text-xs flex items-center justify-center gap-1.5 transition-colors ${
                isDark ? 'bg-zinc-800 text-zinc-200 hover:bg-zinc-700' : 'bg-gray-100 text-gray-800 hover:bg-gray-200'
              } disabled:opacity-50`}
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
              {busy ? 'Testing…' : 'Test connection'}
            </button>
            <button
              onClick={handleSave}
              disabled={busy || !apiKey.trim() || !model.trim()}
              className="flex-1 py-2.5 rounded-xl font-medium text-xs bg-gradient-to-r from-orange-500 to-red-600 text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              Save
            </button>
          </div>

          {/* Clear key */}
          {existing && (
            <button
              onClick={handleClear}
              className={`w-full text-xs flex items-center justify-center gap-1.5 py-2 ${veryDim} hover:text-red-400 transition-colors`}
            >
              <Trash2 className="w-3.5 h-3.5" /> Remove stored key
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
