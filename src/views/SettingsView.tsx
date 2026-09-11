import { useState, useRef, useEffect } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  ChevronLeft, FileSpreadsheet, Download, Upload,
  CheckCircle2, Copy, Volume2, Palette, Sun, Moon, Clock, User, LogOut, LogIn,
  Cloud, Bell, Flame, Trash2, Vibrate, ChevronRight, Database, Dumbbell, HeartPulse, Info,
} from 'lucide-react';
import * as storage from '../storage';
import type { Workout, Exercise, WeeklyPlan } from '../types';
import { useAuth } from '../auth/AuthContext';
import { isAdmin } from '../admin';
import { updateProfile } from 'firebase/auth';
import { auth } from '../firebase';
import * as buddyService from '../buddyService';
import { manualCheckForUpdates } from '../updateCheck';
import { enablePushNotifications, pushSupported, pushPermissionState } from '../pushService';
import { canWriteHealthData, isHealthSyncEnabled, setHealthSyncEnabled } from '../healthSync';
import { deleteMyAccount } from '../accountService';
import { Capacitor } from '@capacitor/core';
import { Sheet, Button, useToast, useConfirm } from '../ui';
import { registerBackHandler } from '../backHandlerRegistry';
import { playCue } from '../sound';
import { hapticCue } from '../haptics';

declare const __APP_VERSION__: string;

// Edit Profile Section (name + photo URL within Account)
function EditProfileSection({ isDark }: { isDark: boolean }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(auth.currentUser?.displayName || '');
  const [photoURL, setPhotoURL] = useState(auth.currentUser?.photoURL || '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim() || !auth.currentUser) return;
    setSaving(true);
    try {
      await updateProfile(auth.currentUser, {
        displayName: name.trim(),
        photoURL: photoURL.trim() || null,
      });
      await buddyService.upsertUserProfile();
      setEditing(false);
    } catch (err) {
      console.error('[Settings] Failed to update profile:', err);
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <button
        onClick={() => {
          setName(auth.currentUser?.displayName || '');
          setPhotoURL(auth.currentUser?.photoURL || '');
          setEditing(true);
        }}
        className={`w-full text-left text-xs py-1.5 transition-colors ${isDark ? 'text-orange-400 hover:text-orange-300' : 'text-orange-600 hover:text-orange-500'}`}
      >
        Edit profile
      </button>
    );
  }

  const inputCls = `w-full rounded-lg px-3 py-2 text-sm border focus:outline-none focus:border-orange-500 ${
    isDark ? 'bg-[#0f0f0f] border-[#2e2e2e] text-white placeholder-zinc-600' : 'bg-gray-50 border-gray-200 placeholder-gray-400'
  }`;

  return (
    <div className="space-y-2">
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Display name"
        autoFocus
        className={inputCls}
      />
      <input
        type="url"
        value={photoURL}
        onChange={(e) => setPhotoURL(e.target.value)}
        placeholder="Photo URL (optional)"
        className={inputCls}
      />
      <div className="flex gap-2">
        <button
          onClick={handleSave}
          disabled={saving || !name.trim()}
          className="flex-1 py-2 rounded-lg text-xs font-medium bg-gradient-to-r from-orange-500 to-red-600 text-white disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
        <button
          onClick={() => setEditing(false)}
          className={`px-4 py-2 rounded-lg text-xs ${isDark ? 'text-zinc-500 hover:text-zinc-300 bg-zinc-800' : 'text-gray-400 hover:text-gray-600 bg-gray-100'}`}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// Delete Account Section — Play Store requirement. The confirm sheet
// uses the new `src/ui` kit (it's an overlay, self-contained regardless
// of this legacy screen's isDark styling); the row that opens it matches
// the surrounding Account card.
function DeleteAccountSection({ isDark }: { isDark: boolean }) {
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { signOut } = useAuth();
  const { showToast } = useToast();

  const handleDelete = async () => {
    if (deleting) return;
    setDeleting(true);
    try {
      await deleteMyAccount();
      await signOut();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not delete your account.', 'error');
      setDeleting(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-colors ${
          isDark ? 'bg-red-500/10 hover:bg-red-500/20 text-red-400' : 'bg-red-50 hover:bg-red-100 text-red-600'
        }`}
      >
        <Trash2 className="w-4 h-4" />
        Delete Account
      </button>
      <Sheet open={open} onClose={() => { if (!deleting) setOpen(false); }} title="Delete account?">
        <div className="flex flex-col gap-3 pb-1">
          <p className="text-sm text-muted">
            This permanently deletes your account and all your data — workouts, plans, body
            weight, buddies and gym membership. This can't be undone.
          </p>
          <Button variant="danger" size="lg" full loading={deleting} onClick={handleDelete}>
            Delete my account
          </Button>
          <Button variant="secondary" size="lg" full disabled={deleting} onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </Sheet>
    </>
  );
}

// Streak Settings Section — the days/week the N★ streak is measured at.
function StreakSettingsSection({ isDark, onChange }: { isDark: boolean; onChange: () => void }) {
  const [commitment, setCommitment] = useState<number | null>(() => storage.getAppSettings().streak.commitment);
  const resolved = storage.getStreakCommitment();

  const choose = (value: number | null) => {
    storage.updateAppSettings('streak', { commitment: value });
    setCommitment(value);
    onChange();
  };

  const chip = (active: boolean) => `px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
    active
      ? 'bg-gradient-to-r from-orange-500 to-red-600 text-white'
      : isDark ? 'bg-[#252525] text-zinc-400 hover:bg-[#303030]' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
  }`;

  return (
    <div className={`rounded-xl p-4 border space-y-3 ${isDark ? 'bg-[#1a1a1a] border-[#2e2e2e]' : 'bg-white border-gray-200'}`}>
      <div className="flex items-center gap-2">
        <Flame className="w-5 h-5 text-orange-400" />
        <span className="font-medium">Streak commitment</span>
      </div>
      <p className={`text-xs ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>
        How many days a week you commit to train. A week counts toward your streak
        only when you hit this number; freezes protect this level.
      </p>
      <div className="flex flex-wrap gap-1.5">
        <button onClick={() => choose(null)} className={chip(commitment === null)}>
          Auto ({resolved} · from plan)
        </button>
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <button key={n} onClick={() => choose(n)} className={chip(commitment === n)}>
            {n} {n === 1 ? 'day' : 'days'}
          </button>
        ))}
      </div>
    </div>
  );
}

// Sound + haptics section
function SoundSettingsSection({ isDark }: { isDark: boolean }) {
  const [settings, setSettings] = useState(() => storage.getSoundSettings());
  const [haptics, setHaptics] = useState(() => storage.getHapticSettings());

  const toggleSetting = (key: 'enabled' | 'celebration' | 'timer') => {
    const next = { ...settings, [key]: !settings[key] };
    storage.setSoundSettings(next);
    setSettings(next);
    // Play the thing being switched on, so the toggle demonstrates itself.
    if (next[key]) playCue(key === 'timer' ? 'restDone' : 'workoutComplete');
  };

  const toggleHaptics = () => {
    const next = { enabled: !haptics.enabled };
    storage.setHapticSettings(next);
    setHaptics(next);
    if (next.enabled) hapticCue('setComplete');
  };

  const row = `flex items-center justify-between py-2 border-t ${isDark ? 'border-[#2e2e2e]' : 'border-gray-200'}`;
  const testBtn = `px-2 py-1 text-xs rounded ${isDark ? 'bg-[#252525] text-zinc-400' : 'bg-gray-100 text-gray-500'}`;
  const toggle = (on: boolean, small = false) =>
    `relative ${small ? 'w-10 h-5' : 'w-12 h-6'} rounded-full transition-colors ${
      on ? 'bg-pink-500' : isDark ? 'bg-[#3e3e3e]' : 'bg-gray-300'
    }`;
  const knob = (on: boolean, small = false) =>
    `absolute ${small ? 'top-0.5' : 'top-1'} w-4 h-4 rounded-full bg-white transition-transform ${
      on ? (small ? 'left-5' : 'left-7') : (small ? 'left-0.5' : 'left-1')
    }`;

  return (
    <div className={`rounded-xl p-4 border ${isDark ? 'bg-[#1a1a1a] border-[#2e2e2e]' : 'bg-white border-gray-200'}`}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Volume2 className="w-5 h-5 text-pink-400" />
          <span className="font-medium">Sound Effects</span>
        </div>
        <button onClick={() => toggleSetting('enabled')} className={toggle(settings.enabled)} aria-pressed={settings.enabled} aria-label="Sound effects">
          <div className={knob(settings.enabled)} />
        </button>
      </div>

      {settings.enabled && (
        <div className="space-y-3">
          <div className={row}>
            <div>
              <div className="text-sm font-medium">Celebration</div>
              <div className={`text-xs ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
                PRs, finishing a session, levelling up
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => playCue('prCelebration')} className={testBtn}>Test</button>
              <button onClick={() => toggleSetting('celebration')} className={toggle(settings.celebration, true)} aria-pressed={settings.celebration} aria-label="Celebration sounds">
                <div className={knob(settings.celebration, true)} />
              </button>
            </div>
          </div>

          <div className={row}>
            <div>
              <div className="text-sm font-medium">Rest timer</div>
              <div className={`text-xs ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
                A heads-up three seconds out, then time
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => playCue('restDone')} className={testBtn}>Test</button>
              <button onClick={() => toggleSetting('timer')} className={toggle(settings.timer, true)} aria-pressed={settings.timer} aria-label="Rest timer sounds">
                <div className={knob(settings.timer, true)} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Haptics — its own switch, because plenty of people want the buzz
          without the noise in a gym. */}
      <div className={`${row} mt-3`}>
        <div className="flex items-center gap-2">
          <Vibrate className="w-5 h-5 text-pink-400" />
          <div>
            <div className="text-sm font-medium">Vibration</div>
            <div className={`text-xs ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
              A tap per set, a pattern for a PR
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => hapticCue('prCelebration')} className={testBtn}>Test</button>
          <button onClick={toggleHaptics} className={toggle(haptics.enabled, true)} aria-pressed={haptics.enabled} aria-label="Vibration">
            <div className={knob(haptics.enabled, true)} />
          </button>
        </div>
      </div>
    </div>
  );
}

// Data Backup Section (JSON Export/Import)
function DataBackupSection({ isDark, onDataChange }: { isDark: boolean; onDataChange: () => void }) {
  const { showToast } = useToast();
  const { confirm: confirmDialog } = useConfirm();
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const handleExportJSON = () => {
    const data = {
      version: '2.30.0',
      exportedAt: new Date().toISOString(),
      workouts: storage.getWorkouts(),
      exercises: storage.getExercises(),
      weeklyPlans: storage.getWeeklyPlans(),
      personalRecords: storage.getPersonalRecords(),
      bodyWeight: storage.getBodyWeightEntries(),
      settings: {
        theme: storage.getThemeSettings(),
        sound: storage.getSoundSettings(),
        restPresets: storage.getRestTimerPresets(),
        volumeGoals: storage.getVolumeGoals(),
      },
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `zenith-fitness-backup-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  
  const handleImportJSON = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setImporting(true);
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      
      // Validate structure
      if (!data.workouts || !data.exercises) {
        throw new Error('Invalid backup file format');
      }
      
      // Confirm overwrite
      const confirmed = await confirmDialog({ title: 'Import backup?', confirmLabel: 'Import', message:
        `This will import:\n` +
        `• ${data.workouts?.length || 0} workouts\n` +
        `• ${data.exercises?.length || 0} exercises\n` +
        `• ${data.weeklyPlans?.length || 0} weekly plans\n\n` +
        `This will MERGE with existing data. Continue?` });
      
      if (!confirmed) {
        setImporting(false);
        return;
      }
      
      // Import workouts (merge, avoid duplicates by ID)
      if (data.workouts) {
        const existing = storage.getWorkouts();
        const existingIds = new Set(existing.map(w => w.id));
        const newWorkouts = (data.workouts as Workout[]).filter((w) => !existingIds.has(w.id));
        if (newWorkouts.length > 0) {
          storage.saveWorkouts([...existing, ...newWorkouts]);
        }
      }
      
      // Import exercises (merge)
      if (data.exercises) {
        const existing = storage.getExercises();
        const existingIds = new Set(existing.map(e => e.id));
        const newExercises = (data.exercises as Exercise[]).filter((e) => !existingIds.has(e.id));
        if (newExercises.length > 0) {
          storage.saveExercises([...existing, ...newExercises]);
        }
      }
      
      // Import weekly plans (merge)
      if (data.weeklyPlans) {
        const existing = storage.getWeeklyPlans();
        const existingIds = new Set(existing.map(p => p.id));
        const newPlans = (data.weeklyPlans as WeeklyPlan[]).filter((p) => !existingIds.has(p.id));
        if (newPlans.length > 0) {
          storage.saveWeeklyPlans([...existing, ...newPlans]);
        }
      }
      
      // Import PRs (merge, keep best)
      if (data.personalRecords) {
        const existing = storage.getPersonalRecords();
        const merged = [...existing];
        for (const pr of data.personalRecords) {
          const idx = merged.findIndex(p => p.exerciseId === pr.exerciseId);
          if (idx >= 0) {
            if (pr.weight > merged[idx].weight) merged[idx] = pr;
          } else {
            merged.push(pr);
          }
        }
        storage.savePersonalRecords(merged);
      }
      
      showToast('Import successful — data merged.');
      onDataChange();
    } catch (err) {
      showToast(`Import failed: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error');
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };
  
  return (
    <div className={`rounded-xl p-4 border ${isDark ? 'bg-[#1a1a1a] border-[#2e2e2e]' : 'bg-white border-gray-200'}`}>
      <div className="flex items-center gap-2 mb-4">
        <Download className="w-5 h-5 text-amber-400" />
        <span className="font-medium">Full Data Backup</span>
      </div>
      
      <p className={`text-sm mb-4 ${isDark ? 'text-zinc-400' : 'text-gray-600'}`}>
        Export/import all your data as JSON. Perfect for backups or transferring to a new device.
      </p>
      
      <div className="flex gap-2">
        <button
          onClick={handleExportJSON}
          className="flex-1 bg-amber-600 hover:bg-amber-500 text-white font-medium py-2.5 rounded-lg flex items-center justify-center gap-2 transition-colors text-sm"
        >
          <Download className="w-4 h-4" />
          Export JSON
        </button>
        
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          onChange={handleImportJSON}
          className="hidden"
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={importing}
          className={`flex-1 py-2.5 rounded-lg flex items-center justify-center gap-2 transition-colors text-sm font-medium ${
            isDark ? 'bg-[#252525] hover:bg-[#303030] text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-900'
          }`}
        >
          {importing ? (
            <div className="w-4 h-4 border-2 border-amber-500/30 border-t-amber-500 rounded-full animate-spin" />
          ) : (
            <Upload className="w-4 h-4" />
          )}
          Import JSON
        </button>
      </div>
      
      <div className={`text-xs mt-3 ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
        Includes: workouts, exercises, plans, PRs, body weight, settings
      </div>
    </div>
  );
}

// Rest Timer Presets Section
function RestTimerPresetsSection({ isDark }: { isDark: boolean }) {
  const { showToast } = useToast();
  const [presets, setPresets] = useState(() => storage.getRestTimerPresets());
  const [newPreset, setNewPreset] = useState('');
  
  const addPreset = () => {
    const seconds = parseInt(newPreset);
    if (isNaN(seconds) || seconds < 10 || seconds > 600) {
      showToast('Enter a value between 10 and 600 seconds', 'error');
      return;
    }
    if (presets.includes(seconds)) {
      showToast('This preset already exists', 'error');
      return;
    }
    if (presets.length >= 6) {
      showToast('Maximum 6 presets allowed', 'error');
      return;
    }
    const updated = [...presets, seconds].sort((a, b) => a - b);
    storage.setRestTimerPresets(updated);
    setPresets(updated);
    setNewPreset('');
  };
  
  const removePreset = (seconds: number) => {
    if (presets.length <= 2) {
      showToast('Minimum 2 presets required', 'error');
      return;
    }
    const updated = presets.filter(p => p !== seconds);
    storage.setRestTimerPresets(updated);
    setPresets(updated);
  };
  
  const resetDefaults = () => {
    storage.resetRestTimerPresets();
    setPresets(storage.getRestTimerPresets());
  };
  
  const formatTime = (seconds: number) => {
    if (seconds >= 60) {
      return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    }
    return `${seconds}s`;
  };
  
  return (
    <div className={`rounded-xl p-4 border ${isDark ? 'bg-[#1a1a1a] border-[#2e2e2e]' : 'bg-white border-gray-200'}`}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Clock className="w-5 h-5 text-orange-400" />
          <span className="font-medium">Rest Timer Presets</span>
        </div>
        <button
          onClick={resetDefaults}
          className={`text-xs px-2 py-1 rounded ${isDark ? 'bg-[#252525] text-zinc-400' : 'bg-gray-100 text-gray-500'}`}
        >
          Reset
        </button>
      </div>
      
      {/* Current Presets */}
      <div className="flex flex-wrap gap-2 mb-4">
        {presets.map(seconds => (
          <div
            key={seconds}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm ${
              isDark ? 'bg-[#252525]' : 'bg-gray-100'
            }`}
          >
            <span>{formatTime(seconds)}</span>
            <button
              onClick={() => removePreset(seconds)}
              className="ml-1 text-zinc-500 hover:text-red-400"
            >
              ×
            </button>
          </div>
        ))}
      </div>
      
      {/* Add New */}
      {presets.length < 6 && (
        <div className="flex gap-2">
          <input
            type="number"
            value={newPreset}
            onChange={(e) => setNewPreset(e.target.value)}
            placeholder="Seconds (10-600)"
            className={`flex-1 rounded-lg px-3 py-2 text-sm border ${
              isDark ? 'bg-[#252525] border-[#3e3e3e] text-white' : 'bg-white border-gray-200'
            }`}
          />
          <button
            onClick={addPreset}
            className="px-4 py-2 bg-orange-500 text-white rounded-lg text-sm font-medium"
          >
            Add
          </button>
        </div>
      )}
      
      <div className={`text-xs mt-3 ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
        These buttons appear during workouts
      </div>
    </div>
  );
}

// Theme Settings Section
function ThemeSettingsSection({ isDark, onThemeChange }: { isDark: boolean; onThemeChange: (theme: 'dark' | 'light') => void }) {
  const [settings, setSettings] = useState(() => storage.getThemeSettings());
  
  const updateMode = (mode: 'dark' | 'light' | 'auto') => {
    storage.setThemeSettings({ mode });
    setSettings(prev => ({ ...prev, mode }));
    // Apply immediately
    const effective = mode === 'auto' ? storage.getEffectiveTheme() : mode;
    onThemeChange(effective);
  };
  
  const updateSchedule = (field: 'autoLightStart' | 'autoLightEnd', value: number) => {
    storage.setThemeSettings({ [field]: value });
    setSettings(prev => ({ ...prev, [field]: value }));
    if (settings.mode === 'auto') {
      onThemeChange(storage.getEffectiveTheme());
    }
  };
  
  return (
    <div className={`rounded-xl p-4 border ${isDark ? 'bg-[#1a1a1a] border-[#2e2e2e]' : 'bg-white border-gray-200'}`}>
      <div className="flex items-center gap-2 mb-4">
        <Palette className="w-5 h-5 text-violet-400" />
        <span className="font-medium">Theme</span>
      </div>
      
      {/* Mode Selection */}
      <div className="flex gap-2 mb-4">
        {(['dark', 'light', 'auto'] as const).map(mode => (
          <button
            key={mode}
            onClick={() => updateMode(mode)}
            className={`flex-1 py-2.5 rounded-lg text-sm font-medium flex items-center justify-center gap-1.5 transition-colors ${
              settings.mode === mode
                ? 'bg-violet-500 text-white'
                : isDark ? 'bg-[#252525] text-zinc-400' : 'bg-gray-100 text-gray-600'
            }`}
          >
            {mode === 'dark' && <Moon className="w-4 h-4" />}
            {mode === 'light' && <Sun className="w-4 h-4" />}
            {mode === 'auto' && <Clock className="w-4 h-4" />}
            {mode.charAt(0).toUpperCase() + mode.slice(1)}
          </button>
        ))}
      </div>
      
      {/* Auto Schedule */}
      {settings.mode === 'auto' && (
        <div className={`pt-3 border-t ${isDark ? 'border-[#2e2e2e]' : 'border-gray-200'}`}>
          <div className={`text-xs mb-3 ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
            Light mode schedule
          </div>
          <div className="flex items-center gap-3 text-sm">
            <div className="flex items-center gap-2">
              <Sun className="w-4 h-4 text-yellow-400" />
              <select
                value={settings.autoLightStart}
                onChange={(e) => updateSchedule('autoLightStart', parseInt(e.target.value))}
                className={`rounded-lg px-2 py-1.5 ${isDark ? 'bg-[#252525] text-white' : 'bg-gray-100'}`}
              >
                {Array.from({length: 24}, (_, i) => (
                  <option key={i} value={i}>{i.toString().padStart(2, '0')}:00</option>
                ))}
              </select>
            </div>
            <span className={isDark ? 'text-zinc-500' : 'text-gray-500'}>to</span>
            <div className="flex items-center gap-2">
              <Moon className="w-4 h-4 text-blue-400" />
              <select
                value={settings.autoLightEnd}
                onChange={(e) => updateSchedule('autoLightEnd', parseInt(e.target.value))}
                className={`rounded-lg px-2 py-1.5 ${isDark ? 'bg-[#252525] text-white' : 'bg-gray-100'}`}
              >
                {Array.from({length: 24}, (_, i) => (
                  <option key={i} value={i}>{i.toString().padStart(2, '0')}:00</option>
                ))}
              </select>
            </div>
          </div>
          <div className={`text-xs mt-2 ${isDark ? 'text-zinc-600' : 'text-gray-400'}`}>
            Currently: {isDark ? 'Dark' : 'Light'} mode
          </div>
        </div>
      )}
    </div>
  );
}


// Settings View
type CategoryId = 'account' | 'appearance' | 'workout' | 'sound' | 'notifications' | 'health' | 'data' | 'about';

interface Category {
  id: CategoryId;
  title: string;
  subtitle: string;
  icon: LucideIcon;
  tint: string;
}

/** The index. Order is by how often a setting is actually touched, not by
 *  how the code happens to be arranged. */
const CATEGORIES: Category[] = [
  { id: 'account', title: 'Account', subtitle: 'Profile, sign-in and your data', icon: User, tint: 'text-blue-400' },
  { id: 'appearance', title: 'Appearance', subtitle: 'Theme and automatic dark mode', icon: Palette, tint: 'text-purple-400' },
  { id: 'workout', title: 'Workout', subtitle: 'Rest timers and weekly commitment', icon: Dumbbell, tint: 'text-orange-400' },
  { id: 'sound', title: 'Sound & vibration', subtitle: 'Cues for sets, timers and PRs', icon: Volume2, tint: 'text-pink-400' },
  { id: 'notifications', title: 'Notifications', subtitle: 'Push reminders and buddy alerts', icon: Bell, tint: 'text-amber-400' },
  { id: 'health', title: 'Health sync', subtitle: 'Health Connect read and write-back', icon: HeartPulse, tint: 'text-red-400' },
  { id: 'data', title: 'Data & backup', subtitle: 'Export, import and restore', icon: Database, tint: 'text-cyan-400' },
  { id: 'about', title: 'About', subtitle: `Version ${__APP_VERSION__} and updates`, icon: Info, tint: 'text-zinc-400' },
];

/**
 * Settings, as a phone does it: a list of categories, then one screen of
 * settings at a time. Every option used to be on one page, which meant
 * scrolling past sound cues and CSV exports to change the theme.
 */
export function SettingsView({ onBack, onDataChange, isDark, onThemeChange }: {
  onBack: () => void;
  onDataChange: () => void;
  onThemeChange: (theme: 'dark' | 'light') => void;
  isDark: boolean;
}) {
  const { confirm: confirmDialog } = useConfirm();
  const [open, setOpen] = useState<CategoryId | null>(null);
  const [exportCsv, setExportCsv] = useState('');
  const [guestBackup, setGuestBackup] = useState(() => storage.getGuestBackupInfo());
  const { showToast } = useToast();
  const [copied, setCopied] = useState(false);
  const { user, isGuest, signOut, exitGuestMode } = useAuth();

  // Back closes the open category before it leaves settings altogether.
  useEffect(() => {
    if (!open) return;
    return registerBackHandler(() => { setOpen(null); return true; });
  }, [open]);

  const handleExport = () => setExportCsv(storage.exportToCSV());

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(exportCsv);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = exportCsv;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const cardCls = `rounded-xl border ${isDark ? 'bg-[#1a1a1a] border-[#2e2e2e]' : 'bg-white border-gray-200'}`;
  const current = CATEGORIES.find((c) => c.id === open) ?? null;

  const header = (
    <div className="flex items-center gap-4">
      <button
        onClick={() => (open ? setOpen(null) : onBack())}
        aria-label={open ? 'Back to settings' : 'Back'}
        className={`p-2 -ml-2 ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}
      >
        <ChevronLeft className="w-6 h-6" />
      </button>
      <h1 className="text-xl font-bold">{current ? current.title : 'Settings'}</h1>
    </div>
  );

  if (!current) {
    return (
      <div className="space-y-4 animate-fadeIn">
        {header}
        <div className={`${cardCls} divide-y ${isDark ? 'divide-[#2e2e2e]' : 'divide-gray-100'}`}>
          {CATEGORIES.map(({ id, title, subtitle, icon: Icon, tint }) => (
            <button
              key={id}
              onClick={() => setOpen(id)}
              className="w-full min-h-16 px-4 flex items-center gap-3 text-left"
            >
              <span className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${isDark ? 'bg-[#252525]' : 'bg-gray-100'}`}>
                <Icon className={`w-5 h-5 ${tint}`} strokeWidth={1.75} />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-[15px] font-semibold truncate">{title}</span>
                <span className={`block text-xs truncate ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>{subtitle}</span>
              </span>
              <ChevronRight className={`w-[18px] h-[18px] shrink-0 ${isDark ? 'text-zinc-600' : 'text-gray-400'}`} strokeWidth={1.75} />
            </button>
          ))}
        </div>
        <div className={`text-center text-xs space-y-1 ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
          <p>Zenith Fitness v{__APP_VERSION__}</p>
          <p>Built by Rishi</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-fadeIn">
      {header}

      {open === 'account' && (
        <div className={`${cardCls} p-4`}>
          {user ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                {user.photoURL ? (
                  <img src={user.photoURL} alt="" className="w-10 h-10 rounded-full" referrerPolicy="no-referrer" />
                ) : (
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center ${isDark ? 'bg-blue-500/20' : 'bg-blue-100'}`}>
                    <User className="w-5 h-5 text-blue-400" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  {user.displayName && <div className="font-medium truncate">{user.displayName}</div>}
                  <div className={`text-sm truncate ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>{user.email || 'No email'}</div>
                </div>
              </div>
              <EditProfileSection isDark={isDark} />
              <div className="flex items-center gap-2">
                <Cloud className="w-3.5 h-3.5 text-green-400" />
                <span className={`text-xs ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>Data synced to cloud</span>
              </div>
              <button
                onClick={async () => { if (await confirmDialog({ title: 'Sign out?', message: 'Your data is safely stored in the cloud.', confirmLabel: 'Sign out' })) signOut(); }}
                className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isDark ? 'bg-[#252525] hover:bg-[#303030] text-zinc-300' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                }`}
              >
                <LogOut className="w-4 h-4" />
                Sign Out
              </button>
              <DeleteAccountSection isDark={isDark} />
            </div>
          ) : isGuest ? (
            <div className="space-y-3">
              <div className={`flex items-center gap-2 ${isDark ? 'text-yellow-400/80' : 'text-yellow-600'}`}>
                <span className="text-xs">Guest mode — data stored on this device only</span>
              </div>
              <button
                onClick={exitGuestMode}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium bg-gradient-to-r from-orange-500 to-red-600 text-white hover:opacity-90 transition-opacity"
              >
                <LogIn className="w-4 h-4" />
                Sign In to Sync Data
              </button>
            </div>
          ) : null}
        </div>
      )}

      {open === 'appearance' && <ThemeSettingsSection isDark={isDark} onThemeChange={onThemeChange} />}

      {open === 'workout' && (
        <>
          <RestTimerPresetsSection isDark={isDark} />
          <StreakSettingsSection isDark={isDark} onChange={onDataChange} />
        </>
      )}

      {open === 'sound' && <SoundSettingsSection isDark={isDark} />}
      {open === 'notifications' && <PushNotificationsSection isDark={isDark} />}
      {open === 'health' && <HealthSyncSection isDark={isDark} />}

      {open === 'data' && (
        <div className={`${cardCls} p-4 space-y-3`}>
          <div className="flex items-center gap-2">
            <Upload className="w-5 h-5 text-blue-400" />
            <span className="font-medium">Data Import / Export</span>
          </div>
          <p className={`text-sm ${isDark ? 'text-zinc-400' : 'text-gray-600'}`}>
            Back up your workouts or move them to another device.
          </p>
          {guestBackup && (
            <div className={`rounded-lg border p-3 ${isDark ? 'border-orange-500/40 bg-orange-500/10' : 'border-orange-300 bg-orange-50'}`}>
              <div className="text-sm font-medium">Workouts from before you signed in</div>
              <p className={`text-xs mt-0.5 ${isDark ? 'text-zinc-400' : 'text-gray-600'}`}>
                {guestBackup.workouts} workout{guestBackup.workouts === 1 ? '' : 's'} logged as a guest on this device were kept aside when you signed in. Add them to this account?
              </p>
              <button
                onClick={() => {
                  const n = storage.restoreGuestBackup();
                  setGuestBackup(null);
                  window.dispatchEvent(new Event('zenith-data-refresh'));
                  showToast(n > 0 ? `Added ${n} workout${n === 1 ? '' : 's'} to your account.` : 'Nothing new to add.');
                }}
                className="mt-2 w-full py-2 rounded-lg text-sm font-semibold bg-gradient-to-r from-orange-500 to-red-600 text-white"
              >
                Add them to my account
              </button>
            </div>
          )}
          {!exportCsv ? (
            <button
              onClick={handleExport}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white font-medium py-2.5 rounded-lg flex items-center justify-center gap-2 transition-colors text-sm"
            >
              <FileSpreadsheet className="w-4 h-4" />
              Export to CSV
            </button>
          ) : (
            <div className="space-y-2">
              <textarea
                value={exportCsv}
                readOnly
                className={`w-full h-32 rounded-lg px-3 py-2 text-xs font-mono resize-none border ${
                  isDark ? 'bg-[#252525] border-[#3e3e3e] text-zinc-300' : 'bg-gray-50 border-gray-200 text-gray-700'
                }`}
              />
              <button
                onClick={copyToClipboard}
                className="w-full bg-blue-600 hover:bg-blue-500 text-white font-medium py-2.5 rounded-lg flex items-center justify-center gap-2 transition-colors text-sm"
              >
                {copied ? (<><CheckCircle2 className="w-4 h-4" /> Copied</>) : (<><Copy className="w-4 h-4" /> Copy CSV</>)}
              </button>
            </div>
          )}
          <DataBackupSection isDark={isDark} onDataChange={onDataChange} />
        </div>
      )}

      {open === 'about' && (
        <>
          <CheckForUpdatesSection isDark={isDark} />
          <div className={`${cardCls} p-4 text-center text-xs space-y-1 ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
            <p>Zenith Fitness v{__APP_VERSION__}</p>
            <p>Built by Rishi</p>
          </div>
        </>
      )}
    </div>
  );
}

function HealthSyncSection({ isDark }: { isDark: boolean }) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [enabled, setEnabled] = useState(() => isHealthSyncEnabled());
  // `available` is now the real Health Connect probe (native Android +
  // @capgo/capacitor-health + Health Connect installed), so the two
  // unavailable cases are "you're in a browser" (install the APK) and
  // "you're in the APK but Health Connect isn't set up" (install it from
  // the Play Store) — both actionable, unlike the old "coming soon" copy.
  const isNative = Capacitor.isNativePlatform();

  useEffect(() => {
    let cancelled = false;
    canWriteHealthData().then((v) => { if (!cancelled) setAvailable(v); });
    return () => { cancelled = true; };
  }, []);

  const cardBg = isDark ? 'bg-[#1a1a1a]' : 'bg-white';
  const cardBorder = isDark ? 'border-[#2e2e2e]' : 'border-gray-200';

  return (
    <div className={`rounded-xl p-4 border space-y-3 ${cardBg} ${cardBorder}`}>
      <div className="flex items-center gap-2">
        <Cloud className="w-5 h-5 text-green-400" />
        <span className="font-medium">Health sync</span>
      </div>
      {available === false ? (
        <p className="text-xs text-zinc-500">
          {isNative
            ? 'Health Connect is not set up on this phone. Install "Health Connect by Android" from the Play Store (Android 14+ has it built in), then reopen Zenith.'
            : 'Install the Android app to read steps, sleep and heart rate from Health Connect. Not available in the browser.'}
        </p>
      ) : (
        <>
          <p className="text-xs text-zinc-500">
            When enabled, every finished workout is recorded as a session on
            that day's Activity screen, with duration and an approximate
            calorie estimate.
          </p>
          <label className="flex items-center justify-between gap-3 pt-1">
            <span className="text-sm">Sync completed workouts</span>
            <button
              onClick={() => {
                const next = !enabled;
                setEnabled(next);
                setHealthSyncEnabled(next);
              }}
              className={`w-10 h-6 rounded-full transition-colors relative ${
                enabled ? 'bg-orange-500' : isDark ? 'bg-zinc-700' : 'bg-gray-300'
              }`}
              aria-pressed={enabled}
            >
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${enabled ? 'translate-x-4' : ''}`} />
            </button>
          </label>
        </>
      )}
    </div>
  );
}

function PushNotificationsSection({ isDark }: { isDark: boolean }) {
  const { showToast } = useToast();
  const { user } = useAuth();
  // `perm` drives the three render branches. We kick off an async probe
  // on mount rather than reading Notification.permission synchronously —
  // the Capacitor Android WebView does NOT expose the Notification API,
  // which caused this section to always say "browser doesn't support"
  // on the APK even though the native plugin is available.
  const [perm, setPerm] = useState<'prompt' | 'granted' | 'denied' | 'unsupported' | 'loading'>('loading');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supported = await pushSupported();
      if (cancelled) return;
      if (!supported) { setPerm('unsupported'); return; }
      const state = await pushPermissionState();
      if (!cancelled) setPerm(state);
    })();
    return () => { cancelled = true; };
  }, []);

  const handleEnable = async () => {
    setBusy(true);
    try {
      const token = await enablePushNotifications();
      // Re-probe — on native the user could have flipped the system-level
      // permission mid-flow. Stay in sync with whatever the OS says.
      const state = await pushPermissionState();
      setPerm(state);
      if (!token) {
        showToast('Push notifications could not be enabled. Check device settings and try again.', 'error');
      }
    } finally {
      setBusy(false);
    }
  };

  const cardBg = isDark ? 'bg-[#1a1a1a]' : 'bg-white';
  const cardBorder = isDark ? 'border-[#2e2e2e]' : 'border-gray-200';

  return (
    <div className={`rounded-xl p-4 border space-y-3 ${cardBg} ${cardBorder}`}>
      <div className="flex items-center gap-2">
        <Bell className="w-5 h-5 text-orange-400" />
        <span className="font-medium">Push notifications</span>
      </div>
      {perm === 'loading' ? (
        <p className="text-xs text-zinc-500">Checking notification support…</p>
      ) : perm === 'unsupported' ? (
        <p className="text-xs text-zinc-500">
          Your device doesn't support push notifications. For the web app,
          enable notifications in your browser. For the installed app,
          make sure you're on the latest APK.
        </p>
      ) : perm === 'granted' ? (
        <div className="space-y-2">
          <p className="text-xs text-emerald-400">
            Enabled on this device. You'll get a push when buddies message
            you, invite you to a session, or send a workout invite.
          </p>
          {isAdmin(user?.uid) && (
          <button
            onClick={async () => {
              try {
                await buddyService.sendTestNotification();
                // No alert — if the toast appears, the pipeline works.
                // If not, the user will see console logs starting with
                // [Notif][TEST] indicating where the break is.
              } catch (err) {
                showToast('Test notification failed: ' + (err as Error).message, 'error');
              }
            }}
            className="w-full py-1.5 rounded-lg text-[11px] font-medium border border-orange-500/40 text-orange-400 hover:bg-orange-500/10 transition-colors"
          >
            Send a test notification to yourself
          </button>
          )}
        </div>
      ) : perm === 'denied' ? (
        <div className="text-xs text-red-400 space-y-1.5">
          <p>Notifications are blocked for this app.</p>
          <p className="text-zinc-500">
            <strong>Chrome (web):</strong> tap the lock icon in the URL bar → Site settings → Notifications → Allow. Then reload.
          </p>
          <p className="text-zinc-500">
            <strong>Android app:</strong> system Settings → Apps → Zenith Fitness → Notifications → On.
          </p>
        </div>
      ) : (
        <>
          <p className="text-xs text-zinc-500">
            Get notified when buddies message you, invite you to a workout,
            or start a session — even when the app isn't open.
          </p>
          <button
            onClick={handleEnable}
            disabled={busy}
            className="w-full py-2.5 rounded-lg text-sm font-medium bg-gradient-to-r from-orange-500 to-red-600 text-white hover:opacity-90 disabled:opacity-60 transition-opacity"
          >
            {busy ? 'Requesting…' : 'Enable notifications'}
          </button>
        </>
      )}
    </div>
  );
}

function CheckForUpdatesSection({ isDark }: { isDark: boolean }) {
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<null | { type: 'ok' | 'new' | 'err'; message: string; url?: string }>(null);

  const handleCheck = async () => {
    setChecking(true);
    setResult(null);
    const r = await manualCheckForUpdates();
    if (r.status === 'up-to-date') {
      setResult({ type: 'ok', message: `You're on the latest version (v${r.current})` });
    } else if (r.status === 'update-available') {
      setResult({
        type: 'new',
        message: `Update available: v${r.latest}`,
        url: r.releaseUrl,
      });
    } else {
      setResult({ type: 'err', message: `Couldn't check: ${r.message}` });
    }
    setChecking(false);
  };

  const cardBg = isDark ? 'bg-[#1a1a1a]' : 'bg-white';
  const cardBorder = isDark ? 'border-[#2e2e2e]' : 'border-gray-200';

  return (
    <div className={`rounded-xl p-4 border space-y-3 ${cardBg} ${cardBorder}`}>
      <div className="flex items-center gap-2">
        <Download className="w-5 h-5 text-orange-400" />
        <span className="font-medium">Check for Updates</span>
      </div>
      <button
        onClick={handleCheck}
        disabled={checking}
        className="w-full py-2.5 rounded-lg text-sm font-medium bg-gradient-to-r from-orange-500 to-red-600 text-white hover:opacity-90 disabled:opacity-50 transition-opacity flex items-center justify-center gap-2"
      >
        {checking ? 'Checking…' : 'Check now'}
      </button>
      {result && (
        <div
          className={`p-3 rounded-lg text-sm flex items-start gap-2 ${
            result.type === 'ok'
              ? 'bg-emerald-500/15 text-emerald-400'
              : result.type === 'new'
              ? 'bg-orange-500/15 text-orange-400'
              : 'bg-red-500/15 text-red-400'
          }`}
        >
          {result.type === 'ok' ? <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" /> : <Download className="w-4 h-4 mt-0.5 flex-shrink-0" />}
          <div className="flex-1">
            <div>{result.message}</div>
            {result.url && (
              <a
                href={result.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs underline mt-1 inline-block"
              >
                Download latest
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
