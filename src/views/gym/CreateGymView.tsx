import { useState } from 'react';
import { ArrowLeft, ShieldAlert } from 'lucide-react';
import type { GymViewProps } from './types';
import { useGym } from '../../gym/GymContext';
import { useAuth } from '../../auth/AuthContext';
import { isAdmin } from '../../admin';
import { createGym } from '../../gymService';
import {  } from '../../components';
import { useToast } from '../../ui';

/** Zenith-admin only: creates a new gym (the caller becomes its owner). */
export function CreateGymView({ isDark, onBack, onNavigate }: GymViewProps) {
  const { user } = useAuth();
  const { refresh } = useGym();
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [creating, setCreating] = useState(false);
  const { showToast } = useToast();

  const cardBg = isDark ? 'bg-[#1a1a1a]' : 'bg-white';
  const cardBorder = isDark ? 'border-[#2e2e2e]' : 'border-gray-200';
  const subtle = isDark ? 'text-zinc-500' : 'text-gray-500';
  const inputCls = `w-full rounded-lg px-3 py-2 text-sm border focus:outline-none focus:border-orange-500 ${
    isDark ? 'bg-[#0f0f0f] border-[#2e2e2e] text-white placeholder-zinc-600' : 'bg-gray-50 border-gray-200 placeholder-gray-400'
  }`;

  const backHeader = (
    <div className="flex items-center gap-3">
      <button aria-label="Back" onClick={onBack} className={`p-2 rounded-lg transition-colors ${isDark ? 'hover:bg-[#222]' : 'hover:bg-gray-50'}`}>
        <ArrowLeft className="w-5 h-5" />
      </button>
      <h1 className="text-xl font-bold">Create a Gym</h1>
    </div>
  );

  if (!isAdmin(user?.uid)) {
    return (
      <div className="space-y-4 animate-fadeIn">
        {backHeader}
        <div className={`rounded-xl border p-6 text-center text-sm space-y-2 ${cardBg} ${cardBorder} ${subtle}`}>
          <ShieldAlert className="w-6 h-6 mx-auto opacity-50" />
          Only Zenith admins can create a gym.
        </div>
      </div>
    );
  }

  const handleCreate = async () => {
    if (!name.trim() || creating) return;
    setCreating(true);
    try {
      await createGym({ name: name.trim(), address: address.trim() || undefined, phone: phone.trim() || undefined });
      refresh();
      showToast('Gym created.');
      onNavigate('gym-home');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not create the gym.', 'error');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-4 animate-fadeIn">
      {backHeader}
      <div className={`rounded-xl border p-5 space-y-3 ${cardBg} ${cardBorder}`}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Gym name" className={inputCls} autoFocus />
        <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Address (optional)" className={inputCls} />
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone (optional)" className={inputCls} type="tel" />
        <button
          onClick={handleCreate}
          disabled={!name.trim() || creating}
          className="w-full py-2.5 rounded-lg text-sm font-semibold bg-gradient-to-r from-orange-500 to-red-600 text-white disabled:opacity-50"
        >
          {creating ? 'Creating…' : 'Create gym'}
        </button>
      </div>
    </div>
  );
}
