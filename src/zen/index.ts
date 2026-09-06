// Zen client core barrel — no UI here (see src/views/ for that, R3b).
export { buildZenContext } from './contextPack';
export type { ZenGymInput, BuildZenContextOptions } from './contextPack';

export { resolveZenDataRequest } from './dataRequests';
export type { ZenRequest, ZenRequestKind, ResolveZenDataOptions } from './dataRequests';

export { askZen, ZenError } from './client';
export type { ZenChatMessage, AskZenOptions, AskZenResult, ZenErrorKind } from './client';

export { getChatHistory, setChatHistory, clearChatHistory, toZenMessages } from './history';
export type { ChatEntry } from './history';

export { getZenDailyNote } from './dailyNote';
export type { ZenDailyNote } from './dailyNote';

export { quickPrompts } from './quickPrompts';
