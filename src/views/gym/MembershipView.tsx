import { useEffect, useState } from 'react';
import { ArrowLeft, Phone, MapPin, Receipt } from 'lucide-react';
import type { GymViewProps } from './types';
import type { GymPayment } from '../../types';
import { useGym } from '../../gym/GymContext';
import { useAuth } from '../../auth/AuthContext';
import { listPayments, membershipStatus } from '../../gymService';
import { formatMoney } from '../../gymMemberHelpers';
import { MembershipCard } from '../../components';

/** Current plan/status, a renewal reminder for anyone not comfortably
 *  active, payment history, and the gym's contact number. */
export function MembershipView({ isDark, onBack }: GymViewProps) {
  const { gym, membership } = useGym();
  const { user } = useAuth();
  const [payments, setPayments] = useState<GymPayment[] | null>(null);

  const cardBg = isDark ? 'bg-[#1a1a1a]' : 'bg-white';
  const cardBorder = isDark ? 'border-[#2e2e2e]' : 'border-gray-200';
  const subtle = isDark ? 'text-zinc-500' : 'text-gray-500';

  useEffect(() => {
    if (!gym?.id || !user) return;
    listPayments(gym.id, { uid: user.uid }).then(setPayments).catch((err) => {
      console.warn('[Membership] failed to load payments:', err);
      setPayments([]);
    });
  }, [gym?.id, user]);

  if (!gym || !membership) {
    return (
      <div className="space-y-4 animate-fadeIn">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className={`p-2 rounded-lg transition-colors ${isDark ? 'hover:bg-[#222]' : 'hover:bg-gray-50'}`}>
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-xl font-bold">Membership</h1>
        </div>
        <div className={`rounded-xl border p-6 text-center text-sm ${cardBg} ${cardBorder} ${subtle}`}>Loading your membership…</div>
      </div>
    );
  }

  const status = membershipStatus(membership);
  const needsRenewal = status === 'expiring' || status === 'expired' || status === 'none';

  return (
    <div className="space-y-4 animate-fadeIn">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className={`p-2 rounded-lg transition-colors ${isDark ? 'hover:bg-[#222]' : 'hover:bg-gray-50'}`}>
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-xl font-bold">Membership</h1>
      </div>

      <MembershipCard gym={gym} member={membership} isDark={isDark} showQr={false} />

      {needsRenewal && (
        <div className={`rounded-xl border p-4 text-sm ${cardBg} ${cardBorder}`}>
          Ask the desk to renew or set up your plan — payments are recorded there, not in the app.
        </div>
      )}

      <div className="space-y-2">
        <h2 className="text-sm font-semibold">Payment history</h2>
        {payments === null ? (
          <p className={`text-sm ${subtle}`}>Loading…</p>
        ) : payments.length === 0 ? (
          <div className={`rounded-xl border p-6 text-center text-sm ${cardBg} ${cardBorder} ${subtle}`}>
            <Receipt className="w-6 h-6 mx-auto mb-2 opacity-50" />
            No payments recorded yet.
          </div>
        ) : (
          <div className="space-y-2">
            {payments.map((p) => (
              <div key={p.id} className={`rounded-xl border p-3 flex items-center justify-between ${cardBg} ${cardBorder}`}>
                <div>
                  <div className="text-sm font-semibold">{formatMoney(p.amount)}</div>
                  {/* paidAt is a full timestamp — format in local time (formatDateShort is for date-only strings and would show the UTC day). */}
                  <div className={`text-xs ${subtle}`}>{new Date(p.paidAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })} · {p.method.toUpperCase()} · {p.months}mo</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {(gym.phone || gym.address) && (
        <div className={`rounded-xl border p-4 space-y-2 ${cardBg} ${cardBorder}`}>
          <h2 className="text-sm font-semibold">Contact {gym.name}</h2>
          {gym.address && (
            <div className={`flex items-center gap-2 text-sm ${subtle}`}>
              <MapPin className="w-4 h-4 shrink-0" /> {gym.address}
            </div>
          )}
          {gym.phone && (
            <a href={`tel:${gym.phone}`} className="flex items-center gap-2 text-sm text-orange-400 font-medium">
              <Phone className="w-4 h-4 shrink-0" /> {gym.phone}
            </a>
          )}
        </div>
      )}
    </div>
  );
}
