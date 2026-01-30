import { useState, useEffect } from 'react';
import { Download, X } from 'lucide-react';

const GITHUB_REPO = 'LordZenith/zenith-fitness'; // Will be updated with actual repo
const CURRENT_VERSION = __APP_VERSION__;

interface Release {
  tag_name: string;
  html_url: string;
  assets: { browser_download_url: string; name: string }[];
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

  const getApkUrl = (): string | null => {
    if (!update) return null;
    const apk = update.assets.find(a => a.name.endsWith('.apk'));
    return apk?.browser_download_url || update.html_url;
  };

  if (!update || dismissed) return null;

  return (
    <div className="fixed top-16 left-4 right-4 bg-gradient-to-r from-orange-500 to-red-500 rounded-xl p-4 shadow-lg z-50 animate-fadeIn">
      <button 
        onClick={() => setDismissed(true)}
        className="absolute top-2 right-2 p-1 hover:bg-white/20 rounded"
      >
        <X className="w-4 h-4" />
      </button>
      
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center">
          <Download className="w-5 h-5" />
        </div>
        <div className="flex-1">
          <div className="font-semibold">Update Available!</div>
          <div className="text-sm opacity-90">
            Version {update.tag_name} is ready
          </div>
        </div>
        <a
          href={getApkUrl() || '#'}
          target="_blank"
          rel="noopener noreferrer"
          className="px-4 py-2 bg-white text-orange-600 rounded-lg font-medium text-sm"
        >
          Download
        </a>
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
