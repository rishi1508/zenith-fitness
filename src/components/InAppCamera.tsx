import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, ImagePlus, RefreshCcw, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { registerBackHandler } from '../backHandlerRegistry';

/** Longest edge of the captured frame — the scanner downsizes to 1024 anyway. */
const CAPTURE_PX = 1280;

/**
 * A camera that never leaves the app.
 *
 * The system camera intent hands the phone to another app; Android reclaims
 * ours while it is in the background and the "photo → restart → resume"
 * dance is what reads as a crash (every time on some phones). A live preview
 * inside the WebView takes the picture without the app ever losing the
 * foreground: no activity switch, no process death, no restore.
 *
 * Black until the stream is actually playing — the raw <video> element draws
 * a grey placeholder glyph while it has nothing to show.
 */
export function InAppCamera({ title, onCapture, onPickFile, onClose }: {
  title: string;
  onCapture: (blob: Blob) => void;
  /** Fallback for when the stream cannot start — the caller's file picker. */
  onPickFile: () => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const [snapping, setSnapping] = useState(false);

  useEffect(() => registerBackHandler(() => { onClose(); return true; }), [onClose]);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setError(null);
    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) { setError('This device cannot open the camera here.'); return; }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1440 } },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play().catch(() => { /* autoplay policy — playsInline + muted normally allows it */ });
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? `${err.name} ${err.message}` : String(err);
        if (/NotAllowed|Permission|denied/i.test(msg)) setError('Camera access is off for Zenith. Allow it in Android settings, or choose a photo instead.');
        else if (/NotFound|no camera|DevicesNotFound/i.test(msg)) setError('No camera found on this device.');
        else setError('The camera could not start. You can choose a photo instead.');
      }
    };
    void start();
    return () => { cancelled = true; stop(); };
  }, [facing, stop]);

  const snap = async () => {
    const video = videoRef.current;
    if (!video || !ready || snapping) return;
    setSnapping(true);
    try {
      const vw = video.videoWidth || 1280;
      const vh = video.videoHeight || 960;
      const scale = Math.min(1, CAPTURE_PX / Math.max(vw, vh));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(vw * scale);
      canvas.height = Math.round(vh * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no canvas');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
      if (!blob) throw new Error('capture failed');
      stop();
      onCapture(blob);
    } catch {
      setError('That shot could not be saved. Try again, or choose a photo.');
      setSnapping(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[120] bg-black text-white flex flex-col" role="dialog" aria-modal="true" aria-label={title}>
      <div
        className="flex items-center justify-between px-3"
        style={{ paddingTop: 'calc(var(--top-inset) + 10px)', paddingBottom: 10 }}
      >
        <button type="button" aria-label="Close" onClick={onClose} className="w-10 h-10 flex items-center justify-center rounded-full text-white/90">
          <X className="w-5 h-5" />
        </button>
        <span className="text-sm font-semibold">{title}</span>
        <button type="button" aria-label="Switch camera" onClick={() => setFacing((f) => (f === 'environment' ? 'user' : 'environment'))} className="w-10 h-10 flex items-center justify-center rounded-full text-white/90" disabled={!ready}>
          <RefreshCcw className="w-5 h-5" />
        </button>
      </div>

      <div className="relative flex-1 min-h-0 bg-black">
        {/* Invisible until frames arrive, so no placeholder glyph is ever seen. */}
        <video
          ref={videoRef}
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-200 ${ready ? 'opacity-100' : 'opacity-0'}`}
          muted
          playsInline
          autoPlay
          onPlaying={() => setReady(true)}
        />
        {!ready && !error && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-white/70">Starting camera…</div>
        )}
        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-8 text-center">
            <CameraOff className="w-8 h-8 text-white/60" />
            <p className="text-sm text-white/80">{error}</p>
            <button type="button" onClick={onPickFile} className="mt-1 inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white text-black text-sm font-medium">
              <ImagePlus className="w-4 h-4" /> Choose a photo
            </button>
          </div>
        )}
        {ready && (
          <div aria-hidden className="absolute inset-x-6 top-[12%] bottom-[18%] rounded-3xl border border-white/30 pointer-events-none" />
        )}
      </div>

      <div
        className="flex items-center justify-between px-8"
        style={{ paddingTop: 18, paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 22px)' }}
      >
        <button type="button" onClick={onPickFile} aria-label="Choose a photo" className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center text-white/90">
          <ImagePlus className="w-5 h-5" />
        </button>
        <button
          type="button"
          onClick={() => { void snap(); }}
          disabled={!ready || snapping}
          aria-label="Take photo"
          className="w-[76px] h-[76px] rounded-full border-4 border-white flex items-center justify-center disabled:opacity-40 active:scale-95 transition-transform"
        >
          <span className="w-[60px] h-[60px] rounded-full bg-white flex items-center justify-center text-black">
            <Camera className="w-6 h-6" strokeWidth={1.75} />
          </span>
        </button>
        <span className="w-12 h-12" aria-hidden />
      </div>
    </div>,
    document.body,
  );
}
