import { useState } from 'react';
import { ArrowLeft, Scale, Plus, Trash2 } from 'lucide-react';
import type { BodyWeightEntry } from '../types';
import * as storage from '../storage';
import { BodyWeightChart } from '../BodyWeightChart';

interface BodyWeightViewProps {
  isDark: boolean;
  onBack: () => void;
}

export function BodyWeightView({ isDark, onBack }: BodyWeightViewProps) {
  const [entries, setEntries] = useState<BodyWeightEntry[]>(() => storage.getBodyWeightEntries());
  const [showAddForm, setShowAddForm] = useState(false);
  const [newWeight, setNewWeight] = useState('');
  const [newNotes, setNewNotes] = useState('');

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

  const cardBg = isDark ? 'bg-[#1a1a1a]' : 'bg-white';
  const cardBorder = isDark ? 'border-[#2e2e2e]' : 'border-gray-200';
  const subtle = isDark ? 'text-zinc-500' : 'text-gray-500';

  return (
    <div className="space-y-4 animate-fadeIn">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={onBack} className={`p-2 rounded-lg transition-colors ${isDark ? 'hover:bg-[#222]' : 'hover:bg-gray-50'}`}>
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-purple-500/20 flex items-center justify-center">
            <Scale className="w-4 h-4 text-purple-400" />
          </div>
          <h1 className="text-xl font-bold">Body Weight</h1>
        </div>
      </div>

      {/* Current Weight Card */}
      <div className={`rounded-xl border p-5 ${cardBg} ${cardBorder}`}>
        <div className="flex items-start justify-between">
          <div>
            {latestEntry ? (
              <>
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-bold">{latestEntry.weight}</span>
                  <span className={subtle}>kg</span>
                </div>
                <div className={`text-xs mt-1 ${subtle}`}>
                  {new Date(latestEntry.date).toLocaleDateString()}
                  {latestEntry.notes && ` · ${latestEntry.notes}`}
                </div>
                <div className="flex gap-4 mt-3">
                  {weekChange && (
                    <div className={`text-xs ${weekChange.change < 0 ? 'text-green-400' : weekChange.change > 0 ? 'text-red-400' : subtle}`}>
                      7d: {formatChange(weekChange.change)}
                    </div>
                  )}
                  {monthChange && (
                    <div className={`text-xs ${monthChange.change < 0 ? 'text-green-400' : monthChange.change > 0 ? 'text-red-400' : subtle}`}>
                      30d: {formatChange(monthChange.change)}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div>
                <p className={`text-sm ${subtle}`}>No weight entries yet</p>
                <p className={`text-xs ${subtle}`}>Log your first weigh-in.</p>
              </div>
            )}
          </div>
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-medium bg-purple-500/15 text-purple-400 hover:bg-purple-500/25 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Log
          </button>
        </div>
      </div>

      {/* Add form */}
      {showAddForm && (
        <div className={`rounded-xl border p-4 space-y-3 ${cardBg} ${cardBorder}`}>
          <div>
            <label className={`text-xs ${subtle}`}>Weight (kg)</label>
            <input
              type="number" step="0.1" value={newWeight}
              onChange={(e) => setNewWeight(e.target.value)}
              placeholder="e.g. 75.5"
              autoFocus
              className={`w-full mt-1 rounded-lg px-3 py-2 text-sm border ${isDark ? 'bg-[#252525] border-[#3e3e3e] text-white' : 'bg-white border-gray-200'} focus:outline-none focus:border-purple-500`}
            />
          </div>
          <div>
            <label className={`text-xs ${subtle}`}>Notes (optional)</label>
            <input
              type="text" value={newNotes}
              onChange={(e) => setNewNotes(e.target.value)}
              placeholder="e.g. morning, post workout"
              className={`w-full mt-1 rounded-lg px-3 py-2 text-sm border ${isDark ? 'bg-[#252525] border-[#3e3e3e] text-white' : 'bg-white border-gray-200'} focus:outline-none focus:border-purple-500`}
            />
          </div>
          <button
            onClick={handleAddEntry}
            disabled={!newWeight.trim()}
            className="w-full bg-purple-600 hover:bg-purple-500 disabled:bg-purple-800 disabled:opacity-50 text-white font-medium py-2 rounded-lg transition-colors"
          >
            Log weight
          </button>
        </div>
      )}

      {/* Chart */}
      {entries.length >= 2 && (
        <div className={`rounded-xl border p-4 ${cardBg} ${cardBorder}`}>
          <div className="text-xs font-semibold uppercase tracking-wider mb-3">
            <span className={subtle}>Trend (last 30 entries)</span>
          </div>
          <BodyWeightChart entries={entries.slice(0, 30)} isDark={isDark} />
        </div>
      )}

      {/* History */}
      {entries.length > 0 && (
        <div>
          <div className={`text-xs font-semibold uppercase tracking-wider mb-2 ${subtle}`}>
            History ({entries.length})
          </div>
          <div className={`rounded-xl border divide-y ${cardBg} ${cardBorder} ${isDark ? 'divide-[#2e2e2e]' : 'divide-gray-200'}`}>
            {entries.map((entry, i) => {
              const prev = entries[i + 1];
              const change = prev ? entry.weight - prev.weight : null;
              return (
                <div key={entry.id} className="flex items-center justify-between p-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{entry.weight} kg</span>
                      {change !== null && (
                        <span className={`text-xs ${change < 0 ? 'text-green-400' : change > 0 ? 'text-red-400' : subtle}`}>
                          {change > 0 ? '+' : ''}{change.toFixed(1)}
                        </span>
                      )}
                    </div>
                    <div className={`text-xs ${subtle}`}>
                      {new Date(entry.date).toLocaleDateString()}{entry.notes && ` · ${entry.notes}`}
                    </div>
                  </div>
                  <button
                    onClick={() => handleDeleteEntry(entry.id)}
                    className={`p-1.5 rounded-lg transition-colors ${isDark ? 'text-zinc-500 hover:bg-red-500/15 hover:text-red-400' : 'text-gray-400 hover:bg-red-50 hover:text-red-600'}`}
                    title="Delete"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
