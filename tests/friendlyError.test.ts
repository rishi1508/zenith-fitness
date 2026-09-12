import { describe, it, expect } from 'vitest';
import { friendlyError } from '../src/friendlyError';

const FALLBACK = 'Something went wrong.';

describe('friendlyError', () => {
  it('maps permission-denied to plain copy', () => {
    expect(friendlyError({ code: 'permission-denied' }, FALLBACK)).toBe('You do not have permission for that.');
    expect(friendlyError(new Error('permission_denied'), FALLBACK)).toBe('You do not have permission for that.');
  });

  it('maps unavailable/network/offline codes and messages to the offline copy', () => {
    expect(friendlyError({ code: 'unavailable' }, FALLBACK)).toBe('You seem to be offline. Try again when you are back on the network.');
    expect(friendlyError(new TypeError('Failed to fetch'), FALLBACK)).toBe('You seem to be offline. Try again when you are back on the network.');
    expect(friendlyError({ code: 'auth/network-request-failed' }, FALLBACK)).toBe('You seem to be offline. Try again when you are back on the network.');
  });

  it('maps unauthenticated/auth codes to the session-expired copy', () => {
    expect(friendlyError({ code: 'unauthenticated' }, FALLBACK)).toBe('Your session has expired. Sign in again.');
    expect(friendlyError({ code: 'auth/user-token-expired' }, FALLBACK)).toBe('Your session has expired. Sign in again.');
  });

  it('maps resource-exhausted/quota to the busy copy', () => {
    expect(friendlyError({ code: 'resource-exhausted' }, FALLBACK)).toBe('The app is busy right now. Try again in a minute.');
    expect(friendlyError(new Error('Quota exceeded for quota metric reads.'), FALLBACK)).toBe('The app is busy right now. Try again in a minute.');
  });

  it('maps deadline-exceeded/timeout to the slow-request copy', () => {
    expect(friendlyError({ code: 'deadline-exceeded' }, FALLBACK)).toBe('That took too long. Try again.');
    expect(friendlyError(new Error('Request timeout'), FALLBACK)).toBe('That took too long. Try again.');
  });

  it('passes through a plain human-written message with no code', () => {
    expect(friendlyError(new Error('Please choose a shorter name.'), FALLBACK)).toBe('Please choose a shorter name.');
    expect(friendlyError(new Error('Name already taken'), FALLBACK)).toBe('Name already taken');
  });

  it('falls back for SDK-shaped messages instead of leaking them', () => {
    expect(friendlyError(new Error('FirebaseError: Missing or insufficient permissions.'), FALLBACK)).toBe(FALLBACK);
    expect(friendlyError(new Error('Cannot read properties of undefined (reading \'uid\')'), FALLBACK)).toBe(FALLBACK);
    expect(friendlyError(new Error('at Object.<anonymous> (index.js:12:5)'), FALLBACK)).toBe(FALLBACK);
    expect(friendlyError(new Error('foo@bar.js:1:1'), FALLBACK)).toBe(FALLBACK);
  });

  it('falls back for unknown/empty errors', () => {
    expect(friendlyError(undefined, FALLBACK)).toBe(FALLBACK);
    expect(friendlyError(new Error(''), FALLBACK)).toBe(FALLBACK);
    expect(friendlyError('lowercase string with no punctuation and it goes on for quite a while', FALLBACK)).toBe(FALLBACK);
  });
});
