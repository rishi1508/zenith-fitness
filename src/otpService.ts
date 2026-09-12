/**
 * Email-OTP client. All the security-relevant work — generating the code,
 * rate limiting, sending the email, checking the code and minting the
 * sign-in token — happens in the Vercel function at /api/otp (see
 * api/otp.ts). This file only talks to it.
 *
 * The endpoint is derived from VITE_PUSH_ENDPOINT (same Vercel project as
 * push) unless VITE_OTP_ENDPOINT is set explicitly. With neither set,
 * email sign-in is disabled rather than falling back to anything insecure.
 */

function endpoint(): string | null {
  const explicit = import.meta.env.VITE_OTP_ENDPOINT as string | undefined;
  if (explicit) return explicit;
  const push = import.meta.env.VITE_PUSH_ENDPOINT as string | undefined;
  if (push) return push.replace(/\/api\/push\/?$/, '/api/otp');
  return null;
}

async function call<T>(action: string, payload: Record<string, unknown>): Promise<T> {
  const url = endpoint();
  if (!url) throw new Error('Email sign-in is not available in this build. Please use Google sign-in.');
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...payload }),
    });
  } catch {
    throw new Error('Could not reach the sign-in server. Check your connection and try again.');
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || 'Sign-in request failed. Please try again.');
  return data;
}

/** Ask the server to email a 6-digit code. Rate-limited server-side. */
export async function sendOTP(email: string): Promise<void> {
  await call<{ ok: boolean }>('send', { email: email.trim() });
}

export interface VerifyResult {
  /** Present when the email already has an account: sign in with it. */
  token?: string;
  isNewUser: boolean;
  /** Present for a new email: pass back to completeRegistration with a name. */
  ticket?: string;
}

export async function verifyOTP(email: string, code: string): Promise<VerifyResult> {
  return call<VerifyResult>('verify', { email: email.trim(), code: code.trim() });
}

export interface RegistrationDetails {
  displayName: string;
  phone: string;
  dob?: string;
  sex?: 'male' | 'female' | 'other';
}

export async function completeRegistration(email: string, ticket: string, details: RegistrationDetails): Promise<{ token: string }> {
  return call<{ token: string }>('complete', { email: email.trim(), ticket, ...details });
}
