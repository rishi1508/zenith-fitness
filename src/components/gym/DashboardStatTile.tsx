import type { LucideIcon } from 'lucide-react';

interface DashboardStatTileProps {
  icon: LucideIcon;
  label: string;
  value: string | number;
  isDark: boolean;
  tone?: 'default' | 'warning' | 'danger' | 'success';
}

const TONE_ICON: Record<NonNullable<DashboardStatTileProps['tone']>, string> = {
  default: 'text-orange-400',
  warning: 'text-amber-400',
  danger: 'text-red-400',
  success: 'text-emerald-400',
};

/** Compact stat tile for GymDashboardView's grid — see docs/GYM_TIER_A_SPEC.md §6.3. */
export function DashboardStatTile({ icon: Icon, label, value, isDark, tone = 'default' }: DashboardStatTileProps) {
  return (
    <div className={`rounded-xl border p-4 ${isDark ? 'bg-[#1a1a1a] border-[#2e2e2e]' : 'bg-white border-gray-200'}`}>
      <Icon className={`w-5 h-5 mb-2 ${TONE_ICON[tone]}`} />
      <div className="text-2xl font-bold leading-tight">{value}</div>
      <div className={`text-xs mt-0.5 ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>{label}</div>
    </div>
  );
}
