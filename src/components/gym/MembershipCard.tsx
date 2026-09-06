import type { Gym, GymMember } from '../../types';
import { membershipStatus, memberQrPayload } from '../../gymService';
import { MEMBERSHIP_STATUS_LABEL, membershipStatusClasses, daysUntil, formatDateShort } from '../../gymMemberHelpers';
import { QrCode } from './QrCode';

interface Props {
  gym: Gym;
  member: GymMember;
  isDark: boolean;
  /** Home screen shows the scannable member QR; MembershipView (which
   *  already shows it once on Home) omits it to avoid repeating itself. */
  showQr?: boolean;
}

/** Plan name, status chip, days left, and (optionally) the member's own
 *  check-in QR — the card every member screen that touches membership
 *  renders the same way. */
export function MembershipCard({ gym, member, isDark, showQr = true }: Props) {
  const cardBg = isDark ? 'bg-[#1a1a1a]' : 'bg-white';
  const cardBorder = isDark ? 'border-[#2e2e2e]' : 'border-gray-200';
  const subtle = isDark ? 'text-zinc-500' : 'text-gray-500';

  const status = membershipStatus(member);
  const plan = gym.plans.find((p) => p.id === member.planId);
  const daysLeft = member.planEnd ? daysUntil(member.planEnd) : null;

  return (
    <div className={`rounded-xl border p-4 space-y-4 ${cardBg} ${cardBorder}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className={`text-xs uppercase tracking-wide font-semibold ${subtle}`}>Membership</div>
          <div className="text-lg font-bold mt-0.5 truncate">{plan?.name ?? 'No active plan'}</div>
          {member.planEnd && (
            <div className={`text-xs mt-1 ${subtle}`}>
              Ends {formatDateShort(member.planEnd)}
              {daysLeft !== null && daysLeft >= 0 && ` · ${daysLeft} day${daysLeft === 1 ? '' : 's'} left`}
            </div>
          )}
        </div>
        <span className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-semibold ${membershipStatusClasses(status)}`}>
          {MEMBERSHIP_STATUS_LABEL[status]}
        </span>
      </div>
      {showQr && (
        <div className="flex justify-center pt-1">
          <QrCode value={memberQrPayload(gym.id, member.uid)} isDark={isDark} size={168} label="Your member QR" />
        </div>
      )}
    </div>
  );
}
