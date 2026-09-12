import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, RotateCw, Search, ScanLine, X, CheckCircle2 } from 'lucide-react';
import type { GymViewProps } from './types';
import type { GymMember, GymCheckin } from '../../types';
import { useGym } from '../../gym/GymContext';
import {
  listenToMembers, listenToCheckinsSince, checkinMember, rotateDailyCode, gymQrPayload, parseQrPayload, membershipStatus,
} from '../../gymService';
import { localDateISO } from '../../gymStats';
import { QrCode, QrScanner } from '../../components';
import { StatusChip } from '../../components/gym/StaffMemberRow';
import { useToast } from '../../ui';

/** Staff check-in console — see docs/GYM_TIER_A_SPEC.md §6.3. Available
 *  to all staff (trainer+); nothing here is manager-gated. */
export function CheckinConsoleView({ isDark, onBack }: GymViewProps) {
  const { gym } = useGym();

  const [members, setMembers] = useState<GymMember[]>([]);
  const [checkinsToday, setCheckinsToday] = useState<GymCheckin[]>([]);
  const [code, setCode] = useState<string | null>(null);
  const [codeDate, setCodeDate] = useState<string | null>(null);
  const [rotating, setRotating] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [manualSearch, setManualSearch] = useState('');
  const [successInfo, setSuccessInfo] = useState<{ member: GymMember; at: string } | null>(null);
  const { showToast } = useToast();

  useEffect(() => {
    const gymId = gym?.id;
    if (!gymId) return;
    return listenToMembers(gymId, setMembers);
  }, [gym?.id]);

  // Live listener: one read per new check-in after the first snapshot.
  // The 30 s poll it replaces re-read every check-in of the day each
  // time — a 300-member gym burnt ~36K reads an hour with the desk open.
  useEffect(() => {
    const gymId = gym?.id;
    if (!gymId) return;
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    return listenToCheckinsSince(gymId, startOfToday.toISOString(), setCheckinsToday);
  }, [gym?.id]);

  useEffect(() => {
    if (!successInfo) return;
    const t = setTimeout(() => setSuccessInfo(null), 4000);
    return () => clearTimeout(t);
  }, [successInfo]);

  const memberByUid = useMemo(() => new Map(members.map((m) => [m.uid, m])), [members]);

  const handleRotate = async () => {
    if (!gym) return;
    setRotating(true);
    try {
      const plain = await rotateDailyCode(gym.id);
      setCode(plain);
      setCodeDate(localDateISO(new Date()));
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to generate code', 'error');
    } finally {
      setRotating(false);
    }
  };

  const recordCheckin = async (uid: string, method: 'staff-qr' | 'manual') => {
    if (!gym) return;
    try {
      const { checkin } = await checkinMember(gym.id, uid, method);
      const m = memberByUid.get(uid);
      if (m) setSuccessInfo({ member: m, at: checkin.at });
      else showToast('Checked in');
      setCheckinsToday((prev) => (prev.some((c) => c.id === checkin.id) ? prev : [checkin, ...prev]));
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Check-in failed', 'error');
    }
  };

  const handleScanResult = (text: string) => {
    if (!gym) return;
    const parsed = parseQrPayload(text);
    if (!parsed || parsed.kind !== 'member' || parsed.gymId !== gym.id) {
      showToast('Not a valid member QR for this gym', 'error');
      return;
    }
    void recordCheckin(parsed.uid, 'staff-qr');
  };

  const subtle = isDark ? 'text-zinc-500' : 'text-gray-500';
  const cardCls = `rounded-xl border p-4 ${isDark ? 'bg-[#1a1a1a] border-[#2e2e2e]' : 'bg-white border-gray-200'}`;
  const inputCls = `w-full rounded-lg pl-10 pr-4 py-2.5 text-sm border focus:outline-none focus:border-orange-500 ${
    isDark ? 'bg-[#0f0f0f] border-[#2e2e2e] text-white placeholder-zinc-600' : 'bg-gray-50 border-gray-200 placeholder-gray-400'
  }`;

  const manualResults = manualSearch.trim()
    ? members.filter((m) => m.name.toLowerCase().includes(manualSearch.trim().toLowerCase()) || (m.phone ?? '').includes(manualSearch.trim())).slice(0, 20)
    : [];

  if (!gym) {
    return (
      <div className="space-y-4 animate-fadeIn">
        <button aria-label="Back" onClick={onBack} className={`p-2 rounded-lg transition-colors ${isDark ? 'hover:bg-[#222]' : 'hover:bg-gray-50'}`}>
          <ArrowLeft className="w-5 h-5" />
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-fadeIn">
      <div className="flex items-center gap-3">
        <button aria-label="Back" onClick={onBack} className={`p-2 rounded-lg transition-colors ${isDark ? 'hover:bg-[#222]' : 'hover:bg-gray-50'}`}>
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-xl font-bold">Check-in Console</h1>
      </div>

      <div className={cardCls}>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-2xl font-bold">{checkinsToday.length}</div>
            <div className={`text-xs ${subtle}`}>checked in today</div>
          </div>
        </div>
        {checkinsToday.length > 0 && (
          <div className={`mt-3 pt-3 border-t divide-y ${isDark ? 'border-[#2e2e2e] divide-[#2e2e2e]' : 'border-gray-100 divide-gray-100'}`}>
            {checkinsToday.slice(0, 10).map((c) => (
              <div key={c.id} className="py-1.5 text-sm flex items-center justify-between">
                <span>{memberByUid.get(c.uid)?.name ?? c.uid}</span>
                <span className={`text-xs ${subtle}`}>{new Date(c.at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className={cardCls}>
          <div className="text-sm font-medium mb-3">Today's code</div>
          {code && codeDate === localDateISO(new Date()) ? (
            <div className="text-center py-4">
              <div className="text-4xl font-mono font-bold tracking-[0.3em]">{code}</div>
              <div className={`text-xs mt-2 ${subtle}`}>{new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</div>
            </div>
          ) : (
            <p className={`text-sm py-4 text-center ${subtle}`}>Not generated yet today.</p>
          )}
          <button
            onClick={handleRotate}
            disabled={rotating}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium bg-gradient-to-r from-orange-500 to-red-600 text-white disabled:opacity-50"
          >
            <RotateCw className={`w-4 h-4 ${rotating ? 'animate-spin' : ''}`} /> {code ? 'Rotate code' : 'Generate code'}
          </button>
        </div>

        <div className={`${cardCls} flex flex-col items-center`}>
          <div className="text-sm font-medium mb-3 self-start">Gym QR</div>
          <QrCode value={gymQrPayload(gym.id)} size={200} isDark={isDark} label="Members scan this to check in" />
        </div>
      </div>

      <div className={cardCls}>
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-medium">Scan member QR</div>
          <button
            onClick={() => setScanning((s) => !s)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium ${
              scanning
                ? 'bg-red-500/10 text-red-500'
                : isDark ? 'bg-[#252525] text-zinc-300 hover:bg-[#303030]' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            <ScanLine className="w-3.5 h-3.5" /> {scanning ? 'Stop' : 'Start scanning'}
          </button>
        </div>
        {scanning && <QrScanner onResult={handleScanResult} isDark={isDark} hint="Point the camera at the member's QR code" />}
      </div>

      <div className={cardCls}>
        <div className="text-sm font-medium mb-3">Manual check-in</div>
        <div className="relative mb-2">
          <Search className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${subtle}`} />
          <input
            type="text"
            value={manualSearch}
            onChange={(e) => setManualSearch(e.target.value)}
            placeholder="Search name or phone…"
            className={inputCls}
          />
        </div>
        {manualResults.length > 0 && (
          <div className={`divide-y ${isDark ? 'divide-[#2e2e2e]' : 'divide-gray-100'}`}>
            {manualResults.map((m) => (
              <button
                key={m.uid}
                onClick={() => { void recordCheckin(m.uid, 'manual'); setManualSearch(''); }}
                className={`w-full flex items-center justify-between py-2.5 text-left ${isDark ? 'hover:bg-[#222]' : 'hover:bg-gray-50'}`}
              >
                <span className="text-sm">{m.name}</span>
                <span className={`text-xs ${subtle}`}>{m.phone}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {successInfo && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-end sm:items-center justify-center animate-fadeIn" onClick={() => setSuccessInfo(null)}>
          <div
            className={`relative w-full sm:max-w-sm sm:rounded-2xl rounded-t-2xl p-6 text-center border ${isDark ? 'bg-[#1a1a1a] border-[#2e2e2e]' : 'bg-white border-gray-200'}`}
            onClick={(e) => e.stopPropagation()}
          >
            <button onClick={() => setSuccessInfo(null)} className={`absolute top-4 right-4 p-1 ${subtle}`}>
              <X className="w-4 h-4" />
            </button>
            <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-2" />
            <div className="text-lg font-bold">{successInfo.member.name}</div>
            <div className="flex justify-center my-2">
              <StatusChip status={membershipStatus(successInfo.member)} />
            </div>
            <div className={`text-sm ${subtle}`}>
              Checked in at {new Date(successInfo.at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
            </div>
            {(membershipStatus(successInfo.member) === 'expired' || membershipStatus(successInfo.member) === 'frozen') && (
              <div className="mt-3 text-xs font-medium text-red-500 bg-red-500/10 rounded-lg py-2 px-3">
                Membership {membershipStatus(successInfo.member)} — check with the desk before letting them train.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
