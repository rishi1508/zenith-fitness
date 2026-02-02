import { useState, useEffect } from 'react';
import {
  ChevronLeft, ChevronRight, Dumbbell, FileSpreadsheet, Download, Upload,
  CheckCircle2, Copy, X, Scale, Plus, Trash2, Cloud, RefreshCw, Link2
} from 'lucide-react';
import type { BodyWeightEntry } from '../types';
import * as storage from '../storage';
import * as sync from '../sync';

declare const __APP_VERSION__: string;

// Body Weight Tracking Section
function BodyWeightSection({ isDark }: { isDark: boolean }) {
  const [entries, setEntries] = useState<BodyWeightEntry[]>(() => storage.getBodyWeightEntries());
  const [showAddForm, setShowAddForm] = useState(false);
  const [newWeight, setNewWeight] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [showHistory, setShowHistory] = useState(false);

  const latestEntry = entries[0];
  const weekChange = storage.getBodyWeightChange(7);
  const monthChange = storage.getBodyWeightChange(30);

  const handleAddEntry = () => {
    if (!newWeight.trim()) return;
    const weight = parseFloat(newWeight);
    if (isNaN(weight) || weight <= 0) return;
    
    storage.addBodyWeightEntry(weight, newNotes.trim() || undefined);
    setEntries(storage.getBodyWeightEntries());
    setNewWeight('');
    setNewNotes('');
    setShowAddForm(false);
  };

  const handleDeleteEntry = (id: string) => {
    if (confirm('Delete this weight entry?')) {
      storage.deleteBodyWeightEntry(id);
      setEntries(storage.getBodyWeightEntries());
    }
  };

  const formatChange = (change: number) => {
    const sign = change > 0 ? '+' : '';
    return `${sign}${change.toFixed(1)} kg`;
  };

  // Mini chart - last 10 entries
  const chartData = entries.slice(0, 10).reverse();
  const minWeight = chartData.length > 0 ? Math.min(...chartData.map(e => e.weight)) : 0;
  const maxWeight = chartData.length > 0 ? Math.max(...chartData.map(e => e.weight)) : 100;
  const range = maxWeight - minWeight || 1;

  return (
    <div className={`rounded-xl p-4 border ${isDark ? 'bg-[#1a1a1a] border-[#2e2e2e]' : 'bg-white border-gray-200'}`}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Scale className="w-5 h-5 text-purple-400" />
          <span className="font-medium">Body Weight</span>
        </div>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className={`p-2 rounded-lg transition-colors ${
            isDark ? 'bg-purple-500/20 text-purple-400 hover:bg-purple-500/30' : 'bg-purple-100 text-purple-600 hover:bg-purple-200'
          }`}
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {/* Current Weight Display */}
      {latestEntry ? (
        <div className="mb-4">
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold">{latestEntry.weight}</span>
            <span className={isDark ? 'text-zinc-500' : 'text-gray-500'}>kg</span>
          </div>
          <div className={`text-xs ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
            Last logged: {new Date(latestEntry.date).toLocaleDateString()}
            {latestEntry.notes && ` • ${latestEntry.notes}`}
          </div>
          
          {/* Change indicators */}
          <div className="flex gap-4 mt-2">
            {weekChange && (
              <div className={`text-xs ${weekChange.change < 0 ? 'text-green-400' : weekChange.change > 0 ? 'text-red-400' : isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
                7d: {formatChange(weekChange.change)}
              </div>
            )}
            {monthChange && (
              <div className={`text-xs ${monthChange.change < 0 ? 'text-green-400' : monthChange.change > 0 ? 'text-red-400' : isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
                30d: {formatChange(monthChange.change)}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className={`text-center py-4 ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
          <p className="text-sm">No weight entries yet</p>
          <p className="text-xs">Log your first weigh-in!</p>
        </div>
      )}

      {/* Mini Chart */}
      {chartData.length > 1 && (
        <div className="mb-4">
          <svg viewBox="0 0 200 50" className="w-full h-12">
            {/* Line path */}
            <path
              d={chartData.map((entry, i) => {
                const x = (i / (chartData.length - 1)) * 190 + 5;
                const y = 45 - ((entry.weight - minWeight) / range) * 40;
                return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
              }).join(' ')}
              fill="none"
              stroke={isDark ? '#a855f7' : '#9333ea'}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {/* Dots */}
            {chartData.map((entry, i) => {
              const x = (i / (chartData.length - 1)) * 190 + 5;
              const y = 45 - ((entry.weight - minWeight) / range) * 40;
              return (
                <circle
                  key={i}
                  cx={x}
                  cy={y}
                  r="3"
                  fill={isDark ? '#a855f7' : '#9333ea'}
                />
              );
            })}
          </svg>
          <div className="flex justify-between text-xs text-zinc-500">
            <span>{minWeight.toFixed(1)}</span>
            <span>{maxWeight.toFixed(1)} kg</span>
          </div>
        </div>
      )}

      {/* Add Entry Form */}
      {showAddForm && (
        <div className={`mb-4 p-3 rounded-lg ${isDark ? 'bg-[#252525]' : 'bg-gray-50'}`}>
          <div className="space-y-3">
            <div>
              <label className={`text-xs ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>Weight (kg)</label>
              <input
                type="number"
                step="0.1"
                value={newWeight}
                onChange={(e) => setNewWeight(e.target.value)}
                placeholder="e.g., 75.5"
                className={`w-full mt-1 rounded-lg px-3 py-2 text-sm border ${
                  isDark ? 'bg-[#1a1a1a] border-[#3e3e3e] text-white' : 'bg-white border-gray-200'
                } focus:outline-none focus:border-purple-500`}
              />
            </div>
            <div>
              <label className={`text-xs ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>Notes (optional)</label>
              <input
                type="text"
                value={newNotes}
                onChange={(e) => setNewNotes(e.target.value)}
                placeholder="e.g., morning weight, after workout"
                className={`w-full mt-1 rounded-lg px-3 py-2 text-sm border ${
                  isDark ? 'bg-[#1a1a1a] border-[#3e3e3e] text-white' : 'bg-white border-gray-200'
                } focus:outline-none focus:border-purple-500`}
              />
            </div>
            <button
              onClick={handleAddEntry}
              disabled={!newWeight.trim()}
              className="w-full bg-purple-600 hover:bg-purple-500 disabled:bg-purple-800 disabled:opacity-50 text-white font-medium py-2 rounded-lg transition-colors"
            >
              Log Weight
            </button>
          </div>
        </div>
      )}

      {/* History Toggle */}
      {entries.length > 0 && (
        <button
          onClick={() => setShowHistory(!showHistory)}
          className={`w-full text-sm py-2 rounded-lg transition-colors ${
            isDark ? 'text-zinc-400 hover:bg-[#252525]' : 'text-gray-500 hover:bg-gray-100'
          }`}
        >
          {showHistory ? 'Hide History' : `View History (${entries.length} entries)`}
        </button>
      )}

      {/* History List */}
      {showHistory && entries.length > 0 && (
        <div className="mt-3 space-y-2 max-h-48 overflow-y-auto">
          {entries.map((entry, i) => {
            const prevEntry = entries[i + 1];
            const change = prevEntry ? entry.weight - prevEntry.weight : null;
            
            return (
              <div 
                key={entry.id} 
                className={`flex items-center justify-between p-2 rounded-lg ${isDark ? 'bg-[#252525]' : 'bg-gray-50'}`}
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{entry.weight} kg</span>
                    {change !== null && (
                      <span className={`text-xs ${change < 0 ? 'text-green-400' : change > 0 ? 'text-red-400' : 'text-zinc-500'}`}>
                        {change > 0 ? '+' : ''}{change.toFixed(1)}
                      </span>
                    )}
                  </div>
                  <div className={`text-xs ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
                    {new Date(entry.date).toLocaleDateString()}
                    {entry.notes && ` • ${entry.notes}`}
                  </div>
                </div>
                <button
                  onClick={() => handleDeleteEntry(entry.id)}
                  className={`p-1.5 rounded-lg transition-colors ${isDark ? 'text-zinc-500 hover:bg-red-500/20 hover:text-red-400' : 'text-gray-400 hover:bg-red-100 hover:text-red-500'}`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Settings View
export function SettingsView({ onBack, onDataChange, onNavigateToExercises, isDark }: {
  onBack: () => void;
  onDataChange: () => void;
  onNavigateToExercises?: () => void;
  isDark: boolean;
}) {
  const [sheetsUrl, setSheetsUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ success: boolean; message: string } | null>(null);
  const [exportCsv, setExportCsv] = useState('');
  const [copied, setCopied] = useState(false);
  
  // Auto-sync state
  const [syncUrl, setSyncUrl] = useState(() => sync.getSyncUrl() || '');
  const [syncTesting, setSyncTesting] = useState(false);
  const [syncResult, setSyncResult] = useState<{ success: boolean; message: string } | null>(null);
  const [pendingCount, setPendingCount] = useState(() => sync.getPendingCount());
  
  // Refresh pending count periodically
  useEffect(() => {
    const interval = setInterval(() => {
      setPendingCount(sync.getPendingCount());
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleImport = async () => {
    if (!sheetsUrl.trim()) {
      setImportResult({ success: false, message: 'Please enter a Google Sheets URL' });
      return;
    }
    
    setImporting(true);
    setImportResult(null);
    
    try {
      const result = await storage.importFromGoogleSheetsUrl(sheetsUrl);
      if (result.success) {
        setImportResult({ 
          success: true, 
          message: `Imported ${result.workoutsImported} workouts with ${result.exercisesFound} unique exercises!` 
        });
        onDataChange();
        setSheetsUrl('');
      } else {
        setImportResult({ 
          success: false, 
          message: result.errors.join('\n') || 'Import failed' 
        });
      }
    } catch (e) {
      setImportResult({ success: false, message: 'Import error: ' + (e instanceof Error ? e.message : 'Unknown') });
    } finally {
      setImporting(false);
    }
  };

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
      // Fallback for older browsers
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

  const handleSaveSyncUrl = () => {
    if (!syncUrl.trim()) {
      sync.clearSyncUrl();
      setSyncResult({ success: true, message: 'Auto-sync disabled' });
    } else {
      sync.setSyncUrl(syncUrl);
      setSyncResult({ success: true, message: 'Sync URL saved!' });
    }
    setTimeout(() => setSyncResult(null), 3000);
  };

  const handleTestSync = async () => {
    if (!syncUrl.trim()) {
      setSyncResult({ success: false, message: 'Please enter a sync URL first' });
      return;
    }
    
    setSyncTesting(true);
    setSyncResult(null);
    
    // Save URL first
    sync.setSyncUrl(syncUrl);
    
    const result = await sync.testConnection();
    setSyncResult(result);
    setSyncTesting(false);
  };

  const handleProcessQueue = async () => {
    const count = await sync.processQueue();
    setPendingCount(sync.getPendingCount());
    setSyncResult({ success: true, message: `Processed ${count} queued items` });
    setTimeout(() => setSyncResult(null), 3000);
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex items-center gap-4">
        <button onClick={onBack} className={`p-2 -ml-2 ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>
          <ChevronLeft className="w-6 h-6" />
        </button>
        <h1 className="text-xl font-bold">Settings</h1>
      </div>

      {/* Exercise Library Button */}
      {onNavigateToExercises && (
        <button
          onClick={onNavigateToExercises}
          className="w-full bg-orange-500 hover:bg-orange-400 text-white font-medium py-4 px-4 rounded-xl flex items-center justify-between transition-colors"
        >
          <div className="flex items-center gap-3">
            <Dumbbell className="w-5 h-5" />
            <span>Exercise Library</span>
          </div>
          <ChevronRight className="w-5 h-5" />
        </button>
      )}

      {/* Import from Google Sheets */}
      <div className={`rounded-xl p-4 border ${isDark ? 'bg-[#1a1a1a] border-[#2e2e2e]' : 'bg-white border-gray-200'}`}>
        <div className="flex items-center gap-2 mb-4">
          <FileSpreadsheet className="w-5 h-5 text-green-400" />
          <span className="font-medium">Import from Google Sheets</span>
        </div>
        
        <p className={`text-sm mb-4 ${isDark ? 'text-zinc-400' : 'text-gray-600'}`}>
          Import your existing workout history from Google Sheets. The sheet must be publicly accessible (Anyone with link can view).
        </p>
        
        <p className={`text-xs mb-4 ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
          Expected format: Date, Exercise, Set1 Reps, Set1 Weight, Set2 Reps, Set2 Weight, Set3 Reps, Set3 Weight, Volume
        </p>
        
        <input
          type="url"
          value={sheetsUrl}
          onChange={(e) => setSheetsUrl(e.target.value)}
          placeholder="https://docs.google.com/spreadsheets/d/..."
          className={`w-full rounded-lg px-4 py-3 text-sm border mb-3 ${
            isDark ? 'bg-[#252525] border-[#3e3e3e] text-white' : 'bg-white border-gray-200'
          } focus:outline-none focus:border-orange-500`}
        />
        
        <button
          onClick={handleImport}
          disabled={importing}
          className="w-full bg-green-600 hover:bg-green-500 disabled:bg-green-800 disabled:opacity-50 text-white font-medium py-3 rounded-lg flex items-center justify-center gap-2 transition-colors"
        >
          {importing ? (
            <>
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Importing...
            </>
          ) : (
            <>
              <Download className="w-4 h-4" />
              Import Workouts
            </>
          )}
        </button>
        
        {importResult && (
          <div className={`mt-3 p-3 rounded-lg text-sm ${
            importResult.success ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
          }`}>
            {importResult.success ? <CheckCircle2 className="w-4 h-4 inline mr-2" /> : <X className="w-4 h-4 inline mr-2" />}
            {importResult.message}
          </div>
        )}
      </div>

      {/* Export to CSV */}
      <div className={`rounded-xl p-4 border ${isDark ? 'bg-[#1a1a1a] border-[#2e2e2e]' : 'bg-white border-gray-200'}`}>
        <div className="flex items-center gap-2 mb-4">
          <Upload className="w-5 h-5 text-blue-400" />
          <span className="font-medium">Export to CSV</span>
        </div>
        
        <p className={`text-sm mb-4 ${isDark ? 'text-zinc-400' : 'text-gray-600'}`}>
          Export your workout data as CSV. Copy and paste into Google Sheets to sync your data.
        </p>
        
        {!exportCsv ? (
          <button
            onClick={handleExport}
            className="w-full bg-blue-600 hover:bg-blue-500 text-white font-medium py-3 rounded-lg flex items-center justify-center gap-2 transition-colors"
          >
            <FileSpreadsheet className="w-4 h-4" />
            Generate CSV
          </button>
        ) : (
          <div className="space-y-3">
            <textarea
              value={exportCsv}
              readOnly
              className={`w-full h-32 rounded-lg px-3 py-2 text-xs font-mono resize-none border ${
                isDark ? 'bg-[#252525] border-[#3e3e3e] text-zinc-300' : 'bg-gray-50 border-gray-200 text-gray-700'
              }`}
            />
            <button
              onClick={copyToClipboard}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white font-medium py-3 rounded-lg flex items-center justify-center gap-2 transition-colors"
            >
              {copied ? (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  Copied!
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" />
                  Copy to Clipboard
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {/* Auto-Sync to Google Sheets */}
      <div className={`rounded-xl p-4 border ${isDark ? 'bg-[#1a1a1a] border-[#2e2e2e]' : 'bg-white border-gray-200'}`}>
        <div className="flex items-center gap-2 mb-4">
          <Cloud className="w-5 h-5 text-purple-400" />
          <span className="font-medium">Auto-Sync to Google Sheets</span>
          {sync.isSyncEnabled() && (
            <span className="ml-auto text-xs px-2 py-0.5 bg-green-500/20 text-green-400 rounded-full">Active</span>
          )}
        </div>
        
        <p className={`text-sm mb-4 ${isDark ? 'text-zinc-400' : 'text-gray-600'}`}>
          Automatically sync completed workouts to your Google Sheet. Set up by deploying a Google Apps Script.
        </p>
        
        <div className="space-y-3">
          <div>
            <label className={`text-xs ${isDark ? 'text-zinc-500' : 'text-gray-500'} mb-1 block`}>
              Apps Script Web App URL
            </label>
            <input
              type="url"
              value={syncUrl}
              onChange={(e) => setSyncUrl(e.target.value)}
              placeholder="https://script.google.com/macros/s/.../exec"
              className={`w-full rounded-lg px-4 py-3 text-sm border ${
                isDark ? 'bg-[#252525] border-[#3e3e3e] text-white' : 'bg-white border-gray-200'
              } focus:outline-none focus:border-purple-500`}
            />
          </div>
          
          <div className="flex gap-2">
            <button
              onClick={handleSaveSyncUrl}
              className="flex-1 bg-purple-600 hover:bg-purple-500 text-white font-medium py-2.5 rounded-lg flex items-center justify-center gap-2 transition-colors text-sm"
            >
              <Link2 className="w-4 h-4" />
              Save URL
            </button>
            <button
              onClick={handleTestSync}
              disabled={syncTesting}
              className={`flex-1 py-2.5 rounded-lg flex items-center justify-center gap-2 transition-colors text-sm font-medium ${
                isDark ? 'bg-[#252525] hover:bg-[#303030] text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-900'
              }`}
            >
              {syncTesting ? (
                <div className="w-4 h-4 border-2 border-purple-400/30 border-t-purple-400 rounded-full animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
              Test
            </button>
          </div>
          
          {pendingCount > 0 && (
            <button
              onClick={handleProcessQueue}
              className={`w-full py-2.5 rounded-lg flex items-center justify-center gap-2 transition-colors text-sm ${
                isDark ? 'bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30' : 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200'
              }`}
            >
              <Upload className="w-4 h-4" />
              Sync {pendingCount} Pending Item{pendingCount > 1 ? 's' : ''}
            </button>
          )}
          
          {syncResult && (
            <div className={`p-3 rounded-lg text-sm ${
              syncResult.success ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
            }`}>
              {syncResult.success ? <CheckCircle2 className="w-4 h-4 inline mr-2" /> : <X className="w-4 h-4 inline mr-2" />}
              {syncResult.message}
            </div>
          )}
          
          <p className={`text-xs ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
            See docs/GOOGLE_SHEETS_SYNC.md for setup instructions.
          </p>
        </div>
      </div>

      {/* Body Weight Tracking */}
      <BodyWeightSection isDark={isDark} />

      {/* App Info */}
      <div className={`text-center text-xs space-y-1 ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
        <p>Zenith Fitness v{__APP_VERSION__}</p>
        <p>Built with ⚡ by Zenith</p>
      </div>
    </div>
  );
}
