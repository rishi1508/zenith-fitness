import { describe, it, expect } from 'vitest';
import { normalizeDob, normalizePhone, normalizeSex } from '../api/_profile';

describe('normalizePhone', () => {
  it('turns Indian mobile numbers into E.164', () => {
    expect(normalizePhone('98765 43210')).toBe('+919876543210');
    expect(normalizePhone('+91 98765-43210')).toBe('+919876543210');
    expect(normalizePhone('919876543210')).toBe('+919876543210');
    expect(normalizePhone('09876543210')).toBe('+919876543210');
  });
  it('accepts other countries with a plus and rejects junk', () => {
    expect(normalizePhone('+44 7700 900123')).toBe('+447700900123');
    expect(() => normalizePhone('12345')).toThrow();
    expect(() => normalizePhone('1234567890')).toThrow(); // Indian mobiles start with 6–9
    expect(() => normalizePhone(undefined)).toThrow();
  });
});

describe('normalizeDob / normalizeSex', () => {
  it('accepts a plausible date and rejects the implausible', () => {
    expect(normalizeDob('1995-06-15')).toBe('1995-06-15');
    expect(normalizeDob('')).toBeUndefined();
    expect(() => normalizeDob('2025-01-01')).toThrow();
    expect(() => normalizeDob('15/06/1995')).toThrow();
  });
  it('accepts only the three values', () => {
    expect(normalizeSex('female')).toBe('female');
    expect(normalizeSex(undefined)).toBeUndefined();
    expect(() => normalizeSex('x')).toThrow();
  });
});
