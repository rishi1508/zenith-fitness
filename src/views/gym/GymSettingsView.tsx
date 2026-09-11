import { useEffect, useState } from 'react';
import { ArrowLeft, Copy, Plus, X, RotateCw } from 'lucide-react';
import type { GymViewProps } from './types';
import type { Gym, GymPlan, GymMember, GymRole } from '../../types';
import { useGym } from '../../gym/GymContext';
import { useAuth } from '../../auth/AuthContext';
import { isAdmin } from '../../admin';
import { updateGym, setStaffRole, listenToMembers } from '../../gymService';
import { DEFAULT_GEOFENCE_M, positionFailureMessage, requestPosition } from '../../geo';
import { addStaffByEmail, clearGymAccentColor, clearGymLocation, regenerateJoinCode } from '../../gymStaffHelpers';
import { QrCode } from '../../components';
import { useToast, useConfirm } from '../../ui';

const ACCENT_PRESETS = [
  '#f97316', '#ef4444', '#f59e0b', '#10b981', '#14b8a6', '#3b82f6', '#6366f1', '#a855f7',
];
const STAFF_ROLES: Exclude<GymRole, 'member'>[] = ['trainer', 'manager', 'owner'];

/** Owner-only gym settings — see docs/GYM_TIER_A_SPEC.md §6.3. */
export function GymSettingsView({ isDark, onBack }: GymViewProps) {
  const { gym, role } = useGym();
  const { user } = useAuth();
  const canView = role === 'owner' || isAdmin(user?.uid);

  const subtle = isDark ? 'text-zinc-500' : 'text-gray-500';
  const cardCls = `rounded-xl border p-4 ${isDark ? 'bg-[#1a1a1a] border-[#2e2e2e]' : 'bg-white border-gray-200'}`;

  const header = (
    <div className="flex items-center gap-3">
      <button aria-label="Back" onClick={onBack} className={`p-2 rounded-lg transition-colors ${isDark ? 'hover:bg-[#222]' : 'hover:bg-gray-50'}`}>
        <ArrowLeft className="w-5 h-5" />
      </button>
      <h1 className="text-xl font-bold">Gym Settings</h1>
    </div>
  );

  if (!canView) {
    return (
      <div className="space-y-4 animate-fadeIn">
        {header}
        <div className={cardCls}><p className={`text-sm ${subtle}`}>Owner only.</p></div>
      </div>
    );
  }
  if (!gym) {
    return (
      <div className="space-y-4 animate-fadeIn">
        {header}
        <div className={cardCls}><p className={`text-sm ${subtle}`}>Loading…</p></div>
      </div>
    );
  }

  return <GymSettingsForm isDark={isDark} header={header} gym={gym} />;
}

function GymSettingsForm({ isDark, header, gym }: { isDark: boolean; header: React.ReactNode; gym: Gym }) {
  const [name, setName] = useState(gym.name);
  const [location, setLocation] = useState(gym.location ?? null);
  const [geofenceM, setGeofenceM] = useState(String(gym.geofenceM ?? DEFAULT_GEOFENCE_M));
  const [locating, setLocating] = useState(false);
  const [savingLocation, setSavingLocation] = useState(false);
  const [address, setAddress] = useState(gym.address ?? '');
  const [phone, setPhone] = useState(gym.phone ?? '');
  const [upiVpa, setUpiVpa] = useState(gym.upiVpa ?? '');
  const [marketingSpend, setMarketingSpend] = useState(gym.marketingSpendMonthly ? String(gym.marketingSpendMonthly) : '');
  const [logoUrl, setLogoUrl] = useState(gym.logoUrl ?? '');
  const [accentColor, setAccentColor] = useState(gym.accentColor ?? '');
  const [savingProfile, setSavingProfile] = useState(false);

  const [plans, setPlans] = useState<GymPlan[]>(gym.plans);
  const [savingPlans, setSavingPlans] = useState(false);

  const [staffMembers, setStaffMembers] = useState<GymMember[]>([]);
  const [staffEmail, setStaffEmail] = useState('');
  const [staffRoleInput, setStaffRoleInput] = useState<Exclude<GymRole, 'member'>>('trainer');
  const [addingStaff, setAddingStaff] = useState(false);

  const [regenerating, setRegenerating] = useState(false);
  const { showToast } = useToast();

  useEffect(() => listenToMembers(gym.id, setStaffMembers), [gym.id]);

  const subtle = isDark ? 'text-zinc-500' : 'text-gray-500';
  const cardCls = `rounded-xl border p-4 ${isDark ? 'bg-[#1a1a1a] border-[#2e2e2e]' : 'bg-white border-gray-200'}`;
  const inputCls = `w-full rounded-lg px-3 py-2 text-sm border focus:outline-none focus:border-orange-500 ${
    isDark ? 'bg-[#0f0f0f] border-[#2e2e2e] text-white placeholder-zinc-600' : 'bg-gray-50 border-gray-200 placeholder-gray-400'
  }`;
  const labelCls = `text-xs font-medium mb-1 block ${subtle}`;
  const nameByUid = new Map(staffMembers.map((m) => [m.uid, m.name]));

  const handleSaveProfile = async () => {
    setSavingProfile(true);
    try {
      if (!accentColor && gym.accentColor) await clearGymAccentColor(gym.id);
      await updateGym(gym.id, {
        name: name.trim(),
        address: address.trim() || undefined,
        phone: phone.trim() || undefined,
        upiVpa: upiVpa.trim() || undefined,
        // 0 rather than undefined, so emptying the field really clears it
        // (updateGym drops undefined keys instead of unsetting them).
        marketingSpendMonthly: Math.max(0, Math.round(Number(marketingSpend) || 0)),
        logoUrl: logoUrl.trim() || undefined,
        accentColor: accentColor || undefined,
      });
      showToast('Gym profile saved');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save', 'error');
    } finally {
      setSavingProfile(false);
    }
  };

  /** Stand at the front desk and press the button — that fix becomes the
   *  centre of the geofence. */
  const captureLocation = async () => {
    setLocating(true);
    try {
      const pos = await requestPosition();
      if (!pos.ok) { showToast(positionFailureMessage(pos.reason), 'error'); return; }
      setLocation(pos.coords);
      showToast(`Location captured (±${Math.round(pos.accuracyM)} m). Save to apply.`);
    } finally {
      setLocating(false);
    }
  };

  const handleSaveLocation = async () => {
    setSavingLocation(true);
    try {
      const radius = Math.max(30, Math.min(1000, Math.round(Number(geofenceM) || DEFAULT_GEOFENCE_M)));
      if (!location && gym.location) await clearGymLocation(gym.id);
      await updateGym(gym.id, { location: location ?? undefined, geofenceM: radius });
      setGeofenceM(String(radius));
      showToast(location ? 'Check-in area saved' : 'Check-in area cleared');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save', 'error');
    } finally {
      setSavingLocation(false);
    }
  };

  const updatePlan = (id: string, patch: Partial<GymPlan>) => {
    setPlans((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  };
  const removePlan = (id: string) => setPlans((prev) => prev.filter((p) => p.id !== id));
  const addPlan = () => setPlans((prev) => [...prev, { id: `plan_${crypto.randomUUID()}`, name: '', months: 1, price: 0, active: true }]);
  const handleSavePlans = async () => {
    setSavingPlans(true);
    try {
      await updateGym(gym.id, { plans });
      showToast('Plans saved');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save plans', 'error');
    } finally {
      setSavingPlans(false);
    }
  };

  const handleRoleChange = async (uid: string, newRole: Exclude<GymRole, 'member'>) => {
    try {
      await setStaffRole(gym.id, uid, newRole);
      showToast('Role updated');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to update role', 'error');
    }
  };
  const { confirm: confirmDialog } = useConfirm();
  const handleRemoveStaff = async (uid: string) => {
    if (!(await confirmDialog({ title: 'Remove staff?', message: 'This person will lose staff access to the gym.', confirmLabel: 'Remove', tone: 'danger' }))) return;
    try {
      await setStaffRole(gym.id, uid, null);
      showToast('Staff removed');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to remove staff', 'error');
    }
  };
  const handleAddStaff = async () => {
    if (!staffEmail.trim()) return;
    setAddingStaff(true);
    try {
      const { name: addedName } = await addStaffByEmail(gym.id, staffEmail.trim(), staffRoleInput);
      showToast(`${addedName} added as ${staffRoleInput}`);
      setStaffEmail('');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to add staff', 'error');
    } finally {
      setAddingStaff(false);
    }
  };

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(gym.joinCode);
      showToast('Join code copied');
    } catch {
      showToast('Could not copy — copy it manually', 'error');
    }
  };
  const handleRegenerate = async () => {
    if (!(await confirmDialog({ title: 'New join code?', message: 'The old code will stop working immediately.', confirmLabel: 'Generate' }))) return;
    setRegenerating(true);
    try {
      await regenerateJoinCode(gym.id, gym.joinCode);
      showToast('Join code regenerated');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to regenerate code', 'error');
    } finally {
      setRegenerating(false);
    }
  };

  return (
    <div className="space-y-4 animate-fadeIn">
      {header}

      <div className={cardCls}>
        <div className="text-sm font-medium mb-3">Gym profile</div>
        <div className="space-y-3">
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
              <label className={labelCls}>Logo URL</label>
              <input type="url" value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} className={inputCls} />
            </div>
          </div>
          <div>
            <label className={labelCls}>Address</label>
            <input type="text" value={address} onChange={(e) => setAddress(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>UPI id <span className="opacity-70">· used for renewal payment links</span></label>
            <input
              type="text" value={upiVpa} onChange={(e) => setUpiVpa(e.target.value)}
              placeholder="irontemple@okhdfc" className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Marketing spend / month (₹) <span className="opacity-70">· gives Analytics a cost per member</span></label>
            <input
              type="number" inputMode="numeric" min="0" value={marketingSpend}
              onChange={(e) => setMarketingSpend(e.target.value)}
              placeholder="0" className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Accent colour</label>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setAccentColor('')}
                className={`w-8 h-8 rounded-full border-2 flex items-center justify-center text-[9px] font-semibold ${
                  accentColor === '' ? 'border-white ring-2 ring-orange-500' : isDark ? 'border-[#2e2e2e]' : 'border-gray-200'
                } ${isDark ? 'bg-[#252525] text-zinc-400' : 'bg-gray-100 text-gray-500'}`}
              >
                None
              </button>
              {ACCENT_PRESETS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setAccentColor(c)}
                  style={{ backgroundColor: c }}
                  className={`w-8 h-8 rounded-full border-2 ${accentColor === c ? 'border-white ring-2 ring-offset-1 ring-offset-transparent' : 'border-transparent'}`}
                  aria-label={c}
                />
              ))}
            </div>
          </div>
          <button
            onClick={handleSaveProfile}
            disabled={savingProfile}
            className="w-full py-2.5 rounded-lg text-sm font-medium bg-gradient-to-r from-orange-500 to-red-600 text-white disabled:opacity-50"
          >
            {savingProfile ? 'Saving…' : 'Save profile'}
          </button>
        </div>
      </div>

      {/* Check-in area — stops the poster QR working from the car park. */}
      <div className={cardCls}>
        <div className="text-sm font-medium mb-1">Check-in area</div>
        <p className={`text-xs mb-3 ${subtle}`}>
          Members scanning the poster QR must be inside this circle. Stand at the front desk and
          capture the spot. Today's 6-digit code always works, wherever they are — that is the
          fallback when a phone cannot get a fix.
        </p>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Centre</label>
              <div className={`text-sm ${location ? '' : subtle}`}>
                {location ? `${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}` : 'Not set'}
              </div>
            </div>
            <div>
              <label className={labelCls}>Radius (m)</label>
              <input
                type="number" min="30" max="1000" value={geofenceM}
                onChange={(e) => setGeofenceM(e.target.value)} className={inputCls}
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => { void captureLocation(); }}
              disabled={locating}
              className={`flex-1 py-2.5 rounded-lg text-sm font-medium border disabled:opacity-50 ${isDark ? 'border-[#2e2e2e]' : 'border-gray-200'}`}
            >
              {locating ? 'Finding…' : location ? 'Re-capture here' : 'Use my location'}
            </button>
            {location && (
              <button
                onClick={() => setLocation(null)}
                className={`px-3 py-2.5 rounded-lg text-sm font-medium border ${isDark ? 'border-[#2e2e2e]' : 'border-gray-200'}`}
              >
                Clear
              </button>
            )}
          </div>
          <button
            onClick={() => { void handleSaveLocation(); }}
            disabled={savingLocation}
            className="w-full py-2.5 rounded-lg text-sm font-medium bg-gradient-to-r from-orange-500 to-red-600 text-white disabled:opacity-50"
          >
            {savingLocation ? 'Saving…' : 'Save check-in area'}
          </button>
        </div>
      </div>

      <div className={cardCls}>
        <div className="text-sm font-medium mb-3">Plans</div>
        <div className="space-y-2">
          {plans.map((p) => (
            <div key={p.id} className={`rounded-lg p-3 space-y-2 ${isDark ? 'bg-[#0f0f0f]' : 'bg-gray-50'}`}>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={p.name}
                  onChange={(e) => updatePlan(p.id, { name: e.target.value })}
                  placeholder="Plan name"
                  className={`${inputCls} flex-1`}
                />
                <button onClick={() => removePlan(p.id)} className="p-2 text-red-500 hover:text-red-400">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={labelCls}>Months</label>
                  <input type="number" value={p.months} onChange={(e) => updatePlan(p.id, { months: Number(e.target.value) || 0 })} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Price (₹)</label>
                  <input type="number" value={p.price} onChange={(e) => updatePlan(p.id, { price: Number(e.target.value) || 0 })} className={inputCls} />
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input type="checkbox" checked={p.active} onChange={(e) => updatePlan(p.id, { active: e.target.checked })} className="w-3.5 h-3.5 accent-orange-500" />
                Active
              </label>
            </div>
          ))}
        </div>
        <button
          onClick={addPlan}
          className={`w-full mt-2 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium border-2 border-dashed ${
            isDark ? 'border-[#3e3e3e] text-zinc-400 hover:border-orange-500/50 hover:text-orange-400' : 'border-gray-200 text-gray-500 hover:border-orange-400 hover:text-orange-600'
          }`}
        >
          <Plus className="w-3.5 h-3.5" /> Add plan
        </button>
        <button
          onClick={handleSavePlans}
          disabled={savingPlans}
          className="w-full mt-2 py-2.5 rounded-lg text-sm font-medium bg-gradient-to-r from-orange-500 to-red-600 text-white disabled:opacity-50"
        >
          {savingPlans ? 'Saving…' : 'Save plans'}
        </button>
      </div>

      <div className={cardCls}>
        <div className="text-sm font-medium mb-3">Staff</div>
        <div className="space-y-2 mb-3">
          {Object.entries(gym.staff).map(([uid, staffRole]) => (
            <div key={uid} className="flex items-center justify-between gap-2">
              <span className="text-sm truncate">{nameByUid.get(uid) ?? uid}</span>
              <div className="flex items-center gap-2 shrink-0">
                <select
                  value={staffRole}
                  onChange={(e) => handleRoleChange(uid, e.target.value as Exclude<GymRole, 'member'>)}
                  className={`rounded-lg px-2 py-1 text-xs border ${isDark ? 'bg-[#0f0f0f] border-[#2e2e2e] text-white' : 'bg-gray-50 border-gray-200'}`}
                >
                  {STAFF_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
                <button onClick={() => handleRemoveStaff(uid)} className="text-xs text-red-500 hover:text-red-400">Remove</button>
              </div>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="email"
            value={staffEmail}
            onChange={(e) => setStaffEmail(e.target.value)}
            placeholder="Add by email…"
            className={`${inputCls} flex-1`}
          />
          <select
            value={staffRoleInput}
            onChange={(e) => setStaffRoleInput(e.target.value as Exclude<GymRole, 'member'>)}
            className={`rounded-lg px-2 py-2 text-xs border ${isDark ? 'bg-[#0f0f0f] border-[#2e2e2e] text-white' : 'bg-gray-50 border-gray-200'}`}
          >
            {STAFF_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <button
            onClick={handleAddStaff}
            disabled={addingStaff || !staffEmail.trim()}
            className="px-3 py-2 rounded-lg text-xs font-medium bg-gradient-to-r from-orange-500 to-red-600 text-white disabled:opacity-50 whitespace-nowrap"
          >
            {addingStaff ? 'Adding…' : 'Add'}
          </button>
        </div>
      </div>

      <div className={`${cardCls} flex flex-col items-center text-center`}>
        <div className="text-sm font-medium mb-3 self-start">Join code</div>
        <div className="text-3xl font-mono font-bold tracking-[0.3em] mb-2">{gym.joinCode}</div>
        <div className="flex gap-2 mb-4">
          <button onClick={handleCopyCode} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium ${isDark ? 'bg-[#252525] text-zinc-300 hover:bg-[#303030]' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
            <Copy className="w-3.5 h-3.5" /> Copy
          </button>
          <button
            onClick={handleRegenerate}
            disabled={regenerating}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium ${isDark ? 'bg-[#252525] text-zinc-300 hover:bg-[#303030]' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
          >
            <RotateCw className={`w-3.5 h-3.5 ${regenerating ? 'animate-spin' : ''}`} /> Regenerate
          </button>
        </div>
        <QrCode value={`zenith://gym/${gym.id}/join`} size={180} isDark={isDark} label="Join QR" />
      </div>

    </div>
  );
}
