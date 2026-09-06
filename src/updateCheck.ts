// Manual "check for updates" used by Settings (split from UpdateChecker.tsx so that file only exports a component).
interface Release { tag_name: string; html_url: string }
const GITHUB_REPO = 'rishi1508/zenith-fitness';
const CURRENT_VERSION = __APP_VERSION__;

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
