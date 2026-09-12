import { useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink, X } from 'lucide-react';
import { registerBackHandler } from '../backHandlerRegistry';
import { youtubeId } from '../videoUrl';

const FILE_RE = /\.(mp4|webm|m4v|mov)(\?|$)/i;

/**
 * Plays a form video inside the app instead of bouncing to a browser tab:
 * YouTube through the privacy-enhanced embed, a direct file through
 * <video>, anything else as an "open" link. Full-width, 16:9, closes on
 * back / Escape / tap outside.
 */
export function VideoModal({ url, title, onClose }: { url: string; title?: string; onClose: () => void }) {
  const yt = useMemo(() => youtubeId(url), [url]);
  const isFile = !yt && FILE_RE.test(url);

  useEffect(() => registerBackHandler(() => { onClose(); return true; }), [onClose]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 animate-fadeIn" role="dialog" aria-modal="true" aria-label={title ?? 'Video'}>
      <div className="absolute inset-0 bg-black/85" onClick={onClose} />
      <div className="relative w-full max-w-lg">
        <div className="flex items-center justify-between gap-3 mb-2 px-1">
          <p className="text-sm font-semibold text-white truncate">{title ?? 'Form video'}</p>
          <button type="button" aria-label="Close" onClick={onClose} className="w-9 h-9 -mr-1 flex items-center justify-center rounded-full text-white/80 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="w-full rounded-xl overflow-hidden bg-black shadow-2xl" style={{ aspectRatio: '16 / 9' }}>
          {yt ? (
            <iframe
              title={title ?? 'Form video'}
              src={`https://www.youtube-nocookie.com/embed/${yt}?playsinline=1&rel=0&modestbranding=1&autoplay=1`}
              className="w-full h-full"
              allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
              allowFullScreen
            />
          ) : isFile ? (
            <video src={url} className="w-full h-full" controls autoPlay playsInline />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center gap-3 text-center px-6">
              <p className="text-sm text-white/80">This video is hosted somewhere the app cannot play inline.</p>
              <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white text-black text-sm font-medium">
                <ExternalLink className="w-4 h-4" /> Open video
              </a>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
