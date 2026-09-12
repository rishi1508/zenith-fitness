import type { ProfileDetails } from '../accountService';

export interface ProfileDraft {
  firstName: string;
  lastName: string;
  phone: string;
  dob: string;
  sex: '' | 'male' | 'female' | 'other';
}

export const EMPTY_DRAFT: ProfileDraft = { firstName: '', lastName: '', phone: '', dob: '', sex: '' };

/** Client-side check mirroring api/_profile.ts; the server has the final say. */
export function validateDraft(d: ProfileDraft, opts: { requireName: boolean }): string | null {
  if (opts.requireName && !d.firstName.trim()) return 'Please enter your first name.';
  const digits = d.phone.replace(/[\s\-().]/g, '');
  if (!/^(\+?91)?[6-9]\d{9}$/.test(digits) && !/^\+[1-9]\d{7,14}$/.test(digits) && !/^0[6-9]\d{9}$/.test(digits)) {
    return 'Enter a 10-digit mobile number (or include the country code).';
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
    phone: d.phone.trim(),
    dob: d.dob,
    sex: d.sex || undefined,
  };
}

