/**
 * Client-side OTP service using EmailJS (no Cloud Functions needed).
 *
 * Setup: Create a free account at https://www.emailjs.com then fill in
 * the three constants below. See README for step-by-step instructions.
 */

// ──── EmailJS Configuration ────
// Replace these after creating your EmailJS account + template
const EMAILJS_SERVICE_ID = 'service_xjn65cq';
const EMAILJS_TEMPLATE_ID = 'template_ojmy1hk';
const EMAILJS_PUBLIC_KEY = 'w4EjFkYqLthlVG-LP';

// ──── OTP helpers ────

/** Generate a cryptographically random 6-digit code. */
function generateOTP(): string {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  return String(100000 + (array[0] % 900000));
}

/** SHA-256 hash a string (returns hex). */
async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Derive a deterministic password from an email address.
 * Used for Firebase Auth email/password — the real security gate is the OTP.
 */
export async function derivePassword(email: string): Promise<string> {
  return sha256(email.toLowerCase().trim() + ':zenith-fitness-otp-auth-2024');
}

// ──── In-memory OTP state ────

let pendingOTP: { hashedCode: string; email: string; expiresAt: number; attempts: number } | null = null;

/** Send a 6-digit OTP to the given email via EmailJS. */
export async function sendOTP(email: string): Promise<void> {
  const code = generateOTP();
  const hashedCode = await sha256(code);

  // Store hashed OTP in memory (not Firestore — avoids auth/rules issues)
  pendingOTP = {
    hashedCode,
    email: email.toLowerCase().trim(),
    expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes
    attempts: 0,
  };

  // Send email via EmailJS REST API
  const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      service_id: EMAILJS_SERVICE_ID,
      template_id: EMAILJS_TEMPLATE_ID,
      user_id: EMAILJS_PUBLIC_KEY,
      template_params: {
        to_email: email.trim(),
        otp_code: code,
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error('[OTP] EmailJS error:', text);
    throw new Error('Failed to send verification code. Please try again.');
  }
}

/** Verify an OTP code entered by the user. Returns true if valid. */
export async function verifyOTP(email: string, code: string): Promise<boolean> {
  if (!pendingOTP) {
    throw new Error('No verification code found. Please request a new one.');
  }

  if (pendingOTP.email !== email.toLowerCase().trim()) {
    throw new Error('Email mismatch. Please request a new code.');
  }

  if (Date.now() > pendingOTP.expiresAt) {
    pendingOTP = null;
    throw new Error('Code has expired. Please request a new one.');
  }

  if (pendingOTP.attempts >= 5) {
    pendingOTP = null;
    throw new Error('Too many attempts. Please request a new code.');
  }

  pendingOTP.attempts++;

  const hashedInput = await sha256(code);
  if (hashedInput !== pendingOTP.hashedCode) {
    const remaining = 5 - pendingOTP.attempts;
    throw new Error(`Invalid code. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.`);
  }

  // Valid — clear the OTP
  pendingOTP = null;
  return true;
}
