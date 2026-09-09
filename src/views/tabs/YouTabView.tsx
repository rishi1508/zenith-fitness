import { useRef, useState } from 'react';
import { BarChart3, Building2, Camera, ChevronRight, ClipboardList, Library, Loader2, TrendingUp, UserCog, Users } from 'lucide-react';
import type { UserStats, Workout } from '../../types';
import { useAuth } from '../../auth/AuthContext';
import { updateProfile } from 'firebase/auth';
import { auth } from '../../firebase';
import * as buddyService from '../../buddyService';
import { Card, StatTile, ListRow, Pill, SectionHeader, useToast } from '../../ui';
import type { PillTone } from '../../ui';
import { usePremium, PremiumBadge } from '../../premium';
import { LevelPill, LevelProgressCard } from '../../components/LevelBadge';
import { LevelRing } from '../../components/LevelRing';
import { StreakModal } from '../../components';
import { levelForVolume, levelTitle, formatVolume, stepKgFor } from '../../levels';
import { Sheet, SUB, CAPTION } from '../../ui';
import type { Tier } from '../../premium';

interface YouTabViewProps {
  stats: UserStats | null;
  workouts: Workout[];
  isAdmin: boolean;
  isDark: boolean;
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
  stats, workouts, isAdmin, isDark, onOpenProgress, onOpenAnalysis, onOpenHistory, onOpenBuddies, onOpenSettings,
  onOpenAdminGyms, onOpenAdminUsers, onOpenAdminLibrary,
}: YouTabViewProps) {
  const { user } = useAuth();
  const { tier } = usePremium();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [photoURL, setPhotoURL] = useState(user?.photoURL || null);
  const [levelOpen, setLevelOpen] = useState(false);
  const [streakOpen, setStreakOpen] = useState(false);

  const { showToast } = useToast();
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
      showToast('Photo upload failed: ' + (err instanceof Error ? err.message : 'unknown'), 'error');
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
          {/* The ring is the level: how far through it you are, at a glance. */}
          <LevelRing size={72} totalVolumeKg={volume} photoURL={photoURL} name={user?.displayName ?? undefined} showLevel />
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
          <div className="flex flex-wrap items-center gap-1.5 mt-1">
            <Pill tone={TIER_TONE[tier]}>{TIER_LABEL[tier]}</Pill>
            <LevelPill level={levelForVolume(volume).level} />
          </div>
        </div>
      </div>

      {/* Every number here goes somewhere — a stat you can't open is a
          dead end. */}
      <Card onClick={() => setLevelOpen(true)}>
        <LevelProgressCard totalVolumeKg={volume} />
      </Card>

      <div className="grid grid-cols-3 gap-2">
        <StatTile eyebrow="Workouts" value={completedCount} compact onClick={onOpenHistory} />
        <StatTile eyebrow="Streak" value={stats?.currentStreak ?? 0} unit="w" compact onClick={() => setStreakOpen(true)} />
        <StatTile eyebrow="Volume" value={volumeLabel} compact onClick={onOpenProgress} />
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

      {levelOpen && (
        <LevelDetailSheet volume={volume} completedCount={completedCount} onClose={() => setLevelOpen(false)} />
      )}
      {streakOpen && <StreakModal isDark={isDark} onClose={() => setStreakOpen(false)} />}

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

/**
 * What the level actually means, since the bar on its own does not say.
 * Volume is the only input: every completed set adds weight × reps, and the
 * steps get longer as you climb, so the early levels come quickly and the
 * later ones are earned.
 */
function LevelDetailSheet({ volume, completedCount, onClose }: { volume: number; completedCount: number; onClose: () => void }) {
  const p = levelForVolume(volume);
  const perSession = completedCount > 0 ? volume / completedCount : 0;
  const sessionsToGo = p.remainingKg != null && perSession > 0 ? Math.ceil(p.remainingKg / perSession) : null;

  return (
    <Sheet open onClose={onClose} title={`Level ${p.level} · ${levelTitle(p.level)}`}>
      <div>
        <div className="flex items-baseline justify-between">
          <span className={CAPTION}>Progress through level {p.level}</span>
          <span className="text-xs font-semibold text-subtle tabular-nums">{Math.round(p.fraction * 100)}%</span>
        </div>
        <div className="mt-2 h-2.5 rounded-full bg-surface-2 overflow-hidden">
          <div className="h-full rounded-full bg-accent" style={{ width: `${Math.round(p.fraction * 100)}%` }} />
        </div>
        <div className="mt-1.5 flex justify-between text-[11px] text-subtle tabular-nums">
          <span>{formatVolume(p.startKg)}</span>
          <span>{p.nextKg == null ? 'max' : formatVolume(p.nextKg)}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <StatTile eyebrow="Lifted all time" value={formatVolume(volume)} compact />
        <StatTile eyebrow="Sessions" value={completedCount} compact />
        <StatTile eyebrow="To next level" value={p.remainingKg == null ? '—' : formatVolume(p.remainingKg)} compact />
        <StatTile
          eyebrow="At your pace"
          value={sessionsToGo == null ? '—' : sessionsToGo}
          unit={sessionsToGo == null ? undefined : sessionsToGo === 1 ? 'session' : 'sessions'}
          compact
        />
      </div>

      <p className={SUB}>
        Your level comes from lifetime volume — weight × reps of every completed set, ever. Level{' '}
        {p.level} spans {formatVolume(stepKgFor(p.level))}; each level after it is a little longer than
        the last, so the climb keeps pace with you. Rest days, cardio and unfinished sets add nothing,
        and nothing you have already lifted is ever taken away.
      </p>
    </Sheet>
  );
}
