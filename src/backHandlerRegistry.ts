/**
 * Tiny registry of "back-button" handlers that modals / full-screen
 * overlays can register so the Android hardware back button, the
 * browser back arrow, and popstate events close them first — before
 * the view-stack `goBack()` in App.tsx pops a view.
 *
 * Usage:
 *   useEffect(() => registerBackHandler(() => { onClose(); return true; }),
 *     [onClose]);
 *
 * App.tsx calls `consumeBack()` at the top of its popstate / Capacitor
 * back handler; if any registered handler returns true, the back press
 * is considered absorbed and the view stack is left alone.
 */

type Handler = () => boolean;

const handlers: Handler[] = [];

export function registerBackHandler(h: Handler): () => void {
  // Most recently registered wins — matches the "topmost modal closes
  // first" expectation.
  handlers.unshift(h);
  return () => {
    const i = handlers.indexOf(h);
    if (i >= 0) handlers.splice(i, 1);
  };
}

export function consumeBack(): boolean {
  for (const h of handlers) {
    try { if (h()) return true; } catch { /* ignore and keep going */ }
  }
  return false;
}
