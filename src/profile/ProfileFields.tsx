import { COUNTRY_CODES, type ProfileDraft } from './profileDraft';

const SEXES: Array<{ id: 'male' | 'female' | 'other'; label: string }> = [
  { id: 'male', label: 'Male' }, { id: 'female', label: 'Female' }, { id: 'other', label: 'Other' },
];

/**
 * The details every account carries: name, the phone number that keys the
 * account, date of birth and sex (which the energy model uses). One form for
 * the sign-up step and for the one-time setup an existing account sees.
 */
export function ProfileFields({ draft, onChange, isDark, showName, autoFocus }: {
  draft: ProfileDraft;
  onChange: (next: ProfileDraft) => void;
  isDark: boolean;
  showName: boolean;
  autoFocus?: boolean;
}) {
  const inputClass = `w-full rounded-xl px-4 py-3.5 text-sm border focus:outline-none focus:border-orange-500 ${
    isDark ? 'bg-[#1a1a1a] border-[#2e2e2e] text-white placeholder-zinc-500' : 'bg-white border-gray-200 placeholder-gray-400'
  }`;
  const label = `text-xs font-medium ${isDark ? 'text-zinc-400' : 'text-gray-500'}`;
  const set = (patch: Partial<ProfileDraft>) => onChange({ ...draft, ...patch });
  const today = new Date();
  const maxDob = new Date(today.getFullYear() - 10, today.getMonth(), today.getDate()).toISOString().slice(0, 10);

  return (
    <div className="space-y-3">
      {showName && (
        <div className="grid grid-cols-2 gap-3">
          <input type="text" value={draft.firstName} onChange={(e) => set({ firstName: e.target.value })} placeholder="First name" autoComplete="given-name" className={inputClass} autoFocus={autoFocus} aria-label="First name" />
          <input type="text" value={draft.lastName} onChange={(e) => set({ lastName: e.target.value })} placeholder="Last name" autoComplete="family-name" className={inputClass} aria-label="Last name" />
        </div>
      )}
      <div>
        <span className={label}>Mobile number</span>
        <div className="flex gap-2 mt-1">
          <select
            value={draft.countryCode}
            onChange={(e) => set({ countryCode: e.target.value })}
            aria-label="Country code"
            className={`shrink-0 w-[92px] rounded-xl px-2 py-3.5 text-sm border focus:outline-none focus:border-orange-500 ${
              isDark ? 'bg-[#1a1a1a] border-[#2e2e2e] text-white' : 'bg-white border-gray-200 text-gray-900'
            }`}
          >
            {COUNTRY_CODES.map((c) => <option key={c.code} value={c.code}>+{c.code} {c.label}</option>)}
          </select>
          <input
            type="tel" inputMode="numeric" autoComplete="tel-national"
            value={draft.phone} onChange={(e) => set({ phone: e.target.value.replace(/[^\d]/g, '').slice(0, 14) })}
            placeholder={draft.countryCode === '91' ? '10-digit number' : 'Number'}
            className={`${inputClass} flex-1 min-w-0`} aria-label="Mobile number"
            autoFocus={autoFocus && !showName}
          />
        </div>
        <p className={`text-[11px] mt-1 ${isDark ? 'text-zinc-500' : 'text-gray-400'}`}>Your gym reaches you here. One number, one account.</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <span className={label}>Date of birth</span>
          <input type="date" value={draft.dob} max={maxDob} onChange={(e) => set({ dob: e.target.value })} className={`${inputClass} mt-1`} aria-label="Date of birth" />
        </div>
        <div>
          <span className={label}>Sex</span>
          <div className="grid grid-cols-3 gap-1 mt-1" role="radiogroup" aria-label="Sex">
            {SEXES.map((s) => (
              <button
                key={s.id} type="button" role="radio" aria-checked={draft.sex === s.id}
                onClick={() => set({ sex: s.id })}
                className={`py-3 rounded-xl text-xs font-medium border ${draft.sex === s.id
                  ? 'bg-gradient-to-r from-orange-500 to-red-600 text-white border-transparent'
                  : isDark ? 'bg-[#1a1a1a] border-[#2e2e2e] text-zinc-300' : 'bg-white border-gray-200 text-gray-600'}`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
