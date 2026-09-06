import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import * as storage from '../storage';

const DOWNLOAD_URL = import.meta.env.VITE_APP_DOWNLOAD_URL || 'https://github.com/rishi1508/zenith-fitness/releases/latest';

/**
 * Slim "Get the app" bar under the AppBar — web only, phone-width only,
 * dismissible (persisted in `AppSettings.ui.getAppBannerDismissed`).
 * Never renders inside the installed PWA or the Android app.
 */
export function GetAppBanner() {
  const [dismissed, setDismissed] = useState(() => storage.getAppSettings().ui.getAppBannerDismissed ?? false);
  const [narrow, setNarrow] = useState(() => window.innerWidth < 768);

  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  if (Capacitor.isNativePlatform() || !narrow || dismissed) return null;

  const dismiss = () => {
    storage.updateAppSettings('ui', { getAppBannerDismissed: true });
    setDismissed(true);
  };

  return (
    <a
      href={DOWNLOAD_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="flex-none flex items-center gap-2 mx-5 mb-2 px-3 py-2 rounded-control bg-accent-soft text-accent text-[13px] font-semibold"
    >
      <Download className="w-4 h-4 shrink-0" strokeWidth={1.75} />
      <span className="flex-1 min-w-0 truncate">Get the Android app for the full experience</span>
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); dismiss(); }}
        aria-label="Dismiss"
        className="shrink-0 p-0.5"
      >
        <X className="w-4 h-4" strokeWidth={1.75} />
      </button>
    </a>
  );
}
