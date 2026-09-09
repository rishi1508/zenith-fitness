import {
  Building2, CalendarCheck, Crown, Flame, Medal, Mountain, Salad, Star, Sunrise, Trophy, Weight, Zap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { BadgeDef, BadgeFamily, BadgeIcon } from '../badges';

/**
 * A badge, drawn rather than typed.
 *
 * Emoji were the wrong answer: they render as a different picture on every
 * device, ignore the app's palette entirely, and look like clip art next to
 * everything else here. This is a hexagon cut in SVG with a per-family
 * gradient, the family's glyph inside, and one pip per tier around the base,
 * so a glance tells you which family a badge belongs to and how far up it is.
 *
 * Everything is drawn from theme tokens, so it follows light and dark.
 */

const ICONS: Record<BadgeIcon, LucideIcon> = {
  weight: Weight,
  mountain: Mountain,
  calendar: CalendarCheck,
  flame: Flame,
  trophy: Trophy,
  star: Star,
  salad: Salad,
  building: Building2,
  sunrise: Sunrise,
  medal: Medal,
  zap: Zap,
  crown: Crown,
};

/** Two stops per family. Distinct hues, all readable on either theme. */
const GRADIENT: Record<BadgeFamily, [string, string]> = {
  volume: ['#64748b', '#334155'],
  sessions: ['#34d399', '#059669'],
  streak: ['#fb923c', '#ea580c'],
  strength: ['#fbbf24', '#d97706'],
  habit: ['#22d3ee', '#0891b2'],
  level: ['#a78bfa', '#7c3aed'],
};

/** Hexagon, flat-top, inscribed in a 100×100 box. */
const HEX = 'M50 4 L88 26 L88 74 L50 96 L12 74 L12 26 Z';

export function BadgeArt({ badge, size = 56, locked = false }: {
  badge: BadgeDef;
  size?: number;
  /** Not earned yet — drawn as an empty slot rather than a coloured badge. */
  locked?: boolean;
}) {
  const Icon = ICONS[badge.iconKey];
  const [from, to] = GRADIENT[badge.family];
  const gradientId = `badge-${badge.id}`;
  const iconSize = Math.round(size * 0.34);

  return (
    <span className="relative inline-flex items-center justify-center shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" className="absolute inset-0">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={locked ? 'currentColor' : from} stopOpacity={locked ? 0.12 : 1} />
            <stop offset="100%" stopColor={locked ? 'currentColor' : to} stopOpacity={locked ? 0.12 : 1} />
          </linearGradient>
        </defs>
        <path d={HEX} fill={`url(#${gradientId})`} />
        {/* A hairline rim keeps the shape crisp on a dark ground. */}
        <path d={HEX} fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="2" />
        {!locked && (
          // A soft top-left highlight so it reads as a struck medal, not a sticker.
          <path d="M50 4 L88 26 L50 48 L12 26 Z" fill="rgba(255,255,255,0.14)" />
        )}
        {/* Tier pips along the bottom edge. */}
        {Array.from({ length: badge.tier }, (_, i) => (
          <circle
            key={i}
            cx={50 + (i - (badge.tier - 1) / 2) * 11}
            cy={86}
            r={2.6}
            fill={locked ? 'currentColor' : 'rgba(255,255,255,0.85)'}
            fillOpacity={locked ? 0.25 : 1}
          />
        ))}
      </svg>
      <Icon
        className={locked ? 'relative text-subtle' : 'relative text-white'}
        style={{ width: iconSize, height: iconSize, marginTop: -size * 0.05 }}
        strokeWidth={2}
      />
    </span>
  );
}
