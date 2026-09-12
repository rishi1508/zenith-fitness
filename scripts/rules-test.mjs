// Allow/deny matrix for firestore.rules, run against the Firebase Rules API
// test endpoint — no emulator needed. Compiles the local rules file and
// evaluates each case with mocked get()/exists()/existsAfter().
//
//   ADC=/path/to/authorized_user.json node scripts/rules-test.mjs
//
// For updates, `request.resource` is the FULL incoming document and the
// top-level `resource` the existing one — see upd().
import fs from 'node:fs';
import path from 'node:path';
const ADC = process.env.ADC;
if (!ADC) { console.error('Set ADC=<authorized_user json> (a firebase-tools refresh token works).'); process.exit(2); }
const adc = JSON.parse(fs.readFileSync(ADC, 'utf8'));
const tok = await (await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ client_id: adc.client_id, client_secret: adc.client_secret, refresh_token: adc.refresh_token, grant_type: 'refresh_token' }) })).json();
const source = fs.readFileSync(path.resolve(new URL('.', import.meta.url).pathname, '..', 'firestore.rules'), 'utf8');
const P = 'projects/zenith-fitness-18e2a';
const DB = `${P}/databases/(default)/documents`;
const A = 'uidA', B = 'uidB', C = 'uidC';
const pair = (x, y) => [x, y].sort().join('_');
const doc = (path, data) => ({ name: `${DB}/${path}`, data });
const req = (uid, method, path, resource) => ({ auth: uid ? { uid } : undefined, method, path: `/databases/(default)/documents/${path}`, time: new Date().toISOString(), ...(resource ? { resource: { data: resource } } : {}) });
// function mocks: get/exists by path
// For updates: `request.resource` is the full incoming doc, top-level `resource` the existing one.
const upd = (uid, path, existing, incoming) => ({ ...req(uid, 'update', path, incoming), __existing: { data: existing } });
const mockGet = (path, data) => ({ function: 'get', args: [{ exactValue: `/databases/(default)/documents/${path}` }], result: { value: data ? { data } : null } });
const mockExists = (path, ok) => ({ function: 'exists', args: [{ exactValue: `/databases/(default)/documents/${path}` }], result: { value: ok } });
const mockExistsAfter = (path, ok) => ({ function: 'existsAfter', args: [{ exactValue: `/databases/(default)/documents/${path}` }], result: { value: ok } });

const pendingAB = { fromUid: A, toUid: B, status: 'pending' };
// One gym for the gym cases: owner `own`, a manager, a trainer; A is (sometimes) a member.
const OWNER = 'own', MANAGER = 'mgr', TRAINER = 'trn';
const GYM = { ownerUid: OWNER, staff: { [OWNER]: 'owner', [MANAGER]: 'manager', [TRAINER]: 'trainer' }, memberCount: 10, plans: [{ id: 'p1' }] };
const gymMocks = ({ member = false } = {}) => [mockGet('gyms/g1', GYM), mockExists(`gyms/g1/members/${A}`, member)];
const utcDay = (offsetDays) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
const TODAY = utcDay(0), TOMORROW = utcDay(1);
const cases = [
  // buddyRequests
  ['ALLOW', 'A creates request A__B', req(A, 'create', `buddyRequests/${A}__${B}`, pendingAB)],
  ['DENY',  'A creates request under a random id', req(A, 'create', `buddyRequests/abc123`, pendingAB)],
  ['DENY',  'A creates request pretending to be C', req(A, 'create', `buddyRequests/${C}__${B}`, { fromUid: C, toUid: B, status: 'pending' })],
  ['DENY',  'A creates a request to self', req(A, 'create', `buddyRequests/${A}__${A}`, { fromUid: A, toUid: A, status: 'pending' })],
  // buddies consent
  ['ALLOW', 'B (asked) accepts: creates pair with requestId', req(B, 'create', `buddies/${pair(A,B)}`, { users: [A, B], requestId: `${A}__${B}`, chatId: `chat_${pair(A,B)}` }),
    [mockExists(`buddyRequests/${A}__${B}`, true), mockGet(`buddyRequests/${A}__${B}`, pendingAB)]],
  ['DENY',  'A (asker) cannot create the pair', req(A, 'create', `buddies/${pair(A,B)}`, { users: [A, B], requestId: `${A}__${B}` }),
    [mockExists(`buddyRequests/${A}__${B}`, true), mockGet(`buddyRequests/${A}__${B}`, pendingAB)]],
  ['DENY',  'no requestId → no pair', req(B, 'create', `buddies/${pair(A,B)}`, { users: [A, B] })],
  ['DENY',  'C forces a pair with B using A\'s request', req(C, 'create', `buddies/${pair(B,C)}`, { users: [B, C], requestId: `${A}__${B}` }),
    [mockExists(`buddyRequests/${A}__${B}`, true), mockGet(`buddyRequests/${A}__${B}`, pendingAB)]],
  ['DENY',  'wrong pair id', req(B, 'create', `buddies/${B}_${A}_x`, { users: [A, B], requestId: `${A}__${B}` }),
    [mockExists(`buddyRequests/${A}__${B}`, true), mockGet(`buddyRequests/${A}__${B}`, pendingAB)]],
  ['DENY',  'request already declined', req(B, 'create', `buddies/${pair(A,B)}`, { users: [A, B], requestId: `${A}__${B}` }),
    [mockExists(`buddyRequests/${A}__${B}`, true), mockGet(`buddyRequests/${A}__${B}`, { ...pendingAB, status: 'declined' })]],
  ['ALLOW', 'legacy auto-id request still accepts', req(B, 'create', `buddies/${pair(A,B)}`, { users: [A, B], requestId: 'legacyAutoId' }),
    [mockExists(`buddyRequests/legacyAutoId`, true), mockGet(`buddyRequests/legacyAutoId`, pendingAB)]],
  // chats
  ['ALLOW', 'chat created with the pair in the same batch', req(B, 'create', `chats/chat_${pair(A,B)}`, { users: [A, B] }), [mockExistsAfter(`buddies/${pair(A,B)}`, true)]],
  ['DENY',  'chat without a pair', req(B, 'create', `chats/chat_${pair(A,B)}`, { users: [A, B] }), [mockExistsAfter(`buddies/${pair(A,B)}`, false)]],
  ['DENY',  'chat id not derived from the pair', req(B, 'create', `chats/chat_random`, { users: [A, B] }), [mockExistsAfter(`buddies/${pair(A,B)}`, true)]],
  // notifications
  ['ALLOW', 'buddy A notifies B (chat_message)', req(A, 'create', `notifications/${B}/items/n1`, { fromUid: A, type: 'chat_message', message: 'hi' }), [mockExists(`buddies/${pair(A,B)}`, true)]],
  ['ALLOW', 'A sends buddy_request notification with request present', req(A, 'create', `notifications/${B}/items/n2`, { fromUid: A, type: 'buddy_request', message: 'hi' }),
    [mockExists(`buddies/${pair(A,B)}`, false), mockExists(`buddyRequests/${A}__${B}`, true)]],
  ['DENY',  'stranger C spams B', req(C, 'create', `notifications/${B}/items/n3`, { fromUid: C, type: 'chat_message', message: 'spam' }),
    [mockExists(`buddies/${pair(B,C)}`, false), mockExists(`buddyRequests/${C}__${B}`, false)]],
  ['DENY',  'C claims buddy_request without a request doc', req(C, 'create', `notifications/${B}/items/n4`, { fromUid: C, type: 'buddy_request', message: 'x' }),
    [mockExists(`buddies/${pair(B,C)}`, false), mockExists(`buddyRequests/${C}__${B}`, false)]],
  ['ALLOW', 'self-test notification', req(B, 'create', `notifications/${B}/items/n5`, { fromUid: B, type: 'chat_message', message: 'test' })],
  ['DENY',  'fromUid forged', req(C, 'create', `notifications/${B}/items/n6`, { fromUid: A, type: 'chat_message', message: 'x' }), [mockExists(`buddies/${pair(A,B)}`, true)]],
  // followerCount in step with the edge
  ['ALLOW', 'A bumps B followerCount after writing the edge', upd(A, `userProfiles/${B}`, { followerCount: 2, uid: B }, { followerCount: 3, uid: B }), [mockExists(`follows/${A}__${B}`, true)]],
  ['DENY',  'A bumps B followerCount with no edge', upd(A, `userProfiles/${B}`, { followerCount: 2, uid: B }, { followerCount: 3, uid: B }), [mockExists(`follows/${A}__${B}`, false), mockExists(`buddies/${pair(A,B)}`, false)]],
  ['ALLOW', 'A decrements after deleting the edge', upd(A, `userProfiles/${B}`, { followerCount: 2, uid: B }, { followerCount: 1, uid: B }), [mockExists(`follows/${A}__${B}`, false), mockExists(`buddies/${pair(A,B)}`, false)]],
  ['DENY',  'A decrements while the edge still exists', upd(A, `userProfiles/${B}`, { followerCount: 2, uid: B }, { followerCount: 1, uid: B }), [mockExists(`follows/${A}__${B}`, true), mockExists(`buddies/${pair(A,B)}`, false)]],
  // dailyStats needs a real check-in
  ['ALLOW', 'member bumps dailyStats after own check-in', upd(A, `gyms/g1/dailyStats/2026-09-12`, { date: '2026-09-12', count: 5, hours: {} }, { date: '2026-09-12', count: 6, hours: {} }),
    [mockGet('gyms/g1', { ownerUid: 'own', staff: { own: 'owner' } }), mockExists(`gyms/g1/members/${A}`, true), mockExists(`gyms/g1/checkins/${A}_2026-09-12`, true)]],
  ['DENY',  'member bumps dailyStats without a check-in', upd(A, `gyms/g1/dailyStats/2026-09-12`, { date: '2026-09-12', count: 5, hours: {} }, { date: '2026-09-12', count: 6, hours: {} }),
    [mockGet('gyms/g1', { ownerUid: 'own', staff: { own: 'owner' } }), mockExists(`gyms/g1/members/${A}`, true), mockExists(`gyms/g1/checkins/${A}_2026-09-12`, false)]],

  // joining: memberCount +1 only in the batch that creates the member doc
  ['ALLOW', 'joining member bumps memberCount by one', upd(A, 'gyms/g1', GYM, { ...GYM, memberCount: 11 }), [...gymMocks(), mockExistsAfter(`gyms/g1/members/${A}`, true)]],
  ['DENY',  'joining member bumps memberCount by two', upd(A, 'gyms/g1', GYM, { ...GYM, memberCount: 12 }), [...gymMocks(), mockExistsAfter(`gyms/g1/members/${A}`, true)]],
  ['DENY',  'stranger bumps memberCount without a member doc', upd(A, 'gyms/g1', GYM, { ...GYM, memberCount: 11 }), [...gymMocks(), mockExistsAfter(`gyms/g1/members/${A}`, false)]],
  ['DENY',  'member changes the plans alongside', upd(A, 'gyms/g1', GYM, { ...GYM, memberCount: 11, plans: [] }), [...gymMocks(), mockExistsAfter(`gyms/g1/members/${A}`, true)]],
  ['ALLOW', 'member creates own member doc with a valid join code', req(A, 'create', `gyms/g1/members/${A}`, { uid: A, role: 'member', joinCode: 'ABC123' }), [...gymMocks(), mockGet('gymJoinCodes/ABC123', { gymId: 'g1' })]],
  ['DENY',  'member creates own member doc with another gym\'s code', req(A, 'create', `gyms/g1/members/${A}`, { uid: A, role: 'member', joinCode: 'ABC123' }), [...gymMocks(), mockGet('gymJoinCodes/ABC123', { gymId: 'g2' })]],

  // the daily code lives in a staff-only doc
  ['DENY',  'member reads private/dailyCode', req(A, 'get', 'gyms/g1/private/dailyCode'), gymMocks({ member: true })],
  ['ALLOW', 'trainer reads private/dailyCode', req(TRAINER, 'get', 'gyms/g1/private/dailyCode'), gymMocks()],
  ['ALLOW', 'trainer rotates the code', req(TRAINER, 'create', 'gyms/g1/private/dailyCode', { hash: 'h', date: TODAY, updatedAt: 'x' }), gymMocks()],
  ['DENY',  'member writes private/dailyCode', req(A, 'create', 'gyms/g1/private/dailyCode', { hash: 'h', date: TODAY, updatedAt: 'x' }), gymMocks({ member: true })],
  ['ALLOW', 'member checks in with today\'s code hash', req(A, 'create', `gyms/g1/checkins/${A}_${TODAY}`, { uid: A, date: TODAY, method: 'code', codeHash: 'h', at: 'x', byUid: A }),
    [...gymMocks({ member: true }), mockGet('gyms/g1/private/dailyCode', { hash: 'h', date: TODAY })]],
  ['DENY',  'member checks in with a wrong code hash', req(A, 'create', `gyms/g1/checkins/${A}_${TODAY}`, { uid: A, date: TODAY, method: 'code', codeHash: 'nope', at: 'x', byUid: A }),
    [...gymMocks({ member: true }), mockGet('gyms/g1/private/dailyCode', { hash: 'h', date: TODAY })]],
  ['DENY',  'member back-dates a QR check-in', req(A, 'create', `gyms/g1/checkins/${A}_2020-01-01`, { uid: A, date: '2020-01-01', method: 'member-qr', at: 'x', byUid: A }), gymMocks({ member: true })],
  ['ALLOW', 'member QR check-in for today', req(A, 'create', `gyms/g1/checkins/${A}_${TODAY}`, { uid: A, date: TODAY, method: 'member-qr', at: 'x', byUid: A }), gymMocks({ member: true })],
  ['ALLOW', 'member QR check-in dated tomorrow (time zone ahead of UTC)', req(A, 'create', `gyms/g1/checkins/${A}_${TOMORROW}`, { uid: A, date: TOMORROW, method: 'member-qr', at: 'x', byUid: A }), gymMocks({ member: true })],
  ['DENY',  'member checks in as someone else', req(A, 'create', `gyms/g1/checkins/${B}_${TODAY}`, { uid: B, date: TODAY, method: 'member-qr', at: 'x', byUid: A }), gymMocks({ member: true })],
  ['ALLOW', 'member updates own check-in dates + count', upd(A, `gyms/g1/members/${A}`, { uid: A, role: 'member' }, { uid: A, role: 'member', lastCheckinAt: 'x', checkinDates: [TODAY], checkinCount30d: 1 }), gymMocks({ member: true })],
  ['DENY',  'member changes own plan', upd(A, `gyms/g1/members/${A}`, { uid: A, role: 'member' }, { uid: A, role: 'member', planEnd: '2099-01-01' }), gymMocks({ member: true })],

  // claiming an invite: read + replace the placeholder my invite points at
  ['ALLOW', 'invitee reads the placeholder member doc', { ...req(A, 'get', 'gyms/g1/members/manual_1'), auth: { uid: A, token: { email: 'a@x.com' } } },
    [...gymMocks(), mockGet('gymInvites/a@x.com', { gymId: 'g1', memberUid: 'manual_1' })]],
  ['DENY',  'invitee reads somebody else\'s placeholder', { ...req(A, 'get', 'gyms/g1/members/manual_2'), auth: { uid: A, token: { email: 'a@x.com' } } },
    [...gymMocks(), mockGet('gymInvites/a@x.com', { gymId: 'g1', memberUid: 'manual_1' })]],
  ['ALLOW', 'invitee deletes the placeholder', { ...req(A, 'delete', 'gyms/g1/members/manual_1'), auth: { uid: A, token: { email: 'a@x.com' } } },
    [...gymMocks(), mockGet('gymInvites/a@x.com', { gymId: 'g1', memberUid: 'manual_1' })]],
  ['DENY',  'stranger deletes a member doc', req(A, 'delete', 'gyms/g1/members/manual_1'), gymMocks()],
  ['ALLOW', 'invitee creates own member doc via the invite', { ...req(A, 'create', `gyms/g1/members/${A}`, { uid: A, role: 'member' }), auth: { uid: A, token: { email: 'a@x.com' } } },
    [...gymMocks(), mockGet('gymInvites/a@x.com', { gymId: 'g1', memberUid: 'manual_1' })]],

  // a manager may only point a gym-less profile at their gym
  ['ALLOW', 'manager sets gym pointer on a gym-less profile', upd(MANAGER, `userProfiles/${A}`, { uid: A }, { uid: A, gym: { gymId: 'g1', gymRole: 'member' } }), gymMocks()],
  ['ALLOW', 'manager re-points a profile already in their gym', upd(MANAGER, `userProfiles/${A}`, { uid: A, gym: { gymId: 'g1', gymRole: 'member' } }, { uid: A, gym: { gymId: 'g1', gymRole: 'trainer' } }), gymMocks()],
  ['DENY',  'manager pulls a profile out of another gym', upd(MANAGER, `userProfiles/${A}`, { uid: A, gym: { gymId: 'g2', gymRole: 'member' } }, { uid: A, gym: { gymId: 'g1', gymRole: 'member' } }), gymMocks()],
  ['DENY',  'trainer sets a gym pointer', upd(TRAINER, `userProfiles/${A}`, { uid: A }, { uid: A, gym: { gymId: 'g1', gymRole: 'member' } }), gymMocks()],

  // class sessions: only your own name moves
  ['ALLOW', 'member enrols themselves', upd(A, 'gyms/g1/classes/c1/sessions/2026-09-12', { enrolled: [B], attended: [] }, { enrolled: [B, A], attended: [] }), gymMocks({ member: true })],
  ['ALLOW', 'member unenrols themselves', upd(A, 'gyms/g1/classes/c1/sessions/2026-09-12', { enrolled: [B, A], attended: [] }, { enrolled: [B], attended: [] }), gymMocks({ member: true })],
  ['DENY',  'member removes somebody else', upd(A, 'gyms/g1/classes/c1/sessions/2026-09-12', { enrolled: [B, A], attended: [] }, { enrolled: [A], attended: [] }), gymMocks({ member: true })],
  ['DENY',  'member enrols somebody else', upd(A, 'gyms/g1/classes/c1/sessions/2026-09-12', { enrolled: [A], attended: [] }, { enrolled: [A, C], attended: [] }), gymMocks({ member: true })],
  ['DENY',  'member marks attendance', upd(A, 'gyms/g1/classes/c1/sessions/2026-09-12', { enrolled: [A], attended: [] }, { enrolled: [A], attended: [A] }), gymMocks({ member: true })],

  // announcements: author or manager
  ['ALLOW', 'trainer deletes own announcement', { ...req(TRAINER, 'delete', 'gyms/g1/announcements/a1'), __existing: { data: { byUid: TRAINER } } }, gymMocks()],
  ['DENY',  'trainer deletes a colleague\'s announcement', { ...req(TRAINER, 'delete', 'gyms/g1/announcements/a1'), __existing: { data: { byUid: MANAGER } } }, gymMocks()],
  ['ALLOW', 'manager deletes any announcement', { ...req(MANAGER, 'delete', 'gyms/g1/announcements/a1'), __existing: { data: { byUid: TRAINER } } }, gymMocks()],
  ['DENY',  'member deletes an announcement', { ...req(A, 'delete', 'gyms/g1/announcements/a1'), __existing: { data: { byUid: TRAINER } } }, gymMocks({ member: true })],
];

const body = { source: { files: [{ name: 'firestore.rules', content: source }] }, testSuite: { testCases: cases.map(([expectation, , request, functionMocks]) => { const { __existing, ...rest } = request; return { expectation, request: rest, ...(__existing ? { resource: __existing } : {}), functionMocks: functionMocks ?? [] }; }) } };
const res = await fetch(`https://firebaserules.googleapis.com/v1/${P}:test`, { method: 'POST', headers: { authorization: `Bearer ${tok.access_token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
const out = await res.json();
if (out.issues?.length) { console.log('ISSUES:'); for (const i of out.issues) console.log(' ', i.severity, i.sourcePosition?.line + ':' + i.sourcePosition?.column, i.description); }
const results = out.testResults ?? [];
let fail = 0;
results.forEach((r, i) => { const ok = r.state === 'SUCCESS'; if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  [${cases[i][0].padEnd(5)}] ${cases[i][1]}${ok ? '' : '  → ' + JSON.stringify(r.debugMessages ?? r.errorPosition ?? r).slice(0, 300)}`); });
console.log(`\n${results.length - fail}/${results.length} passed${out.issues?.length ? ` · ${out.issues.length} compile issue(s)` : ''}`);
if (!results.length) console.log(JSON.stringify(out).slice(0, 1500));
