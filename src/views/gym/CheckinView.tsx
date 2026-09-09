import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, ScanLine, KeyRound, QrCode as QrCodeIcon, CheckCircle2 } from 'lucide-react';
import type { GymViewProps } from './types';
import type { GymCheckin } from '../../types';
import { useGym } from '../../gym/GymContext';
import { useAuth } from '../../auth/AuthContext';
import { checkinMember, dailyCodeHashIfValid, memberQrPayload, parseQrPayload, listCheckins } from '../../gymService';
import { localDateISO, addDaysISO } from '../../gymStats';
import { startOfWeekISO } from '../../gymMemberHelpers';
import { hapticNotification } from '../../haptics';
import { DEFAULT_GEOFENCE_M, formatDistance, positionFailureMessage, requestPosition, withinGeofence } from '../../geo';
import { QrCode, QrScanner, MemberCodeInput } from '../../components';
import { useToast } from '../../ui';

type Tab = 'scan' | 'code' | 'myqr';
const WEEKDAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** Member check-in: Scan (gym QR), Code (today's staff-rotated 6-digit
 *  code), or My QR (staff scans this instead). Shows today's check-in
 *  state and a 7-dot strip for this week. */
export function CheckinView({ isDark, onBack }: GymViewProps) {
  const { gym, membership } = useGym();
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>('scan');
  const [digits, setDigits] = useState<string[]>(Array(6).fill(''));
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [weekCheckins, setWeekCheckins] = useState<GymCheckin[] | null>(null);
  const { showToast } = useToast();

  const cardBg = isDark ? 'bg-[#1a1a1a]' : 'bg-white';
  const cardBorder = isDark ? 'border-[#2e2e2e]' : 'border-gray-200';
  const subtle = isDark ? 'text-zinc-500' : 'text-gray-500';

  const today = localDateISO(new Date());
  const checkedInToday = !!membership?.lastCheckinAt && membership.lastCheckinAt.slice(0, 10) === today;
  const checkedInTime = checkedInToday && membership?.lastCheckinAt
    ? new Date(membership.lastCheckinAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })
    : null;

  const loadWeek = useCallback(() => {
    if (!gym || !user) return;
    const weekStart = startOfWeekISO();
    const weekDates = new Set(Array.from({ length: 7 }, (_, i) => addDaysISO(weekStart, i)));
    const eightDaysAgo = new Date(Date.now() - 8 * 86_400_000).toISOString();
    listCheckins(gym.id, { sinceISO: eightDaysAgo, uid: user.uid, limit: 20 })
      .then((rows) => setWeekCheckins(rows.filter((c) => weekDates.has(c.date))))
      .catch((err) => console.warn('[Checkin] failed to load this week:', err));
  }, [gym, user]);

  useEffect(() => { loadWeek(); }, [loadWeek]);

  const afterSuccess = async () => {
    await hapticNotification('success');
    showToast('Checked in!');
    loadWeek();
  };

  const handleScan = async (text: string) => {
    if (!gym || !user || busy) return;
    const parsed = parseQrPayload(text);
    if (!parsed || parsed.kind !== 'gym-checkin' || parsed.gymId !== gym.id) {
      showToast("That QR isn't this gym's check-in code.", 'error');
      return;
    }
    setBusy(true);
    try {
      // The poster QR is a photo away from being everywhere, so when the
      // owner has set a check-in area the phone has to actually be in it.
      // Note this is an honesty check, not proof: it runs on the member's
      // device. The distance is stored on the check-in so staff can see it.
      let distanceM: number | undefined;
      if (gym.location) {
        setLocating(true);
        const pos = await requestPosition();
        setLocating(false);
        if (!pos.ok) {
          showToast(positionFailureMessage(pos.reason), 'error');
          setTab('code');
          return;
        }
        // A poor fix shouldn't lock a member out: allow their own accuracy
        // circle on top of the gym's radius.
        const radius = (gym.geofenceM ?? DEFAULT_GEOFENCE_M) + Math.min(pos.accuracyM, 100);
        const fence = withinGeofence(pos.coords, gym.location, radius);
        if (!fence.ok) {
          showToast(`You're about ${formatDistance(fence.distanceM)} from ${gym.name}. Check in when you get there.`, 'error');
          return;
        }
        distanceM = fence.distanceM;
      }
      await checkinMember(gym.id, user.uid, 'member-qr', distanceM !== undefined ? { distanceM } : undefined);
      await afterSuccess();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Check-in failed.', 'error');
    } finally {
      setLocating(false);
      setBusy(false);
    }
  };

  const submitCode = async (value: string) => {
    if (!gym || !user || busy) return;
    setBusy(true);
    try {
      const codeHash = await dailyCodeHashIfValid(gym, value);
      if (!codeHash) {
        showToast('Wrong code, or it has expired.', 'error');
        setDigits(Array(6).fill(''));
        return;
      }
      await checkinMember(gym.id, user.uid, 'code', { codeHash });
      await afterSuccess();
      setDigits(Array(6).fill(''));
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Check-in failed.', 'error');
    } finally {
      setBusy(false);
    }
  };

  if (!gym || !membership) {
    return (
      <div className="space-y-4 animate-fadeIn">
        <div className="flex items-center gap-3">
          <button aria-label="Back" onClick={onBack} className={`p-2 rounded-lg transition-colors ${isDark ? 'hover:bg-[#222]' : 'hover:bg-gray-50'}`}>
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-xl font-bold">Check In</h1>
        </div>
        <div className={`rounded-xl border p-6 text-center text-sm ${cardBg} ${cardBorder} ${subtle}`}>Loading your membership…</div>
      </div>
    );
  }

  const weekStart = startOfWeekISO();
  const weekDates = Array.from({ length: 7 }, (_, i) => addDaysISO(weekStart, i));
  const checkinDates = new Set((weekCheckins ?? []).map((c) => c.date));

  return (
    <div className="space-y-4 animate-fadeIn">
      <div className="flex items-center gap-3">
        <button aria-label="Back" onClick={onBack} className={`p-2 rounded-lg transition-colors ${isDark ? 'hover:bg-[#222]' : 'hover:bg-gray-50'}`}>
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-xl font-bold">Check In</h1>
      </div>

      {checkedInToday && (
        <div className={`rounded-xl border p-3 flex items-center gap-2 text-sm font-medium ${cardBg} ${cardBorder} text-emerald-500`}>
          <CheckCircle2 className="w-4 h-4 shrink-0" /> Checked in today at {checkedInTime}
        </div>
      )}

      <div className={`rounded-xl border p-4 ${cardBg} ${cardBorder}`}>
        <div className="flex justify-between">
          {weekDates.map((d, i) => (
            <div key={d} className="flex flex-col items-center gap-1">
              <span className={`text-[10px] ${subtle}`}>{WEEKDAY_LETTERS[i]}</span>
              <span
                className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
                  checkinDates.has(d)
                    ? 'bg-gradient-to-r from-orange-500 to-red-600 text-white'
                    : isDark ? 'bg-[#252525] text-zinc-600' : 'bg-gray-100 text-gray-400'
                } ${d === today ? 'ring-2 ring-orange-400' : ''}`}
              >
                {checkinDates.has(d) && <CheckCircle2 className="w-3.5 h-3.5" />}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className={`rounded-xl border p-5 space-y-5 ${cardBg} ${cardBorder}`}>
        <div className={`flex rounded-lg overflow-hidden border ${cardBorder}`}>
          {([
            { id: 'scan' as const, label: 'Scan', icon: <ScanLine className="w-4 h-4" /> },
            { id: 'code' as const, label: 'Code', icon: <KeyRound className="w-4 h-4" /> },
            { id: 'myqr' as const, label: 'My QR', icon: <QrCodeIcon className="w-4 h-4" /> },
          ]).map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 py-2 text-sm font-medium flex items-center justify-center gap-1.5 ${
                tab === t.id ? 'bg-gradient-to-r from-orange-500 to-red-600 text-white' : subtle
              }`}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {tab === 'scan' && (
          <div className="space-y-2">
            <QrScanner isDark={isDark} onResult={handleScan} active={!busy} hint="Point at the gym's check-in QR" />
            {locating && <p className={`text-sm text-center ${subtle}`}>Confirming you're at the gym…</p>}
            {gym.location && !locating && (
              <p className={`text-xs text-center ${subtle}`}>
                Scanning checks you're within {gym.geofenceM ?? DEFAULT_GEOFENCE_M} m of the gym.
              </p>
            )}
          </div>
        )}

        {tab === 'code' && (
          <div className="space-y-3">
            <p className={`text-sm text-center ${subtle}`}>Enter today's 6-digit code from the front desk.</p>
            <MemberCodeInput length={6} values={digits} onChange={setDigits} onComplete={submitCode} charset="digits" isDark={isDark} disabled={busy} />
          </div>
        )}

        {tab === 'myqr' && (
          <div className="flex justify-center">
            <QrCode value={memberQrPayload(gym.id, membership.uid)} isDark={isDark} size={200} label="Show this to staff" />
          </div>
        )}
      </div>
    </div>
  );
}
