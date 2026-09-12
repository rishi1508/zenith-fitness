import { describe, it, expect } from 'vitest';
import { DATA_TICKET_TTL_MS, issueDataTicket, verifyDataTicket } from '../api/_ticket';
import { normalizeZenRequest } from '../api/_zenProtocol';

const SECRET = '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n';

describe('data ticket', () => {
  it('verifies for the same uid inside the TTL', () => {
    const t = issueDataTicket(SECRET, 'uidA', 1_000_000);
    expect(verifyDataTicket(SECRET, 'uidA', t, 1_000_000 + 60_000)).toBe(true);
  });

  it('rejects another uid, another secret, a tampered mac and an expired ticket', () => {
    const t = issueDataTicket(SECRET, 'uidA', 1_000_000);
    expect(verifyDataTicket(SECRET, 'uidB', t, 1_000_000)).toBe(false);
    expect(verifyDataTicket('other', 'uidA', t, 1_000_000)).toBe(false);
    expect(verifyDataTicket(SECRET, 'uidA', t.slice(0, -1) + (t.endsWith('A') ? 'B' : 'A'), 1_000_000)).toBe(false);
    expect(verifyDataTicket(SECRET, 'uidA', t, 1_000_000 + DATA_TICKET_TTL_MS + 1)).toBe(false);
  });

  it('rejects garbage without throwing', () => {
    expect(verifyDataTicket(SECRET, 'uidA', undefined)).toBe(false);
    expect(verifyDataTicket(SECRET, 'uidA', '')).toBe(false);
    expect(verifyDataTicket(SECRET, 'uidA', 'nodot')).toBe(false);
    expect(verifyDataTicket(SECRET, 'uidA', 'x.y')).toBe(false);
    expect(verifyDataTicket(SECRET, 'uidA', '123.' + 'a'.repeat(300))).toBe(false);
  });
});

describe('normalizeZenRequest', () => {
  it('accepts energy_range like the other range kinds', () => {
    expect(normalizeZenRequest({ kind: 'energy_range', from: '2026-09-01', to: '2026-09-07' }))
      .toEqual({ kind: 'energy_range', from: '2026-09-01', to: '2026-09-07' });
    expect(normalizeZenRequest({ kind: 'energy_range', from: '2026-09-07', to: '2026-09-01' }))
      .toEqual({ kind: 'energy_range', from: '2026-09-01', to: '2026-09-07' });
    expect(normalizeZenRequest({ kind: 'energy_range', from: 'bad' })).toBeNull();
  });
});
