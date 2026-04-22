import { useState, useRef } from 'react';
import {
  Camera, Dumbbell, Flame, TrendingUp, ClipboardList, BarChart3, ChevronRight, Loader2,
} from 'lucide-react';
import type { UserStats, Workout } from '../types';
import { useAuth } from '../auth/AuthContext';
import { ActivityHeatmap } from '../components';
import { updateProfile } from 'firebase/auth';
import { auth } from '../firebase';
import * as buddyService from '../buddyService';

interface ProfileLandingProps {
  isDark: boolean;
  stats: UserStats | null;
  workouts: Workout[];
  onViewAnalysis: () => void;
  onViewProgress: () => void;
  onViewHistory: () => void;
}

/**
 * Resize + JPEG-compress an image file client-side so we can stash a
 * data URI in Firebase Auth's photoURL field without blowing past size
 * limits. Max 256px, quality 0.8. Returns a data URI.
 */
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

export function ProfileLanding({
  isDark, stats, workouts, onViewAnalysis, onViewProgress, onViewHistory,
}: ProfileLandingProps) {
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [photoURL, setPhotoURL] = useState(user?.photoURL || null);

  const cardBg = isDark ? 'bg-[#1a1a1a]' : 'bg-white';
  const cardBorder = isDark ? 'border-[#2e2e2e]' : 'border-gray-200';
  const subtle = isDark ? 'text-zinc-500' : 'text-gray-500';

  const handlePhotoPick = () => fileInputRef.current?.click();
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
      console.error('[Profile] photo upload failed:', err);
      alert('Photo upload failed: ' + (err instanceof Error ? err.message : 'unknown'));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const joinedAt = user?.metadata?.creationTime
    ? new Date(user.metadata.creationTime)
    : null;
  const joinedLabel = joinedAt
    ? `Joined ${joinedAt.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}`
    : '';

  const completedCount = workouts.filter((w) => w.completed && w.type !== 'rest').length;
  const thisWeek = (() => {
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    return workouts.filter((w) => w.completed && w.type !== 'rest' && new Date(w.date) >= weekAgo).length;
  })();

  return (
    <div className="space-y-4 animate-fadeIn">
      <h1 className="text-xl font-bold">Profile</h1>

      {/* User card */}
      <div className={`rounded-2xl border p-5 text-center ${cardBg} ${cardBorder}`}>
        <div className="relative inline-block mb-3">
          {photoURL ? (
            <img
              src={photoURL}
              alt=""
              className="w-24 h-24 rounded-full object-cover mx-auto"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="w-24 h-24 rounded-full bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center text-white font-bold text-4xl mx-auto">
              {user?.displayName?.charAt(0).toUpperCase() || '?'}
            </div>
          )}
          <button
            onClick={handlePhotoPick}
            disabled={uploading}
            className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-orange-500 hover:bg-orange-600 disabled:opacity-50 flex items-center justify-center border-2 border-[#0f0f0f] transition-colors"
            title="Change profile picture"
          >
            {uploading ? (
              <Loader2 className="w-3.5 h-3.5 text-white animate-spin" />
            ) : (
              <Camera className="w-3.5 h-3.5 text-white" />
            )}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handlePhotoChange}
            className="hidden"
          />
        </div>
        <h2 className="text-lg font-bold">{user?.displayName || 'Anonymous'}</h2>
        {user?.email && <div className={`text-xs ${subtle} mt-0.5`}>{user.email}</div>}
        {joinedLabel && <div className={`text-xs ${subtle} mt-1`}>{joinedLabel}</div>}
      </div>

      {/* Quick stats */}
      {stats && (
        <div className="grid grid-cols-4 gap-2">
          {[
            { icon: <Dumbbell className="w-4 h-4" />, value: completedCount, label: 'Workouts', color: 'text-orange-400', bg: 'bg-orange-500/10' },
            { icon: <Flame className="w-4 h-4" />, value: `${stats.currentStreak}d`, label: 'Streak', color: 'text-red-400', bg: 'bg-red-500/10' },
            { icon: <TrendingUp className="w-4 h-4" />, value: thisWeek, label: 'This week', color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
            { icon: <Dumbbell className="w-4 h-4" />, value: stats.avgVolumePerSession > 0 ? `${Math.round(stats.avgVolumePerSession / 1000)}k` : '0', label: 'Avg kg', color: 'text-blue-400', bg: 'bg-blue-500/10' },
          ].map((s, i) => (
            <div key={i} className={`rounded-xl border p-3 ${cardBg} ${cardBorder}`}>
              <div className={`w-7 h-7 rounded-lg ${s.bg} flex items-center justify-center ${s.color} mb-1`}>
                {s.icon}
              </div>
              <div className="text-sm font-bold">{s.value}</div>
              <div className={`text-[10px] ${subtle}`}>{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Activity heatmap — last 26 weeks */}
      <ActivityHeatmap workouts={workouts} isDark={isDark} />

      {/* Sections */}
      <div className="space-y-2">
        {[
          { label: 'Analysis', hint: 'Volume, streaks, muscle-group breakdown', icon: <BarChart3 className="w-5 h-5" />, color: 'text-emerald-400', bg: isDark ? 'bg-emerald-500/15' : 'bg-emerald-100', onClick: onViewAnalysis },
          { label: 'Progress', hint: 'Per-exercise PRs and trends', icon: <TrendingUp className="w-5 h-5" />, color: 'text-blue-400', bg: isDark ? 'bg-blue-500/15' : 'bg-blue-100', onClick: onViewProgress },
          { label: 'Workout History', hint: `${completedCount} completed sessions`, icon: <ClipboardList className="w-5 h-5" />, color: 'text-orange-400', bg: isDark ? 'bg-orange-500/15' : 'bg-orange-100', onClick: onViewHistory },
        ].map((s) => (
          <button
            key={s.label}
            onClick={s.onClick}
            className={`w-full rounded-xl border p-4 flex items-center justify-between transition-colors ${cardBg} ${cardBorder} ${isDark ? 'hover:border-orange-500/40' : 'hover:border-orange-400'}`}
          >
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-lg ${s.bg} ${s.color} flex items-center justify-center`}>
                {s.icon}
              </div>
              <div className="text-left">
                <div className="font-medium text-sm">{s.label}</div>
                <div className={`text-xs ${subtle}`}>{s.hint}</div>
              </div>
            </div>
            <ChevronRight className={`w-5 h-5 ${subtle}`} />
          </button>
        ))}
      </div>
    </div>
  );
}
