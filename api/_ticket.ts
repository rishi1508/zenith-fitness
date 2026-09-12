// A signed, short-lived note that says "this uid already paid for this Zen
// turn". Zen's data protocol takes two POSTs for one turn (ask → needData →
// re-post with dataAnswer); the second one carries the ticket from the first
// and is not charged again. Without it the second round either double-charged
// the user or, if simply skipped, let any client label every request as a
// second round and talk for free.
//
// HMAC-SHA256 over uid + issue time, keyed from the Firebase private key so no
// extra secret has to be provisioned. Pure: the routes pass the clock in.

import crypto from 'node:crypto';

export const DATA_TICKET_TTL_MS = 3 * 60 * 1000;

function key(secret: string): Buffer {
  return crypto.createHash('sha256').update(`zen-data-ticket:${secret}`).digest();
}

export function issueDataTicket(secret: string, uid: string, now = Date.now()): string {
  const mac = crypto.createHmac('sha256', key(secret)).update(`${uid}:${now}`).digest('base64url');
  return `${now}.${mac}`;
}

export function verifyDataTicket(secret: string, uid: string, ticket: unknown, now = Date.now(), ttlMs = DATA_TICKET_TTL_MS): boolean {
  if (typeof ticket !== 'string' || ticket.length > 200) return false;
  const dot = ticket.indexOf('.');
  if (dot <= 0) return false;
  const issued = Number(ticket.slice(0, dot));
  if (!Number.isFinite(issued) || now - issued > ttlMs || issued - now > 30_000) return false;
  const expected = crypto.createHmac('sha256', key(secret)).update(`${uid}:${issued}`).digest('base64url');
  const given = ticket.slice(dot + 1);
  if (given.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}
