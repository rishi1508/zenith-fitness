import { useRef, useState } from 'react';
import { BarChart3, Building2, Camera, ChevronRight, ClipboardList, Library, Loader2, TrendingUp, UserCog, Users } from 'lucide-react';
import type { UserStats, Workout } from '../../types';
import { useAuth } from '../../auth/AuthContext';
import { updateProfile } from 'firebase/auth';
import { auth } from '../../firebase';
import * as buddyService from '../../buddyService';
import { Card, StatTile, ListRow, Pill, SectionHeader } from '../../ui';
import type { PillTone } from '../../ui';
import { usePremium, PremiumBadge } from '../../premium';
import type { Tier } from '../../premium';

interface YouTabViewProps {
  stats: UserStats | null;
  workouts: Workout[];
  isAdmin: boolean;
  onOpenProgress: () => void;
  onOpenAnalysis: () => void;
  onOpenHistory: () => void;
  onOpenBuddies: () => void;
  onOpenSettings: () => void;
  onOpenAdminGyms: () => void;
  onOpenAdminUsers: () => void;
  onOpenAdminLibrary: () => void;
}

const TIER_LABEL: Record<Tier, string> = { admin: 'Admin', premium: 'Premium', gym: 'Gym premium', free: 'Free' };
const TIER_TONE: Record<Tier, PillTone> = { admin: 'info', premium: 'accent', gym: 'accent', free: 'neutral' };

/** Resize + JPEG-compress client-side so a data URI fits in Firebase
 *  Auth's photoURL field. Lifted from the old ProfileLanding. */
async function compressImageFile(file: File, maxPx = 256, quality = 0.8): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxPx / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  ctx.drawImage(bitmap, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', quality);
}

/** You tab root (docs/REVAMP_SPEC.md §3): profile header with tier pill,
 *  3 stat tiles, rows to every "about me" screen, and an Admin section
 *  (§5) when the signed-in user is a Zenith admin. */
export function YouTabView({
  stats, workouts, isAdmin, onOpenProgress, onOpenAnalysis, onOpenHistory, onOpenBuddies, onOpenSettings,
  onOpenAdminGyms, onOpenAdminUsers, onOpenAdminLibrary,
}: YouTabViewProps) {
  const { user } = useAuth();
  const { tier } = usePremium();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [photoURL, setPhotoURL] = useState(user?.photoURL || null);

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !auth.currentUser) return;
    setUploading(true);
    try {
      const dataUri = await compressImageFile(file);
      await updateProfile(auth.currentUser, { photoURL: dataUri });
      setPhotoURL(dataUri);
      await buddyService.upsertUserProfile();
    } catch (err) {
      console.error('[You] photo upload failed:', err);
      alert('Photo upload failed: ' + (err instanceof Error ? err.message : 'unknown'));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const completedCount = workouts.filter((w) => w.completed && w.type !== 'rest').length;
  const volume = stats?.totalVolume ?? 0;
  const volumeLabel = volume >= 1_000_000 ? `${(volume / 1_000_000).toFixed(1)}M` : volume >= 1000 ? `${Math.round(volume / 1000)}k` : String(volume);

  return (
    <div className="space-y-4 animate-fadeIn">
      <div className="flex items-center gap-3">
        <div className="relative shrink-0">
          {photoURL ? (
            <img src={photoURL} alt="" className="w-16 h-16 rounded-full object-cover" referrerPolicy="no-referrer" />
          ) : (
            <div className="w-16 h-16 rounded-full bg-accent-soft text-accent flex items-center justify-center font-display text-2xl font-bold">
              {user?.displayName?.charAt(0).toUpperCase() || '?'}
            </div>
          )}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="absolute -bottom-0.5 -right-0.5 w-6 h-6 rounded-full bg-accent disabled:opacity-50 flex items-center justify-center border-2 border-bg"
            title="Change profile picture"
          >
            {uploading ? <Loader2 className="w-3 h-3 text-white animate-spin" /> : <Camera className="w-3 h-3 text-white" />}
          </button>
          <input ref={fileInputRef} type="file" accept="image/*" onChange={handlePhotoChange} className="hidden" />
        </div>
        <div className="min-w-0">
          <h2 className="font-display text-lg font-bold truncate">{user?.displayName || 'Anonymous'}</h2>
          <Pill tone={TIER_TONE[tier]} className="mt-1">{TIER_LABEL[tier]}</Pill>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <StatTile eyebrow="Workouts" value={completedCount} compact />
        <StatTile eyebrow="Streak" value={stats?.currentStreak ?? 0} unit="w" compact />
        <StatTile eyebrow="Volume" value={volumeLabel} compact />
      </div>

      <Card padding="list">
        <ListRow icon={TrendingUp} title="Progress" subtitle="Per-exercise trends and PRs" onClick={onOpenProgress} />
        <ListRow
          icon={BarChart3}
          title="Analysis"
          subtitle="Muscle balance · deload"
          onClick={onOpenAnalysis}
          trailing={(
            <>
              <PremiumBadge />
              <ChevronRight className="w-[18px] h-[18px] text-subtle shrink-0" strokeWidth={1.75} />
            </>
          )}
        />
        <ListRow icon={ClipboardList} title="Workout history" subtitle={`${completedCount} sessions`} onClick={onOpenHistory} />
        <ListRow icon={Users} title="Buddies & requests" subtitle="Friends, invites and alerts" onClick={onOpenBuddies} />
      </Card>

      <ListRow icon={ClipboardList} title="Settings" subtitle="Theme, data, sync and more" onClick={onOpenSettings} />

      {isAdmin && (
        <>
          <SectionHeader caption="Admin" />
          <Card padding="list">
            <ListRow icon={Building2} title="Gyms" subtitle="Create and manage gyms" onClick={onOpenAdminGyms} />
            <ListRow icon={UserCog} title="Users" subtitle="Accounts, tiers, premium grants" onClick={onOpenAdminUsers} />
            <ListRow icon={Library} title="Shared library" subtitle="Exercise definitions" onClick={onOpenAdminLibrary} />
          </Card>
        </>
      )}
    </div>
  );
}
