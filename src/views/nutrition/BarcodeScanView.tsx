import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, CameraOff } from 'lucide-react';
import type { IScannerControls } from '@zxing/browser';
import { OFF_ATTRIBUTION } from '../../nutrition';
import { Button, IconButton, H2 } from '../../ui';

export interface BarcodeScanViewProps {
  /** Fires once per distinct code (deduped for 3 s while it stays in view). */
  onResult: (code: string) => void;
  onBack: () => void;
  /** Pause decoding, e.g. while the entry sheet is open over the viewport. */
  active?: boolean;
  /** Manual-entry fallback when the camera is unavailable. */
  onEnterCode?: (code: string) => void;
}

// Retail 1-D formats only — declared inside the effect once @zxing is loaded.
const FORMAT_NAMES = ['EAN_13', 'EAN_8', 'UPC_A', 'UPC_E'] as const;

/**
 * Packaged-food barcode scanner (docs/HEALTH_SPEC.md §3). Uses
 * `@zxing/browser` restricted to the retail 1-D formats and the same
 * getUserMedia + permission handling as `components/gym/QrScanner.tsx`, so
 * it works in the Capacitor WebView (CAMERA is declared in the manifest)
 * and in the PWA.
 */
export function BarcodeScanView({ onResult, onBack, active = true, onEnterCode }: BarcodeScanViewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastRef = useRef<{ code: string; at: number } | null>(null);
  const resultRef = useRef(onResult);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [manual, setManual] = useState('');

  // Kept in a ref so a new `onResult` identity does not tear the camera down.
  useEffect(() => { resultRef.current = onResult; }, [onResult]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !active) return;

    let controls: IScannerControls | null = null;
    let cancelled = false;

    // The scanner library is ~350 KB; fetch it only when the camera view opens.
    Promise.all([import('@zxing/browser'), import('@zxing/library')])
      .then(([{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }]) => {
        if (cancelled) return null;
        const formats = FORMAT_NAMES.map((n) => BarcodeFormat[n]);
        const hints = new Map<import('@zxing/library').DecodeHintType, unknown>([[DecodeHintType.POSSIBLE_FORMATS, formats]]);
        const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 200 });
        return reader.decodeFromConstraints(
        { video: { facingMode: { ideal: 'environment' } } },
        video,
        (result) => {
          if (!result) return;
          const code = result.getText();
          const now = Date.now();
          if (lastRef.current && lastRef.current.code === code && now - lastRef.current.at < 3000) return;
          lastRef.current = { code, at: now };
          resultRef.current(code);
        },
      );
      })
      .then((c) => {
        if (!c) return;
        controls = c;
        if (cancelled) c.stop();
        else setReady(true);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        if (/permission|denied|NotAllowed/i.test(msg)) {
          setError('Camera permission was denied. Allow camera access in system settings, or type the number below.');
        } else if (/NotFound|no camera/i.test(msg)) {
          setError('No camera found on this device. Type the barcode number below.');
        } else {
          setError('Could not start the camera. Type the barcode number below.');
        }
      });

    return () => {
      cancelled = true;
      setReady(false);
      controls?.stop();
    };
  }, [active]);

  return (
    <div className="space-y-4 animate-fadeIn">
      <div className="flex items-center gap-3">
        <IconButton icon={ArrowLeft} label="Back" onClick={onBack} />
        <h1 className={H2}>Scan barcode</h1>
      </div>

      <div className="relative w-full aspect-[4/3] max-w-sm mx-auto rounded-card overflow-hidden bg-black">
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
        {ready && !error && (
          <div className="absolute inset-x-8 top-1/2 -translate-y-1/2 h-24 rounded-xl border-2 border-white/70" aria-hidden="true" />
        )}
      </div>

      <p className="text-center text-xs text-subtle">
        Hold the pack steady — EAN-13, EAN-8 and UPC codes. {OFF_ATTRIBUTION}.
      </p>

      {onEnterCode && (
        <div className="flex gap-2">
          <input
            value={manual}
            onChange={(e) => setManual(e.target.value.replace(/\D/g, ''))}
            inputMode="numeric"
            placeholder="Or type the barcode number"
            className="flex-1 h-11 px-3 rounded-control border border-border bg-surface-2 text-text placeholder:text-subtle text-sm outline-none focus:border-accent/50"
          />
          <Button variant="secondary" size="md" disabled={manual.length < 8} onClick={() => onEnterCode(manual)}>
            Look up
          </Button>
        </div>
      )}
    </div>
  );
}
