import { beforeEach, describe, expect, it, vi } from 'vitest';

// Node has no localStorage; the module only needs get/set/remove.
const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
});
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false, convertFileSrc: (p: string) => p } }));
vi.mock('@capacitor/app', () => ({ App: { addListener: vi.fn() } }));

const mod = await import('../src/captureRestore');

describe('pending capture marker', () => {
  beforeEach(() => { store.clear(); vi.useRealTimers(); });

  it('remembers why a photo was being taken, and forgets on clear', () => {
    mod.markPendingCapture('food-scan', { date: '2026-09-12', meal: 'lunch' });
    const raw = JSON.parse(store.get('zenith_pending_capture')!);
    expect(raw.purpose).toBe('food-scan');
    expect(raw.extra).toEqual({ date: '2026-09-12', meal: 'lunch' });
    mod.clearPendingCapture();
    expect(store.has('zenith_pending_capture')).toBe(false);
  });

  it('a restored photo is handed over exactly once', () => {
    expect(mod.consumeRestoredPhoto('gym-feed')).toBeNull();
  });

  it('does nothing on the web — the WebView is the process', () => {
    const dispose = mod.installCaptureRestore(() => { throw new Error('should not fire'); });
    expect(typeof dispose).toBe('function');
    dispose();
  });
});
