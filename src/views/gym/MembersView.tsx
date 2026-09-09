import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Search, UserPlus, X } from 'lucide-react';
import type { GymViewProps } from './types';
import type { GymMember, GymPlan, MembershipStatus, PaymentMethod } from '../../types';
import { useGym } from '../../gym/GymContext';
import { useAuth } from '../../auth/AuthContext';
import { isAdmin } from '../../admin';
import { addMember, listenToMembers, membershipStatus, recordPayment } from '../../gymService';
import { inviteMemberByEmail, searchUserProfiles } from '../../gymStaffHelpers';
import { localDateISO } from '../../gymStats';
import { StaffMemberRow } from '../../components/gym/StaffMemberRow';
import { useToast } from '../../ui';

const FILTERS: Array<{ id: MembershipStatus | 'all'; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'expiring', label: 'Expiring' },
  { id: 'expired', label: 'Expired' },
  { id: 'frozen', label: 'Frozen' },
  { id: 'none', label: 'No plan' },
];

const METHODS: Array<{ id: PaymentMethod; label: string }> = [
  { id: 'upi', label: 'UPI' },
  { id: 'cash', label: 'Cash' },
  { id: 'card', label: 'Card' },
  { id: 'other', label: 'Other' },
];

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function memberSubtitle(m: GymMember, plans: GymPlan[]): string {
  const planName = plans.find((p) => p.id === m.planId)?.name;
  if (!m.planEnd) return planName ?? 'No plan';
  return `${planName ?? 'Plan'} · ends ${formatDate(m.planEnd)}`;
}

/** Members directory — see docs/GYM_TIER_A_SPEC.md §6.3. */
export function MembersView({ isDark, onBack, onNavigate, membersFilter }: GymViewProps) {
  const { gym, role } = useGym();
  const { user } = useAuth();
  const canEdit = role === 'manager' || role === 'owner' || isAdmin(user?.uid);

  const [members, setMembers] = useState<GymMember[]>([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<MembershipStatus | 'all'>(membersFilter ?? 'all');
  const [showAdd, setShowAdd] = useState(false);
  const { showToast } = useToast();

  useEffect(() => {
    const gymId = gym?.id;
    if (!gymId) return;
    return listenToMembers(gymId, setMembers);
  }, [gym?.id]);

  const trainers = useMemo(() => members.filter((m) => m.role === 'trainer'), [members]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    let list = members;
    if (filter !== 'all') list = list.filter((m) => membershipStatus(m) === filter);
    if (term) list = list.filter((m) => m.name.toLowerCase().includes(term) || (m.phone ?? '').includes(term));
    return [...list].sort((a, b) => (a.planEnd ?? '9999-99-99').localeCompare(b.planEnd ?? '9999-99-99'));
  }, [members, filter, search]);

  const subtle = isDark ? 'text-zinc-500' : 'text-gray-500';
  const cardCls = `rounded-xl border p-2 ${isDark ? 'bg-[#1a1a1a] border-[#2e2e2e]' : 'bg-white border-gray-200'}`;
  const inputCls = `w-full rounded-lg pl-10 pr-4 py-2.5 text-sm border focus:outline-none focus:border-orange-500 ${
    isDark ? 'bg-[#1a1a1a] border-[#2e2e2e] text-white placeholder-zinc-600' : 'bg-white border-gray-200 placeholder-gray-400'
  }`;

  const chip = (active: boolean) => `px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
    active
      ? 'bg-gradient-to-r from-orange-500 to-red-600 text-white'
      : isDark ? 'bg-[#252525] text-zinc-400 hover:bg-[#303030]' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
  }`;

  return (
    <div className="space-y-4 animate-fadeIn">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button aria-label="Back" onClick={onBack} className={`p-2 rounded-lg transition-colors ${isDark ? 'hover:bg-[#222]' : 'hover:bg-gray-50'}`}>
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-xl font-bold">Members</h1>
        </div>
        {canEdit && (
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-gradient-to-r from-orange-500 to-red-600 text-white"
          >
            <UserPlus className="w-4 h-4" /> Add
          </button>
        )}
      </div>

      <div className="relative">
        <Search className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${subtle}`} />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name or phone…"
          className={inputCls}
        />
      </div>

      <div className="flex gap-1.5 overflow-x-auto [&::-webkit-scrollbar]:hidden">
        {FILTERS.map((f) => (
          <button key={f.id} onClick={() => setFilter(f.id)} className={chip(filter === f.id)}>{f.label}</button>
        ))}
      </div>

      <div className={`text-xs ${subtle}`}>{filtered.length} member{filtered.length === 1 ? '' : 's'}</div>

      <div className={cardCls}>
        {filtered.length === 0 ? (
          <p className={`text-sm p-3 ${subtle}`}>No members match.</p>
        ) : (
          <div className={`divide-y ${isDark ? 'divide-[#2e2e2e]' : 'divide-gray-100'}`}>
            {filtered.map((m) => (
              <StaffMemberRow
                key={m.uid}
                member={m}
                isDark={isDark}
                subtitle={memberSubtitle(m, gym?.plans ?? [])}
                onClick={() => onNavigate('gym-member', { memberUid: m.uid })}
              />
            ))}
          </div>
        )}
      </div>

      {showAdd && gym && (
        <AddMemberSheet
          isDark={isDark}
          gymId={gym.id}
          plans={gym.plans}
          trainers={trainers}
          onClose={() => setShowAdd(false)}
          onSuccess={() => { setShowAdd(false); showToast('Member added'); }}
        />
      )}
    </div>
  );
}

interface AddMemberSheetProps {
  isDark: boolean;
  gymId: string;
  plans: GymPlan[];
  trainers: GymMember[];
  onClose: () => void;
  onSuccess: () => void;
}

function AddMemberSheet({ isDark, gymId, plans, trainers, onClose, onSuccess }: AddMemberSheetProps) {
  const activePlans = plans.filter((p) => p.active);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [planId, setPlanId] = useState('');
  const [startDate, setStartDate] = useState(localDateISO(new Date()));
  const [trainerUid, setTrainerUid] = useState('');
  const [recordNow, setRecordNow] = useState(false);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('upi');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lookup, setLookup] = useState('');
  const [found, setFound] = useState<Array<{ uid: string; name: string; email?: string }>>([]);
  const [searching, setSearching] = useState(false);
  const [invite, setInvite] = useState(false);

  // Debounced people search — two queries, only once the term is worth it.
  useEffect(() => {
    const term = lookup.trim();
    if (term.length < 2) { setFound([]); setSearching(false); return; }
    setSearching(true);
    const t = setTimeout(() => {
      void searchUserProfiles(term)
        .then((rows) => setFound(rows))
        .catch(() => setFound([]))
        .finally(() => setSearching(false));
    }, 350);
    return () => clearTimeout(t);
  }, [lookup]);

  const choosePlan = (id: string) => {
    setPlanId(id);
    const plan = plans.find((p) => p.id === id);
    if (plan) setAmount(String(plan.price));
  };

  const inputCls = `w-full rounded-lg px-3 py-2 text-sm border focus:outline-none focus:border-orange-500 ${
    isDark ? 'bg-[#0f0f0f] border-[#2e2e2e] text-white placeholder-zinc-600' : 'bg-gray-50 border-gray-200 placeholder-gray-400'
  }`;
  const labelCls = `text-xs font-medium mb-1 block ${isDark ? 'text-zinc-400' : 'text-gray-500'}`;
  const subtle = isDark ? 'text-zinc-500' : 'text-gray-500';

  const handleSubmit = async () => {
    if (!name.trim()) { setError('Name is required'); return; }
    if (recordNow && !planId) { setError('Pick a plan to record a payment'); return; }
    setSaving(true);
    setError(null);
    try {
      // When a first payment is recorded, the plan is assigned via
      // recordPayment (which renews from scratch since the member has no
      // existing planEnd yet) — passing planId/planStart here too would
      // double the period by having addMember set the dates AND
      // recordPayment's renewal extend them again.
      // An invite creates the same membership and a claim record keyed to
      // the email; anything else is the plain add, which already links to an
      // existing Zenith account when the address matches one.
      const created = invite && email.trim()
        ? { uid: (await inviteMemberByEmail(gymId, {
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim() || undefined,
          planId: recordNow ? undefined : (planId || undefined),
        })).uid }
        : await addMember(gymId, {
          name: name.trim(),
          phone: phone.trim() || undefined,
          email: email.trim() || undefined,
          planId: recordNow ? undefined : (planId || undefined),
          planStart: recordNow ? undefined : startDate,
          trainerUid: trainerUid || undefined,
        });
      if (recordNow && planId) {
        const plan = plans.find((p) => p.id === planId);
        await recordPayment(gymId, {
          uid: created.uid,
          amount: Number(amount) || plan?.price || 0,
          method,
          months: plan?.months ?? 1,
          planId,
        });
      }
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add member');
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
          <h3 className="font-bold">Add member</h3>
          <button aria-label="Close" onClick={onClose} className={`p-1.5 rounded-lg ${isDark ? 'text-zinc-500 hover:text-white hover:bg-[#252525]' : 'text-gray-400 hover:text-gray-900 hover:bg-gray-100'}`}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          {/* Most people the front desk adds already have Zenith. Look them up
              rather than retyping what the app already knows. */}
          <div>
            <label className={labelCls}>Find them on Zenith</label>
            <input
              type="text"
              value={lookup}
              onChange={(e) => setLookup(e.target.value)}
              placeholder="Name or email"
              className={inputCls}
            />
            {searching && <p className={`text-xs mt-1 ${subtle}`}>Searching…</p>}
            {found.length > 0 && (
              <div className={`mt-2 rounded-lg border divide-y ${isDark ? 'border-[#2e2e2e] divide-[#2e2e2e]' : 'border-gray-200 divide-gray-100'}`}>
                {found.map((u) => (
                  <button
                    key={u.uid}
                    type="button"
                    onClick={() => { setName(u.name); setEmail(u.email ?? ''); setLookup(''); setFound([]); }}
                    className="w-full px-3 py-2.5 flex items-center gap-2.5 text-left"
                  >
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium truncate">{u.name}</span>
                      {u.email && <span className={`block text-xs truncate ${subtle}`}>{u.email}</span>}
                    </span>
                    <span className="text-xs font-semibold text-orange-400 shrink-0">Use</span>
                  </button>
                ))}
              </div>
            )}
            {lookup.trim().length >= 2 && !searching && found.length === 0 && (
              <p className={`text-xs mt-1 ${subtle}`}>
                Nobody on Zenith by that name. Fill the details below and tick "invite by email" to
                set them up — they join by signing in with that address.
              </p>
            )}
          </div>

          <div>
            <label className={labelCls}>Name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Phone</label>
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Email (optional)</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
            </div>
          </div>

          {email.trim() && (
            <label className="flex items-start gap-2 text-xs cursor-pointer">
              <input type="checkbox" checked={invite} onChange={(e) => setInvite(e.target.checked)} className="mt-0.5" />
              <span className={subtle}>
                Invite by email — they claim this membership the first time they sign in to Zenith with
                that address. No password to send: Zenith signs them in by email.
              </span>
            </label>
          )}

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

          {!recordNow && (
            <div>
              <label className={labelCls}>Start date</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputCls} />
            </div>
          )}

          {trainers.length > 0 && (
            <div>
              <label className={labelCls}>Trainer (optional)</label>
              <select value={trainerUid} onChange={(e) => setTrainerUid(e.target.value)} className={inputCls}>
                <option value="">— none —</option>
                {trainers.map((t) => <option key={t.uid} value={t.uid}>{t.name}</option>)}
              </select>
            </div>
          )}

          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={recordNow} onChange={(e) => setRecordNow(e.target.checked)} className="w-4 h-4 accent-orange-500" />
            Record first payment now
          </label>

          {recordNow && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Amount (₹)</label>
                <input type="number" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Method</label>
                <select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} className={inputCls}>
                  {METHODS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </div>
            </div>
          )}

          {error && <p className="text-xs text-red-500">{error}</p>}

          <button
            onClick={handleSubmit}
            disabled={saving}
            className="w-full py-2.5 rounded-lg text-sm font-medium bg-gradient-to-r from-orange-500 to-red-600 text-white disabled:opacity-50"
          >
            {saving ? 'Adding…' : 'Add member'}
          </button>
        </div>
      </div>
    </div>
  );
}
