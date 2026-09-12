/**
 * Maps a caught error — typically a Firebase/Firestore error — to plain,
 * sentence-case copy a user can act on. Checked screens call this instead
 * of surfacing `err.message` (which is often a Firestore/Firebase internal
 * string) directly in a toast.
 */

const SHORT_LEN = 50;

// Substrings/words that mark a message as implementation detail rather
// than something a user should read as-is. "firestore"/"firebase" are
// checked as plain substrings (they show up glued to other words, e.g.
// "FirebaseError:"); the rest are common enough English words that they
// need a word boundary so "document"/"guide"/"encode" aren't flagged.
const TECHNICAL_SUBSTRINGS = /firestore|firebase|permission_denied/i;
const TECHNICAL_WORDS = /\b(undefined|null|doc|uid|internal|code)\b/i;

function extractCode(err: unknown): string {
  if (err && typeof err === 'object' && typeof (err as { code?: unknown }).code === 'string') {
    return (err as { code: string }).code;
  }
  return '';
}

function extractMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return '';
}

/** True when `message` reads like something a person wrote, not a stack trace or SDK error string. */
function looksLikeHumanSentence(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed) return false;
  if (!/^[A-Z]/.test(trimmed)) return false;
  if (trimmed.includes('@')) return false;
  if ((trimmed.match(/:/g) || []).length >= 2) return false;
  if (TECHNICAL_SUBSTRINGS.test(trimmed) || TECHNICAL_WORDS.test(trimmed)) return false;
  const endsWithPeriod = /[.!?]$/.test(trimmed);
  const isShort = trimmed.length <= SHORT_LEN;
  return endsWithPeriod || isShort;
}

export function friendlyError(err: unknown, fallback: string): string {
  const code = extractCode(err);
  const message = extractMessage(err);
  const hay = `${code} ${message}`.toLowerCase();

  if (hay.includes('permission-denied') || hay.includes('permission_denied')) {
    return 'You do not have permission for that.';
  }
  if (hay.includes('unavailable') || hay.includes('network') || hay.includes('failed to fetch') || hay.includes('offline')) {
    return 'You seem to be offline. Try again when you are back on the network.';
  }
  if (hay.includes('unauthenticated') || hay.includes('auth')) {
    return 'Your session has expired. Sign in again.';
  }
  if (hay.includes('resource-exhausted') || hay.includes('quota')) {
    return 'The app is busy right now. Try again in a minute.';
  }
  if (hay.includes('deadline-exceeded') || hay.includes('timeout')) {
    return 'That took too long. Try again.';
  }

  if (message && looksLikeHumanSentence(message)) return message;

  return fallback;
}
