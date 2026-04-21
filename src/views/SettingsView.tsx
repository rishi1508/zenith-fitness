import { useState, useRef } from 'react';
import {
  ChevronLeft, FileSpreadsheet, Download, Upload,
  CheckCircle2, Copy, Volume2, Palette, Sun, Moon, Clock, User, LogOut, LogIn,
  Cloud,
} from 'lucide-react';
import * as storage from '../storage';
import { useAuth } from '../auth/AuthContext';
import { updateProfile } from 'firebase/auth';
import { auth } from '../firebase';
import * as buddyService from '../buddyService';
import { manualCheckForUpdates } from '../UpdateChecker';

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

// Sound Settings Section
function SoundSettingsSection({ isDark }: { isDark: boolean }) {
  const [settings, setSettings] = useState(() => storage.getSoundSettings());
  
  const toggleSetting = (key: 'enabled' | 'celebration' | 'timer') => {
    const newSettings = { ...settings, [key]: !settings[key] };
    storage.setSoundSettings(newSettings);
    setSettings(newSettings);
  };
  
  const playTestSound = (type: 'celebration' | 'timer') => {
    try {
      // Simple beep using Web Audio API
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      oscillator.frequency.value = type === 'celebration' ? 880 : 440;
      oscillator.type = 'sine';
      gainNode.gain.value = 0.3;
      
      oscillator.start();
      
      if (type === 'celebration') {
        // Victory jingle pattern
        setTimeout(() => oscillator.frequency.value = 1047, 100);
        setTimeout(() => oscillator.frequency.value = 1319, 200);
        setTimeout(() => oscillator.stop(), 400);
      } else {
        // Timer beep
        setTimeout(() => oscillator.stop(), 200);
      }
    } catch (e) {
      console.log('Audio not supported');
    }
  };
  
  return (
    <div className={`rounded-xl p-4 border ${isDark ? 'bg-[#1a1a1a] border-[#2e2e2e]' : 'bg-white border-gray-200'}`}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Volume2 className="w-5 h-5 text-pink-400" />
          <span className="font-medium">Sound Effects</span>
        </div>
        <button
          onClick={() => toggleSetting('enabled')}
          className={`relative w-12 h-6 rounded-full transition-colors ${
            settings.enabled ? 'bg-pink-500' : isDark ? 'bg-[#3e3e3e]' : 'bg-gray-300'
          }`}
        >
          <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
            settings.enabled ? 'left-7' : 'left-1'
          }`} />
        </button>
      </div>
      
      {settings.enabled && (
        <div className="space-y-3">
          {/* Celebration Sound */}
          <div className={`flex items-center justify-between py-2 border-t ${isDark ? 'border-[#2e2e2e]' : 'border-gray-200'}`}>
            <div>
              <div className="text-sm font-medium">Celebration</div>
              <div className={`text-xs ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
                Play sound on workout completion & PRs
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => playTestSound('celebration')}
                className={`px-2 py-1 text-xs rounded ${isDark ? 'bg-[#252525] text-zinc-400' : 'bg-gray-100 text-gray-500'}`}
              >
                Test
              </button>
              <button
                onClick={() => toggleSetting('celebration')}
                className={`relative w-10 h-5 rounded-full transition-colors ${
                  settings.celebration ? 'bg-pink-500' : isDark ? 'bg-[#3e3e3e]' : 'bg-gray-300'
                }`}
              >
                <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                  settings.celebration ? 'left-5' : 'left-0.5'
                }`} />
              </button>
            </div>
          </div>
          
          {/* Timer Sound */}
          <div className={`flex items-center justify-between py-2 border-t ${isDark ? 'border-[#2e2e2e]' : 'border-gray-200'}`}>
            <div>
              <div className="text-sm font-medium">Timer Beep</div>
              <div className={`text-xs ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
                Play sound when rest timer ends
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => playTestSound('timer')}
                className={`px-2 py-1 text-xs rounded ${isDark ? 'bg-[#252525] text-zinc-400' : 'bg-gray-100 text-gray-500'}`}
              >
                Test
              </button>
              <button
                onClick={() => toggleSetting('timer')}
                className={`relative w-10 h-5 rounded-full transition-colors ${
                  settings.timer ? 'bg-pink-500' : isDark ? 'bg-[#3e3e3e]' : 'bg-gray-300'
                }`}
              >
                <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                  settings.timer ? 'left-5' : 'left-0.5'
                }`} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Data Backup Section (JSON Export/Import)
function DataBackupSection({ isDark, onDataChange }: { isDark: boolean; onDataChange: () => void }) {
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
      const confirmed = confirm(
        `This will import:\n` +
        `• ${data.workouts?.length || 0} workouts\n` +
        `• ${data.exercises?.length || 0} exercises\n` +
        `• ${data.weeklyPlans?.length || 0} weekly plans\n\n` +
        `This will MERGE with existing data. Continue?`
      );
      
      if (!confirmed) {
        setImporting(false);
        return;
      }
      
      // Import workouts (merge, avoid duplicates by ID)
      if (data.workouts) {
        const existing = storage.getWorkouts();
        const existingIds = new Set(existing.map(w => w.id));
        const newWorkouts = data.workouts.filter((w: any) => !existingIds.has(w.id));
        if (newWorkouts.length > 0) {
          storage.saveWorkouts([...existing, ...newWorkouts]);
        }
      }
      
      // Import exercises (merge)
      if (data.exercises) {
        const existing = storage.getExercises();
        const existingIds = new Set(existing.map(e => e.id));
        const newExercises = data.exercises.filter((e: any) => !existingIds.has(e.id));
        if (newExercises.length > 0) {
          storage.saveExercises([...existing, ...newExercises]);
        }
      }
      
      // Import weekly plans (merge)
      if (data.weeklyPlans) {
        const existing = storage.getWeeklyPlans();
        const existingIds = new Set(existing.map(p => p.id));
        const newPlans = data.weeklyPlans.filter((p: any) => !existingIds.has(p.id));
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
      
      alert('Import successful! Data merged.');
      onDataChange();
    } catch (err) {
      alert(`Import failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
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
  const [presets, setPresets] = useState(() => storage.getRestTimerPresets());
  const [newPreset, setNewPreset] = useState('');
  
  const addPreset = () => {
    const seconds = parseInt(newPreset);
    if (isNaN(seconds) || seconds < 10 || seconds > 600) {
      alert('Enter a value between 10 and 600 seconds');
      return;
    }
    if (presets.includes(seconds)) {
      alert('This preset already exists');
      return;
    }
    if (presets.length >= 6) {
      alert('Maximum 6 presets allowed');
      return;
    }
    const updated = [...presets, seconds].sort((a, b) => a - b);
    storage.setRestTimerPresets(updated);
    setPresets(updated);
    setNewPreset('');
  };
  
  const removePreset = (seconds: number) => {
    if (presets.length <= 2) {
      alert('Minimum 2 presets required');
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
export function SettingsView({ onBack, onDataChange, isDark, onThemeChange }: {
  onBack: () => void;
  onDataChange: () => void;
  onThemeChange: (theme: 'dark' | 'light') => void;
  isDark: boolean;
}) {
  const [exportCsv, setExportCsv] = useState('');
  const [copied, setCopied] = useState(false);
  
  const handleExport = () => {
    const csv = storage.exportToCSV();
    setExportCsv(csv);
  };

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

  const { user, isGuest, signOut, exitGuestMode } = useAuth();

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex items-center gap-4">
        <button onClick={onBack} className={`p-2 -ml-2 ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>
          <ChevronLeft className="w-6 h-6" />
        </button>
        <h1 className="text-xl font-bold">Settings</h1>
      </div>

      {/* Account Section */}
      <div className={`rounded-xl p-4 border ${isDark ? 'bg-[#1a1a1a] border-[#2e2e2e]' : 'bg-white border-gray-200'}`}>
        <div className="flex items-center gap-2 mb-3">
          <User className="w-5 h-5 text-blue-400" />
          <span className="font-medium">Account</span>
        </div>
        {user ? (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              {user.photoURL ? (
                <img src={user.photoURL} alt="" className="w-10 h-10 rounded-full" />
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
              onClick={() => { if (confirm('Sign out? Your data is safely stored in the cloud.')) signOut(); }}
              className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isDark ? 'bg-[#252525] hover:bg-[#303030] text-zinc-300' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
              }`}
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </button>
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

      {/* Sound Settings */}
      <SoundSettingsSection isDark={isDark} />

      {/* Theme Settings */}
      <ThemeSettingsSection isDark={isDark} onThemeChange={onThemeChange} />

      {/* Rest Timer Presets */}
      <RestTimerPresetsSection isDark={isDark} />

      {/* Data Import/Export */}
      <div className={`rounded-xl p-4 border space-y-3 ${isDark ? 'bg-[#1a1a1a] border-[#2e2e2e]' : 'bg-white border-gray-200'}`}>
        <div className="flex items-center gap-2">
          <Upload className="w-5 h-5 text-blue-400" />
          <span className="font-medium">Data Import / Export</span>
        </div>
        <p className={`text-sm ${isDark ? 'text-zinc-400' : 'text-gray-600'}`}>
          Back up your workouts or move them to another device.
        </p>
        {/* CSV Export */}
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
              {copied ? (<><CheckCircle2 className="w-4 h-4" /> Copied!</>) : (<><Copy className="w-4 h-4" /> Copy CSV</>)}
            </button>
          </div>
        )}
        {/* JSON Export / Import */}
        <DataBackupSection isDark={isDark} onDataChange={onDataChange} />
      </div>

      {/* Check for updates */}
      <CheckForUpdatesSection isDark={isDark} />

      {/* App Info */}
      <div className={`text-center text-xs space-y-1 ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
        <p>Zenith Fitness v{__APP_VERSION__}</p>
        <p>Built by Rishi</p>
      </div>
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
