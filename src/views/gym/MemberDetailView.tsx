import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Phone, Mail, Calendar, Snowflake, Trash2, Pencil, Receipt, History } from 'lucide-react';
import type { GymViewProps } from './types';
import type { GymMember, GymPayment, GymCheckin, PaymentMethod } from '../../types';
import { useGym } from '../../gym/GymContext';
import { useAuth } from '../../auth/AuthContext';
import { isAdmin } from '../../admin';
import { listenToMembers, listPayments, listCheckins, updateMember, removeMember, membershipStatus } from '../../gymService';
import { localDateISO } from '../../gymStats';
import { clearMemberTrainer } from '../../gymStaffHelpers';
import { StatusChip } from '../../components/gym/StaffMemberRow';
import { StaffPaymentSheet } from '../../components/gym/StaffPaymentSheet';
import { StaffToast } from '../../components/gym/StaffToast';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function daysLeft(planEnd: string): number {
  return Math.ceil((new Date(`${planEnd}T00:00:00`).getTime() - Date.now()) / 86_400_000);
}

const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = { upi: 'UPI', cash: 'Cash', card: 'Card', other: 'Other' };

/** Member detail — see docs/GYM_TIER_A_SPEC.md §6.3. Manager+ can edit;
 *  trainers get a read-only view. */
export function MemberDetailView({ isDark, onBack, memberUid }: GymViewProps) {
  const { gym, role } = useGym();
  const { user } = useAuth();
  const canEdit = role === 'manager' || role === 'owner' || isAdmin(user?.uid);

  const [members, setMembers] = useState<GymMember[]>([]);
  const [payments, setPayments] = useState<GymPayment[]>([]);
  const [checkins, setCheckins] = useState<GymCheckin[]>([]);
  const [refreshTick, setRefreshTick] = useState(0);
  const [showPayment, setShowPayment] = useState(false);
  const [editingPlan, setEditingPlan] = useState(false);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesDraft, setNotesDraft] = useState('');
  const [planIdDraft, setPlanIdDraft] = useState('');
  const [planStartDraft, setPlanStartDraft] = useState('');
  const [planEndDraft, setPlanEndDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const member = useMemo(() => members.find((m) => m.uid === memberUid) ?? null, [members, memberUid]);
  const trainers = useMemo(() => members.filter((m) => m.role === 'trainer'), [members]);

  useEffect(() => {
    const gymId = gym?.id;
    if (!gymId) return;
    return listenToMembers(gymId, setMembers);
  }, [gym?.id]);

  useEffect(() => {
    const gymId = gym?.id;
    if (!gymId || !memberUid) return;
    let cancelled = false;
    (async () => {
      try {
        const sinceISO = new Date(Date.now() - 60 * 86_400_000).toISOString();
        const [paymentsList, checkinsList] = await Promise.all([
          listPayments(gymId, { uid: memberUid }),
          listCheckins(gymId, { sinceISO, uid: memberUid, limit: 100 }),
        ]);
        if (!cancelled) { setPayments(paymentsList); setCheckins(checkinsList.slice(0, 30)); }
      } catch (err) {
        console.warn('[MemberDetail] load failed:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [gym?.id, memberUid, refreshTick]);

  const subtle = isDark ? 'text-zinc-500' : 'text-gray-500';
  const cardCls = `rounded-xl border p-4 ${isDark ? 'bg-[#1a1a1a] border-[#2e2e2e]' : 'bg-white border-gray-200'}`;
  const inputCls = `w-full rounded-lg px-3 py-2 text-sm border focus:outline-none focus:border-orange-500 ${
    isDark ? 'bg-[#0f0f0f] border-[#2e2e2e] text-white placeholder-zinc-600' : 'bg-gray-50 border-gray-200 placeholder-gray-400'
  }`;
  const labelCls = `text-xs font-medium mb-1 block ${subtle}`;

  if (!gym || !memberUid) {
    return (
      <div className="space-y-4 animate-fadeIn">
        <button onClick={onBack} className={`p-2 rounded-lg transition-colors ${isDark ? 'hover:bg-[#222]' : 'hover:bg-gray-50'}`}>
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className={cardCls}><p className={`text-sm ${subtle}`}>No member selected.</p></div>
      </div>
    );
  }
  if (!member) {
    return (
      <div className="space-y-4 animate-fadeIn">
        <button onClick={onBack} className={`p-2 rounded-lg transition-colors ${isDark ? 'hover:bg-[#222]' : 'hover:bg-gray-50'}`}>
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className={cardCls}><p className={`text-sm ${subtle}`}>Loading…</p></div>
      </div>
    );
  }

  const status = membershipStatus(member);
  const planName = gym.plans.find((p) => p.id === member.planId)?.name;

  const startEditPlan = () => {
    setPlanIdDraft(member.planId ?? '');
    setPlanStartDraft(member.planStart ?? localDateISO(new Date()));
    setPlanEndDraft(member.planEnd ?? '');
    setEditingPlan(true);
  };
  const savePlan = async () => {
    setSaving(true);
    try {
      await updateMember(gym.id, member.uid, {
        planId: planIdDraft || undefined,
        planStart: planStartDraft || undefined,
        planEnd: planEndDraft || undefined,
      });
      setToast('Plan updated');
      setEditingPlan(false);
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'Failed to update plan');
    } finally {
      setSaving(false);
    }
  };

  const toggleFreeze = async () => {
    setSaving(true);
    try {
      await updateMember(gym.id, member.uid, { frozen: !member.frozen });
      setToast(member.frozen ? 'Membership unfrozen' : 'Membership frozen');
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'Failed to update');
    } finally {
      setSaving(false);
    }
  };

  const handleTrainerChange = async (uid: string) => {
    setSaving(true);
    try {
      if (uid) await updateMember(gym.id, member.uid, { trainerUid: uid });
      else await clearMemberTrainer(gym.id, member.uid);
      setToast('Trainer updated');
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'Failed to update trainer');
    } finally {
      setSaving(false);
    }
  };

  const startEditNotes = () => { setNotesDraft(member.notes ?? ''); setEditingNotes(true); };
  const saveNotes = async () => {
    setSaving(true);
    try {
      await updateMember(gym.id, member.uid, { notes: notesDraft.trim() || undefined });
      setToast('Notes saved');
      setEditingNotes(false);
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'Failed to save notes');
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    if (!confirm(`Remove ${member.name} from the gym? This can't be undone.`)) return;
    setSaving(true);
    try {
      await removeMember(gym.id, member.uid);
      onBack();
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'Failed to remove member');
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 animate-fadeIn">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className={`p-2 rounded-lg transition-colors ${isDark ? 'hover:bg-[#222]' : 'hover:bg-gray-50'}`}>
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-xl font-bold">{member.name}</h1>
      </div>

      <div className={cardCls}>
        <div className="flex items-center gap-2 mb-2">
          <StatusChip status={status} />
          {canEdit && <span className={`text-xs ${subtle}`}>{member.role !== 'member' ? `· staff (${member.role})` : ''}</span>}
        </div>
        <div className="space-y-1.5 text-sm">
          {member.phone && (
            <a href={`tel:${member.phone}`} className={`flex items-center gap-2 ${isDark ? 'hover:text-orange-400' : 'hover:text-orange-600'}`}>
              <Phone className="w-3.5 h-3.5" /> {member.phone}
            </a>
          )}
          {member.email && (
            <div className="flex items-center gap-2">
              <Mail className="w-3.5 h-3.5" /> {member.email}
            </div>
          )}
          <div className={`flex items-center gap-2 ${subtle}`}>
            <Calendar className="w-3.5 h-3.5" /> Joined {formatDate(member.joinedAt)}
          </div>
        </div>
        <div className={`mt-3 pt-3 border-t text-sm ${isDark ? 'border-[#2e2e2e]' : 'border-gray-100'}`}>
          <div>{planName ?? 'No plan'}</div>
          {member.planEnd && (
            <div className={subtle}>
              Ends {formatDate(member.planEnd)} · {daysLeft(member.planEnd) >= 0 ? `${daysLeft(member.planEnd)}d left` : `${-daysLeft(member.planEnd)}d overdue`}
            </div>
          )}
        </div>
      </div>

      {canEdit && (
        <div className={cardCls}>
          <div className="flex flex-wrap gap-2 mb-3">
            <button
              onClick={() => setShowPayment(true)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gradient-to-r from-orange-500 to-red-600 text-white"
            >
              Record payment
            </button>
            <button
              onClick={toggleFreeze}
              disabled={saving}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium ${isDark ? 'bg-[#252525] text-zinc-300 hover:bg-[#303030]' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
            >
              <Snowflake className="w-3.5 h-3.5" /> {member.frozen ? 'Unfreeze' : 'Freeze'}
            </button>
            <button
              onClick={startEditPlan}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium ${isDark ? 'bg-[#252525] text-zinc-300 hover:bg-[#303030]' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
            >
              <Pencil className="w-3.5 h-3.5" /> Change plan
            </button>
            <button
              onClick={handleRemove}
              disabled={saving}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/10 text-red-500 hover:bg-red-500/20"
            >
              <Trash2 className="w-3.5 h-3.5" /> Remove
            </button>
          </div>

          {editingPlan && (
            <div className={`p-3 rounded-lg mb-3 space-y-3 ${isDark ? 'bg-[#0f0f0f]' : 'bg-gray-50'}`}>
              <div>
                <label className={labelCls}>Plan</label>
                <select value={planIdDraft} onChange={(e) => setPlanIdDraft(e.target.value)} className={inputCls}>
                  <option value="">— none —</option>
                  {gym.plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Start date</label>
                  <input type="date" value={planStartDraft} onChange={(e) => setPlanStartDraft(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>End date</label>
                  <input type="date" value={planEndDraft} onChange={(e) => setPlanEndDraft(e.target.value)} className={inputCls} />
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={savePlan} disabled={saving} className="flex-1 py-2 rounded-lg text-xs font-medium bg-gradient-to-r from-orange-500 to-red-600 text-white disabled:opacity-50">
                  Save
                </button>
                <button onClick={() => setEditingPlan(false)} className={`px-4 py-2 rounded-lg text-xs ${isDark ? 'text-zinc-500 hover:text-zinc-300 bg-zinc-800' : 'text-gray-400 hover:text-gray-600 bg-gray-100'}`}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div className="mb-1">
            <label className={labelCls}>Trainer</label>
            <select value={member.trainerUid ?? ''} onChange={(e) => handleTrainerChange(e.target.value)} disabled={saving} className={inputCls}>
              <option value="">— none —</option>
              {trainers.map((t) => <option key={t.uid} value={t.uid}>{t.name}</option>)}
            </select>
          </div>
        </div>
      )}

      <div className={cardCls}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium">Notes</span>
          {canEdit && !editingNotes && (
            <button onClick={startEditNotes} className={`text-xs ${isDark ? 'text-orange-400' : 'text-orange-600'}`}>Edit</button>
          )}
        </div>
        {editingNotes ? (
          <div className="space-y-2">
            <textarea
              value={notesDraft}
              onChange={(e) => setNotesDraft(e.target.value)}
              rows={3}
              className={inputCls}
              placeholder="Injury notes, preferences, …"
            />
            <div className="flex gap-2">
              <button onClick={saveNotes} disabled={saving} className="flex-1 py-2 rounded-lg text-xs font-medium bg-gradient-to-r from-orange-500 to-red-600 text-white disabled:opacity-50">
                Save
              </button>
              <button onClick={() => setEditingNotes(false)} className={`px-4 py-2 rounded-lg text-xs ${isDark ? 'text-zinc-500 hover:text-zinc-300 bg-zinc-800' : 'text-gray-400 hover:text-gray-600 bg-gray-100'}`}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <p className={`text-sm whitespace-pre-wrap ${member.notes ? '' : subtle}`}>{member.notes || 'No notes yet.'}</p>
        )}
      </div>

      <div className={cardCls}>
        <div className="flex items-center gap-1.5 text-sm font-medium mb-2">
          <Receipt className="w-4 h-4" /> Payment history
        </div>
        {payments.length === 0 ? (
          <p className={`text-sm ${subtle}`}>No payments recorded.</p>
        ) : (
          <div className={`divide-y ${isDark ? 'divide-[#2e2e2e]' : 'divide-gray-100'}`}>
            {payments.map((p) => (
              <div key={p.id} className="py-2 text-sm flex items-center justify-between">
                <div>
                  <div>₹{p.amount.toLocaleString('en-IN')} · {PAYMENT_METHOD_LABEL[p.method]}</div>
                  <div className={`text-xs ${subtle}`}>{formatDate(p.paidAt)} · {p.months}mo{p.note ? ` · ${p.note}` : ''}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={cardCls}>
        <div className="flex items-center gap-1.5 text-sm font-medium mb-2">
          <History className="w-4 h-4" /> Check-in history
        </div>
        {checkins.length === 0 ? (
          <p className={`text-sm ${subtle}`}>No check-ins in the last 60 days.</p>
        ) : (
          <div className={`divide-y ${isDark ? 'divide-[#2e2e2e]' : 'divide-gray-100'}`}>
            {checkins.map((c) => (
              <div key={c.id} className="py-2 text-sm flex items-center justify-between">
                <span>{formatDate(c.at)} · {new Date(c.at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
                <span className={`text-xs capitalize ${subtle}`}>{c.method.replace('-', ' ')}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {showPayment && (
        <StaffPaymentSheet
          isDark={isDark}
          gymId={gym.id}
          member={member}
          plans={gym.plans}
          onClose={() => setShowPayment(false)}
          onSuccess={() => {
            setShowPayment(false);
            setToast('Payment recorded');
            setRefreshTick((n) => n + 1);
          }}
        />
      )}
      <StaffToast message={toast} isDark={isDark} onDismiss={() => setToast(null)} />
    </div>
  );
}
