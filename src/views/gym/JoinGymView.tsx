import { useState } from 'react';
import { ArrowLeft, KeyRound, QrCode as QrCodeIcon, Sparkles } from 'lucide-react';
import type { GymViewProps } from './types';
import { useGym } from '../../gym/GymContext';
import { useAuth } from '../../auth/AuthContext';
import { isAdmin } from '../../admin';
import { joinGymByCode } from '../../gymService';
import { QrScanner, MemberCodeInput } from '../../components';
import { useToast } from '../../ui';
import { parseGymJoinQr } from '../../gymMemberHelpers';

const CODE_LEN = 6;

/** Join a gym by 6-character code, or scan the gym's QR to confirm which
 *  gym it is (scanning never carries the join code — see
 *  parseGymJoinQr). Also the inline fallback GymHomeView renders when
 *  the signed-in user has no gym yet. */
export function JoinGymView({ isDark, onBack, onNavigate }: GymViewProps) {
  const { refresh } = useGym();
  const { user } = useAuth();
  const [mode, setMode] = useState<'code' | 'scan'>('code');
  const [chars, setChars] = useState<string[]>(Array(CODE_LEN).fill(''));
  const [joining, setJoining] = useState(false);
  const [scanHint, setScanHint] = useState<string | null>(null);
  const { showToast } = useToast();

  const cardBg = isDark ? 'bg-[#1a1a1a]' : 'bg-white';
  const cardBorder = isDark ? 'border-[#2e2e2e]' : 'border-gray-200';
  const subtle = isDark ? 'text-zinc-500' : 'text-gray-500';

  const submit = async (value: string) => {
    if (value.length !== CODE_LEN || joining) return;
    setJoining(true);
    try {
      await joinGymByCode(value);
      refresh();
      showToast('Joined! Welcome aboard.');
      onNavigate('gym-home');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not join — check the code.', 'error');
      setChars(Array(CODE_LEN).fill(''));
    } finally {
      setJoining(false);
    }
  };

  const handleScanResult = (text: string) => {
    const parsed = parseGymJoinQr(text);
    if (!parsed) {
      showToast("That QR code isn't a Zenith gym code.", 'error');
      return;
    }
    setScanHint("That's a valid gym QR, but joining still needs the 6-character code — ask the front desk.");
    setMode('code');
  };

  return (
    <div className="space-y-4 animate-fadeIn">
      <div className="flex items-center gap-3">
        <button aria-label="Back" onClick={onBack} className={`p-2 rounded-lg transition-colors ${isDark ? 'hover:bg-[#222]' : 'hover:bg-gray-50'}`}>
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-xl font-bold">Join a Gym</h1>
      </div>

      <div className={`rounded-xl border p-5 space-y-5 ${cardBg} ${cardBorder}`}>
        <div className={`flex rounded-lg overflow-hidden border ${cardBorder}`}>
          <button
            onClick={() => setMode('code')}
            className={`flex-1 py-2 text-sm font-medium flex items-center justify-center gap-1.5 ${
              mode === 'code' ? 'bg-gradient-to-r from-orange-500 to-red-600 text-white' : subtle
            }`}
          >
            <KeyRound className="w-4 h-4" /> Enter code
          </button>
          <button
            onClick={() => setMode('scan')}
            className={`flex-1 py-2 text-sm font-medium flex items-center justify-center gap-1.5 ${
              mode === 'scan' ? 'bg-gradient-to-r from-orange-500 to-red-600 text-white' : subtle
            }`}
          >
            <QrCodeIcon className="w-4 h-4" /> Scan gym QR
          </button>
        </div>

        {mode === 'code' ? (
          <div className="space-y-3">
            <p className={`text-sm ${subtle}`}>Ask the front desk for your gym's 6-character join code.</p>
            {scanHint && <p className="text-xs text-orange-400">{scanHint}</p>}
            <MemberCodeInput
              length={CODE_LEN}
              values={chars}
              onChange={setChars}
              onComplete={submit}
              charset="alnum"
              isDark={isDark}
              disabled={joining}
            />
            <button
              onClick={() => submit(chars.join(''))}
              disabled={chars.some((c) => !c) || joining}
              className="w-full py-2.5 rounded-lg text-sm font-semibold bg-gradient-to-r from-orange-500 to-red-600 text-white disabled:opacity-50"
            >
              {joining ? 'Joining…' : 'Join gym'}
            </button>
          </div>
        ) : (
          <QrScanner isDark={isDark} onResult={handleScanResult} hint="Point at the gym's QR code" />
        )}
      </div>

      {isAdmin(user?.uid) && (
        <button
          onClick={() => onNavigate('gym-create')}
          className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl border text-sm font-medium ${cardBg} ${cardBorder} ${subtle}`}
        >
          <Sparkles className="w-4 h-4" /> Create a gym
        </button>
      )}
    </div>
  );
}
