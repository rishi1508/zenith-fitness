import type { ProfileDetails } from '../accountService';

export interface ProfileDraft {
  firstName: string;
  lastName: string;
  /** Dialling code without the plus, e.g. "91". */
  countryCode: string;
  /** National number, digits only. */
  phone: string;
  dob: string;
  sex: '' | 'male' | 'female' | 'other';
}

export const EMPTY_DRAFT: ProfileDraft = { firstName: '', lastName: '', countryCode: '91', phone: '', dob: '', sex: '' };

/** The codes the picker offers; India first because that is where the gyms are. */
export const COUNTRY_CODES: Array<{ code: string; label: string }> = [
  { code: '91', label: 'India' },
  { code: '971', label: 'UAE' },
  { code: '1', label: 'US / Canada' },
  { code: '44', label: 'UK' },
  { code: '61', label: 'Australia' },
  { code: '65', label: 'Singapore' },
  { code: '977', label: 'Nepal' },
  { code: '880', label: 'Bangladesh' },
  { code: '94', label: 'Sri Lanka' },
  { code: '60', label: 'Malaysia' },
  { code: '966', label: 'Saudi Arabia' },
  { code: '974', label: 'Qatar' },
  { code: '49', label: 'Germany' },
  { code: '33', label: 'France' },
  { code: '81', label: 'Japan' },
];

/** Client-side check mirroring api/_profile.ts; the server has the final say. */
export function validateDraft(d: ProfileDraft, opts: { requireName: boolean }): string | null {
  if (opts.requireName && !d.firstName.trim()) return 'Please enter your first name.';
  const digits = d.phone.replace(/\D/g, '');
  if (d.countryCode === '91') {
    if (!/^[6-9]\d{9}$/.test(digits)) return 'Enter the 10-digit mobile number.';
  } else if (digits.length < 6 || digits.length > 14) {
    return 'Enter the mobile number without the country code.';
  }
  if (!d.dob) return 'Please enter your date of birth.';
  const years = (Date.now() - Date.parse(`${d.dob}T00:00:00Z`)) / (365.25 * 86_400_000);
  if (!Number.isFinite(years) || years < 10 || years > 100) return 'Please check the date of birth.';
  if (!d.sex) return 'Please pick one.';
  return null;
}

export function draftToDetails(d: ProfileDraft, opts: { includeName: boolean }): ProfileDetails {
  return {
    ...(opts.includeName ? { displayName: [d.firstName.trim(), d.lastName.trim()].filter(Boolean).join(' ') } : {}),
    phone: `+${d.countryCode}${d.phone.replace(/\D/g, '')}`,
    dob: d.dob,
    sex: d.sex || undefined,
  };
}
