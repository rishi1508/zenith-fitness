import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

interface Props {
  value: string;
  /** Rendered size in CSS pixels. */
  size?: number;
  isDark: boolean;
  label?: string;
  className?: string;
}

/**
 * Renders a QR code for `value` as an <img>. Uses the `qrcode` package
 * (pure JS). Colours follow the theme so the code stays scannable on
 * both backgrounds — dark modules on a light tile in dark mode too, since
 * scanners expect dark-on-light.
 */
export function QrCode({ value, size = 224, isDark, label, className }: Props) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(value, { width: size * 2, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#111111', light: '#ffffff' } })
      .then((url) => { if (!cancelled) setSrc(url); })
      .catch((err) => console.warn('[QrCode] render failed:', err));
    return () => { cancelled = true; };
  }, [value, size]);

  return (
    <div className={`inline-flex flex-col items-center gap-2 ${className ?? ''}`}>
      <div className="rounded-2xl bg-white p-3 shadow-sm" style={{ width: size + 24, height: size + 24 }}>
        {src ? (
          <img src={src} alt={label ?? 'QR code'} width={size} height={size} className="block" style={{ imageRendering: 'pixelated' }} />
        ) : (
          <div className="w-full h-full rounded-lg bg-gray-100 animate-pulse" />
        )}
      </div>
      {label && <div className={`text-xs ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>{label}</div>}
    </div>
  );
}
