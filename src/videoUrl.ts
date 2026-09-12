/** YouTube id from any of the URL shapes people paste; null for anything else. */
export function youtubeId(url: string): string | null {
  try {
    const u = new URL(url.trim());
    const host = u.hostname.replace(/^www\.|^m\./, '');
    if (host === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null;
    if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      if (u.pathname === '/watch') return u.searchParams.get('v');
      const m = u.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/?]+)/);
      return m ? m[1] : null;
    }
  } catch { /* not a URL */ }
  return null;
}

