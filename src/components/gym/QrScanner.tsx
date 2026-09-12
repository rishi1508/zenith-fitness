import { useEffect, useRef, useState } from 'react';
import QrScannerLib from 'qr-scanner';
import { CameraOff } from 'lucide-react';

interface Props {
  /** Called once per distinct decoded value (deduped while the same code stays in view). */
  onResult: (text: string) => void;
  /** Stop scanning when false (e.g. while a result sheet is open). */
  active?: boolean;
  isDark: boolean;
  hint?: string;
  className?: string;
}

/**
 * Camera QR scanner on top of the `qr-scanner` package (getUserMedia, works
 * in the Capacitor WebView — android.permission.CAMERA is declared in the
 * manifest). Handles permission denial and no-camera devices with a
 * message instead of throwing; the parent offers the code-entry fallback.
 */
export function QrScanner({ onResult, active = true, isDark, hint, className }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<QrScannerLib | null>(null);
  const lastRef = useRef<{ text: string; at: number } | null>(null);
  // Errors clear on remount — parents re-key the scanner when they re-open it.
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !active) return;
    let cancelled = false;
    const scanner = new QrScannerLib(
      video,
      (result) => {
        const text = result.data;
        const now = Date.now();
        // Same code sitting in view fires continuously — report it once per 3 s.
        if (lastRef.current && lastRef.current.text === text && now - lastRef.current.at < 3000) return;
        lastRef.current = { text, at: now };
        onResult(text);
      },
      { returnDetailedScanResult: true, highlightScanRegion: true, highlightCodeOutline: true, preferredCamera: 'environment' },
    );
    scannerRef.current = scanner;
    QrScannerLib.hasCamera()
      .then((has) => {
        if (cancelled) return;
        if (!has) throw new Error('no-camera');
        return scanner.start();
      })
      .then(() => { if (!cancelled) setReady(true); })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        if (/no-camera/i.test(msg)) setError('No camera found on this device.');
        else if (/permission|denied|NotAllowed/i.test(msg)) setError('Camera permission was denied. Allow camera access in system settings, or use the code instead.');
        else setError('Could not start the camera. Use the code instead.');
      });
    return () => {
      cancelled = true;
      setReady(false);
      scanner.stop();
      scanner.destroy();
      scannerRef.current = null;
    };
  }, [active, onResult]);

  return (
    <div className={`space-y-2 ${className ?? ''}`}>
      <div className={`relative w-full aspect-square max-w-sm mx-auto rounded-2xl overflow-hidden ${isDark ? 'bg-black' : 'bg-gray-900'}`}>
        <video ref={videoRef} className={`absolute inset-0 w-full h-full object-cover ${ready ? 'opacity-100' : 'opacity-0'}`} muted playsInline />
        {!ready && !error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-zinc-300 text-sm">
            Starting camera…
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-zinc-200 text-sm">
            <CameraOff className="w-8 h-8 text-zinc-400" /> {error}
          </div>
        )}
      </div>
      {hint && <div className={`text-center text-xs ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>{hint}</div>}
    </div>
  );
}
