import { useState } from 'react';
import { Flame, Loader2, UserRound } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { completeMyProfile } from '../accountService';
import { ProfileFields } from './ProfileFields';
import { EMPTY_DRAFT, draftToDetails, validateDraft, type ProfileDraft } from './profileDraft';

/**
 * Shown once to a signed-in account whose profile has no phone number yet —
 * a Google sign-up, or anyone from before numbers were collected. Accounts
 * a gym's front desk created already have everything and never see this.
 */
export function ProfileSetupView({ isDark, currentName, onDone }: { isDark: boolean; currentName: string; onDone: () => void }) {
  const { signOut } = useAuth();
  const hasName = !!currentName.trim();
  const [draft, setDraft] = useState<ProfileDraft>(() => {
    const [first = '', ...rest] = currentName.trim().split(/\s+/);
    return { ...EMPTY_DRAFT, firstName: first, lastName: rest.join(' ') };
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const subtle = isDark ? 'text-zinc-400' : 'text-gray-500';

  const submit = async () => {
    const problem = validateDraft(draft, { requireName: true });
    if (problem) { setError(problem); return; }
    setSaving(true);
    setError(null);
    try {
      await completeMyProfile(draftToDetails(draft, { includeName: !hasName || draft.firstName.trim() !== currentName.trim().split(/\s+/)[0] }));
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your details.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`min-h-screen flex flex-col items-center justify-center px-6 py-10 ${isDark ? 'bg-[#0f0f0f] text-white' : 'bg-gray-50 text-gray-900'}`}>
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-1">
          <div className="w-14 h-14 rounded-full bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center mx-auto mb-3">
            <UserRound className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-lg font-bold">A few details to finish your account</h1>
          <p className={`text-sm ${subtle}`}>Your gym uses your number to find you, and your date of birth and sex make the calorie maths right.</p>
        </div>

        <ProfileFields draft={draft} onChange={setDraft} isDark={isDark} showName autoFocus />

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-sm text-red-400 text-center">{error}</div>
        )}

        <button
          onClick={() => { void submit(); }}
          disabled={saving}
          className="w-full flex items-center justify-center gap-2 py-3.5 px-4 rounded-xl font-medium bg-gradient-to-r from-orange-500 to-red-600 text-white hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Flame className="w-5 h-5" />}
          Continue
        </button>
        <button onClick={() => { void signOut(); }} className={`w-full text-sm ${subtle}`}>Sign out</button>
      </div>
    </div>
  );
}
