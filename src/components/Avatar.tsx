import { useState } from 'react';

type PresenceState = 'online' | 'in-workout' | 'offline';

/**
 * Reusable avatar. Shows photo if available, otherwise gradient + initial.
 * An optional `presence` prop overlays a small colored dot at the bottom
 * right: green = online, orange = in a workout, hidden for offline.
 */
export function Avatar({ name, photoURL, size = 'md', presence }: {
  name: string;
  photoURL?: string | null;
  size?: 'sm' | 'md' | 'lg';
  presence?: PresenceState;
}) {
  const [imgError, setImgError] = useState(false);

  const sizeClasses = {
    sm: 'w-8 h-8 text-sm',
    md: 'w-10 h-10 text-sm',
    lg: 'w-12 h-12 text-base',
  };
  const dotSize = { sm: 'w-2.5 h-2.5', md: 'w-3 h-3', lg: 'w-3.5 h-3.5' };

  const cls = `${sizeClasses[size]} rounded-full flex-shrink-0`;
  const body = (photoURL && !imgError)
    ? (
      <img
        src={photoURL}
        alt=""
        className={`${cls} object-cover`}
        onError={() => setImgError(true)}
        referrerPolicy="no-referrer"
      />
    )
    : (
      <div className={`${cls} bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center text-white font-bold`}>
        {name.charAt(0).toUpperCase()}
      </div>
    );

  // No dot for offline (or absent) — keeps normal-looking avatars clean.
  if (!presence || presence === 'offline') return body;

  const dotColor = presence === 'in-workout' ? 'bg-orange-500' : 'bg-emerald-500';

  return (
    <div className="relative inline-block">
      {body}
      <span
        className={`absolute -bottom-0 -right-0 ${dotSize[size]} rounded-full ${dotColor} ring-2 ring-[#0f0f0f]`}
        aria-label={presence}
      />
    </div>
  );
}
