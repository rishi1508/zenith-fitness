import type { ReactNode } from 'react';
import { Phone, ChevronRight } from 'lucide-react';
import type { GymMember, MembershipStatus } from '../../types';
import { membershipStatus } from '../../gymService';

const STATUS_LABEL: Record<MembershipStatus, string> = {
  active: 'Active',
  expiring: 'Expiring',
  expired: 'Expired',
  frozen: 'Frozen',
  none: 'No plan',
};

const STATUS_CLASS: Record<MembershipStatus, string> = {
  active: 'bg-emerald-500/15 text-emerald-500',
  expiring: 'bg-amber-500/15 text-amber-500',
  expired: 'bg-red-500/15 text-red-500',
  frozen: 'bg-sky-500/15 text-sky-500',
  none: 'bg-zinc-500/15 text-zinc-400',
};

export function StatusChip({ status }: { status: MembershipStatus }) {
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS_CLASS[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

interface StaffMemberRowProps {
  member: GymMember;
  isDark: boolean;
  /** e.g. plan name, "ends 12 Sep", days-left — caller decides what's relevant. */
  subtitle?: string;
  onClick?: () => void;
  /** Rendered at the right instead of the default chevron, e.g. a "Record payment" button. */
  right?: ReactNode;
}

/** Shared member row for staff screens (search results, dashboard lists, …). */
export function StaffMemberRow({ member, isDark, subtitle, onClick, right }: StaffMemberRowProps) {
  const status = membershipStatus(member);
  const subtle = isDark ? 'text-zinc-500' : 'text-gray-500';

  return (
    <div
      onClick={onClick}
      className={`flex items-center justify-between gap-3 p-3 rounded-lg transition-colors ${
        onClick ? (isDark ? 'cursor-pointer hover:bg-[#222]' : 'cursor-pointer hover:bg-gray-50') : ''
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium truncate">{member.name}</span>
          <StatusChip status={status} />
        </div>
        <div className={`text-xs mt-0.5 flex items-center gap-2 ${subtle}`}>
          {member.phone && (
            <a
              href={`tel:${member.phone}`}
              onClick={(e) => e.stopPropagation()}
              className={`flex items-center gap-1 ${isDark ? 'hover:text-orange-400' : 'hover:text-orange-600'}`}
            >
              <Phone className="w-3 h-3" /> {member.phone}
            </a>
          )}
          {subtitle && <span className="truncate">{subtitle}</span>}
        </div>
      </div>
      {right ?? (onClick && <ChevronRight className={`w-4 h-4 shrink-0 ${subtle}`} />)}
    </div>
  );
}
