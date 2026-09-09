import { describe, it, expect } from 'vitest';
import { needsRenewal, normalizePhoneIN, whatsAppUrl, upiPayUri, buildRenewalMessage } from '../src/gymStats';

const NOW = new Date('2026-09-09T10:00:00+05:30');
const iso = (yyyymmdd: string) => yyyymmdd;

describe('needsRenewal', () => {
  it('flags members expiring within a week', () => {
    expect(needsRenewal({ planEnd: iso('2026-09-12') }, NOW)).toBe(true);
    expect(needsRenewal({ planEnd: iso('2026-09-16') }, NOW)).toBe(true);
  });

  it('flags lapsed members', () => {
    expect(needsRenewal({ planEnd: iso('2026-08-30') }, NOW)).toBe(true);
  });

  it('leaves comfortable and frozen members alone', () => {
    expect(needsRenewal({ planEnd: iso('2026-11-01') }, NOW)).toBe(false);
    expect(needsRenewal({ planEnd: iso('2026-09-10'), frozen: true }, NOW)).toBe(false);
    expect(needsRenewal({}, NOW)).toBe(false);
  });
});

describe('normalizePhoneIN', () => {
  it('adds the country code to a bare mobile', () => {
    expect(normalizePhoneIN('9876543210')).toBe('919876543210');
    expect(normalizePhoneIN('098765 43210')).toBe('919876543210');
  });

  it('keeps an existing country code', () => {
    expect(normalizePhoneIN('+91 98765 43210')).toBe('919876543210');
    expect(normalizePhoneIN('0091-9876543210')).toBe('919876543210');
  });

  it('rejects what it cannot dial', () => {
    expect(normalizePhoneIN(undefined)).toBeNull();
    expect(normalizePhoneIN('')).toBeNull();
    expect(normalizePhoneIN('12345')).toBeNull();
    expect(normalizePhoneIN('front desk')).toBeNull();
  });
});

describe('whatsAppUrl', () => {
  it('encodes the message into a wa.me link', () => {
    const url = whatsAppUrl('9876543210', 'Hi Ravi, ₹2,500 & renew?');
    expect(url).toContain('https://wa.me/919876543210?text=');
    expect(url).toContain(encodeURIComponent('₹2,500 & renew?'));
  });

  it('is null without a usable number', () => {
    expect(whatsAppUrl(undefined, 'hi')).toBeNull();
  });
});

describe('upiPayUri', () => {
  it('builds a payable intent', () => {
    const uri = upiPayUri({ vpa: 'irontemple@okhdfc', payeeName: 'Iron Temple Fitness', amount: 6000, note: '3 Months renewal' });
    expect(uri.startsWith('upi://pay?')).toBe(true);
    expect(uri).toContain('pa=irontemple%40okhdfc');
    expect(uri).toContain('pn=Iron+Temple+Fitness');
    expect(uri).toContain('am=6000.00');
    expect(uri).toContain('cu=INR');
    expect(uri).toContain('tn=3+Months+renewal');
  });

  it('omits the amount when there is nothing to charge', () => {
    expect(upiPayUri({ vpa: 'a@b', payeeName: 'Gym' })).toBe('upi://pay?pa=a%40b&pn=Gym&cu=INR');
  });
});

describe('buildRenewalMessage', () => {
  it('names the member, gym, plan, date and price', () => {
    const msg = buildRenewalMessage({
      memberName: 'Ravi Kumar', gymName: 'Iron Temple Fitness', planName: '3 Months',
      planEnd: '2026-09-12', amount: 6000, now: NOW,
    });
    expect(msg).toContain('Hi Ravi,');
    expect(msg).toContain('Iron Temple Fitness');
    expect(msg).toContain('3 Months');
    expect(msg).toContain('ends on 12 Sept 2026');
    expect(msg).toContain('₹6,000');
  });

  it('switches to the past tense once the plan has lapsed', () => {
    const msg = buildRenewalMessage({
      memberName: 'Ravi', gymName: 'Iron Temple', planName: '1 Month', planEnd: '2026-08-30', now: NOW,
    });
    expect(msg).toContain('ended on 30 Aug 2026');
    expect(msg).toContain('back on the floor');
  });

  it('copes with no plan, no date and no price', () => {
    const msg = buildRenewalMessage({ memberName: '', gymName: 'Iron Temple', now: NOW });
    expect(msg).toContain('Hi there,');
    expect(msg).toContain('Your membership is due for renewal.');
    expect(msg).not.toContain('₹');
  });
});
