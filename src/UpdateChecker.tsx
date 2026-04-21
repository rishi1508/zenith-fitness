import { useState, useEffect } from 'react';
import { Download, X } from 'lucide-react';

const GITHUB_REPO = 'rishi1508/zenith-fitness';
const CURRENT_VERSION = __APP_VERSION__;

interface Release {
  tag_name: string;
  html_url: string;
}

export function UpdateChecker() {
  const [update, setUpdate] = useState<Release | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    checkForUpdates();
  }, []);

  const checkForUpdates = async () => {
    try {
      const response = await fetch(
        `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`
      );
      
      if (!response.ok) return;
      
      const release: Release = await response.json();
      const latestVersion = release.tag_name.replace('v', '');
      
      if (isNewerVersion(latestVersion, CURRENT_VERSION)) {
        setUpdate(release);
      }
    } catch (e) {
      // Silently fail - no internet or repo doesn't exist yet
    }
  };

  const isNewerVersion = (latest: string, current: string): boolean => {
    const latestParts = latest.split('.').map(Number);
    const currentParts = current.split('.').map(Number);
    
    for (let i = 0; i < Math.max(latestParts.length, currentParts.length); i++) {
      const l = latestParts[i] || 0;
      const c = currentParts[i] || 0;
      if (l > c) return true;
      if (l < c) return false;
    }
    return false;
  };

  const getDownloadUrl = (): string | null => {
    if (!update) return null;
    // Always link to the release page — direct APK download URLs fail on Android browsers
    return update.html_url;
  };

  if (!update || dismissed) return null;

  return (
    <div className="fixed top-16 left-4 right-4 bg-gradient-to-r from-orange-500 to-red-500 rounded-xl p-4 shadow-lg z-50 animate-fadeIn">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center flex-shrink-0">
          <Download className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold">Update Available!</div>
          <div className="text-sm opacity-90">
            Version {update.tag_name} is ready
          </div>
        </div>
        <a
          href={getDownloadUrl() || '#'}
          target="_blank"
          rel="noopener noreferrer"
          className="px-4 py-2 bg-white text-orange-600 rounded-lg font-medium text-sm flex-shrink-0"
        >
          Download
        </a>
        <button 
          onClick={() => setDismissed(true)}
          className="p-1.5 hover:bg-white/20 rounded flex-shrink-0 ml-1"
          aria-label="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// For showing current version in settings
export function VersionInfo() {
  return (
    <div className="text-center text-sm text-zinc-500 py-4">
      Zenith Fitness v{CURRENT_VERSION}
    </div>
  );
}

/**
 * Manual "Check for Updates" helper for the Settings page. Returns a
 * result describing whether the app is up to date, with a link to the
 * latest release page when an update exists.
 */
export type UpdateCheckResult =
  | { status: 'up-to-date'; current: string }
  | { status: 'update-available'; current: string; latest: string; releaseUrl: string }
  | { status: 'error'; message: string };

export async function manualCheckForUpdates(): Promise<UpdateCheckResult> {
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`);
    if (!res.ok) {
      return { status: 'error', message: `GitHub returned ${res.status}` };
    }
    const release: Release = await res.json();
    const latest = release.tag_name.replace('v', '');
    const latestParts = latest.split('.').map(Number);
    const currentParts = CURRENT_VERSION.split('.').map(Number);
    let isNewer = false;
    for (let i = 0; i < Math.max(latestParts.length, currentParts.length); i++) {
      const l = latestParts[i] || 0;
      const c = currentParts[i] || 0;
      if (l > c) { isNewer = true; break; }
      if (l < c) { isNewer = false; break; }
    }
    if (isNewer) {
      return {
        status: 'update-available',
        current: CURRENT_VERSION,
        latest,
        releaseUrl: release.html_url,
      };
    }
    return { status: 'up-to-date', current: CURRENT_VERSION };
  } catch (e) {
    return { status: 'error', message: e instanceof Error ? e.message : 'Network error' };
  }
}
