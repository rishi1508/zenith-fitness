import { useState } from 'react';
import { X } from 'lucide-react';
import type { GymMember, GymPayment, GymPlan, PaymentMethod, RevenueCategory } from '../../types';
import { recordPayment } from '../../gymService';
import { localDateISO } from '../../gymStats';

const METHODS: Array<{ id: PaymentMethod; label: string }> = [
  { id: 'upi', label: 'UPI' },
  { id: 'cash', label: 'Cash' },
  { id: 'card', label: 'Card' },
  { id: 'other', label: 'Other' },
];

const CATEGORIES: Array<{ id: RevenueCategory; label: string }> = [
  { id: 'membership', label: 'Membership' },
  { id: 'pt', label: 'Personal training' },
  { id: 'other', label: 'Other' },
];

interface StaffPaymentSheetProps {
  isDark: boolean;
  gymId: string;
  member: GymMember;
  plans: GymPlan[];
  onClose: () => void;
  onSuccess: (payment: GymPayment) => void;
}

/**
 * "Record payment" bottom sheet — shared between GymDashboardView's
 * shortcut and MemberDetailView. Amount/months prefill from the chosen
 * plan and stay editable; recordPayment renews the member's plan
 * (extending from their current planEnd when they still have time left).
 * See docs/GYM_TIER_A_SPEC.md §5, §6.3.
 */
export function StaffPaymentSheet({ isDark, gymId, member, plans, onClose, onSuccess }: StaffPaymentSheetProps) {
  const activePlans = plans.filter((p) => p.active || p.id === member.planId);
  const [planId, setPlanId] = useState(member.planId ?? activePlans[0]?.id ?? '');
  const plan = plans.find((p) => p.id === planId);
  const [category, setCategory] = useState<RevenueCategory>('membership');
  const [amount, setAmount] = useState(String(plan?.price ?? ''));
  const [months, setMonths] = useState(String(plan?.months ?? 1));
  const [method, setMethod] = useState<PaymentMethod>('upi');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(localDateISO(new Date()));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** A PT or retail amount has nothing to do with the plan price. */
  const chooseCategory = (id: RevenueCategory) => {
    setCategory(id);
    setAmount(id === 'membership' && plan ? String(plan.price) : '');
  };

  const choosePlan = (id: string) => {
    setPlanId(id);
    const p = plans.find((x) => x.id === id);
    if (p) { setAmount(String(p.price)); setMonths(String(p.months)); }
  };

  const inputCls = `w-full rounded-lg px-3 py-2 text-sm border focus:outline-none focus:border-orange-500 ${
    isDark ? 'bg-[#0f0f0f] border-[#2e2e2e] text-white placeholder-zinc-600' : 'bg-gray-50 border-gray-200 placeholder-gray-400'
  }`;
  const labelCls = `text-xs font-medium mb-1 block ${isDark ? 'text-zinc-400' : 'text-gray-500'}`;

  const isMembership = category === 'membership';

  const handleSubmit = async () => {
    const amountNum = Number(amount);
    const monthsNum = Number(months);
    if (!amountNum || amountNum <= 0) { setError('Enter a valid amount'); return; }
    if (isMembership && (!monthsNum || monthsNum <= 0)) { setError('Enter valid months'); return; }
    setSaving(true);
    setError(null);
    try {
      const payment = await recordPayment(gymId, {
        uid: member.uid,
        amount: amountNum,
        method,
        // Personal training and retail are revenue, not time on the
        // membership — no plan, no months, so nothing gets renewed.
        months: isMembership ? monthsNum : 0,
        planId: isMembership ? planId || undefined : undefined,
        category,
        note: note.trim() || undefined,
        paidAt: new Date(`${date}T00:00:00`).toISOString(),
      });
      onSuccess(payment);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record payment');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-end sm:items-center justify-center animate-fadeIn" onClick={onClose}>
      <div
        className={`w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl max-h-[85vh] overflow-y-auto border ${
          isDark ? 'bg-[#1a1a1a] border-[#2e2e2e]' : 'bg-white border-gray-200'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`sticky top-0 p-4 border-b flex items-center justify-between ${isDark ? 'bg-[#1a1a1a] border-[#2e2e2e]' : 'bg-white border-gray-200'}`}>
          <div>
            <h3 className="font-bold">Record payment</h3>
            <p className={`text-xs ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>{member.name}</p>
          </div>
          <button aria-label="Close" onClick={onClose} className={`p-1.5 rounded-lg ${isDark ? 'text-zinc-500 hover:text-white hover:bg-[#252525]' : 'text-gray-400 hover:text-gray-900 hover:bg-gray-100'}`}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <div>
            <label className={labelCls}>What for</label>
            <div className="flex flex-wrap gap-1.5">
              {CATEGORIES.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => chooseCategory(c.id)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                    category === c.id
                      ? 'bg-gradient-to-r from-orange-500 to-red-600 text-white'
                      : isDark ? 'bg-[#252525] text-zinc-400 hover:bg-[#303030]' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
            {!isMembership && (
              <p className={`text-xs mt-1.5 ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
                Recorded as revenue only — the membership is not renewed.
              </p>
            )}
          </div>

          {isMembership && activePlans.length > 0 && (
            <div>
              <label className={labelCls}>Plan</label>
              <div className="flex flex-wrap gap-1.5">
                {activePlans.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => choosePlan(p.id)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                      planId === p.id
                        ? 'bg-gradient-to-r from-orange-500 to-red-600 text-white'
                        : isDark ? 'bg-[#252525] text-zinc-400 hover:bg-[#303030]' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className={isMembership ? 'grid grid-cols-2 gap-3' : ''}>
            <div>
              <label className={labelCls}>Amount (₹)</label>
              <input type="number" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputCls} />
            </div>
            {isMembership && (
              <div>
                <label className={labelCls}>Months</label>
                <input type="number" inputMode="numeric" value={months} onChange={(e) => setMonths(e.target.value)} className={inputCls} />
              </div>
            )}
          </div>

          <div>
            <label className={labelCls}>Method</label>
            <div className="flex flex-wrap gap-1.5">
              {METHODS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMethod(m.id)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                    method === m.id
                      ? 'bg-gradient-to-r from-orange-500 to-red-600 text-white'
                      : isDark ? 'bg-[#252525] text-zinc-400 hover:bg-[#303030]' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className={labelCls}>Date</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
          </div>

          <div>
            <label className={labelCls}>Note (optional)</label>
            <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. renewed early" className={inputCls} />
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}

          <button
            onClick={handleSubmit}
            disabled={saving}
            className="w-full py-2.5 rounded-lg text-sm font-medium bg-gradient-to-r from-orange-500 to-red-600 text-white disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Record payment'}
          </button>
        </div>
      </div>
    </div>
  );
}
