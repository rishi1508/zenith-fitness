import { useState } from 'react';
import { ArrowLeft, Ruler, Plus, Trash2 } from 'lucide-react';
import type { BodyMeasurementEntry, BodyMeasurementField } from '../types';
import * as storage from '../storage';

interface Props {
  isDark: boolean;
  onBack: () => void;
}

// Human-readable labels for the schema's BodyMeasurementField union.
const FIELDS: Array<{ key: BodyMeasurementField; label: string }> = [
  { key: 'chest', label: 'Chest' },
  { key: 'shoulders', label: 'Shoulders' },
  { key: 'waist', label: 'Waist' },
  { key: 'hips', label: 'Hips' },
  { key: 'neck', label: 'Neck' },
  { key: 'leftArm', label: 'Left arm' },
  { key: 'rightArm', label: 'Right arm' },
  { key: 'leftThigh', label: 'Left thigh' },
  { key: 'rightThigh', label: 'Right thigh' },
  { key: 'leftCalf', label: 'Left calf' },
  { key: 'rightCalf', label: 'Right calf' },
];

/**
 * Minimalist measurements tracker. Users enter whichever body-part
 * circumferences they want, in cm. History is shown below with a delta
 * vs. the previous entry for each field.
 */
export function BodyMeasurementsView({ isDark, onBack }: Props) {
  const [entries, setEntries] = useState<BodyMeasurementEntry[]>(() => storage.getBodyMeasurements());
  const [form, setForm] = useState<Partial<Record<BodyMeasurementField, string>>>({});
  const [notes, setNotes] = useState('');
  const [adding, setAdding] = useState(false);

  const cardBg = isDark ? 'bg-[#1a1a1a]' : 'bg-white';
  const cardBorder = isDark ? 'border-[#2e2e2e]' : 'border-gray-200';
  const subtle = isDark ? 'text-zinc-500' : 'text-gray-500';

  const handleAdd = () => {
    const parsed: Partial<Record<BodyMeasurementField, number>> = {};
    for (const [k, v] of Object.entries(form)) {
      if (!v) continue;
      const n = parseFloat(v);
      if (!isNaN(n) && n > 0) parsed[k as BodyMeasurementField] = n;
    }
    if (Object.keys(parsed).length === 0) {
      alert('Enter at least one measurement.');
      return;
    }
    storage.addBodyMeasurementEntry(parsed, notes.trim() || undefined);
    setEntries(storage.getBodyMeasurements());
    setForm({});
    setNotes('');
    setAdding(false);
  };

  const handleDelete = (id: string) => {
    if (!confirm('Delete this entry?')) return;
    storage.deleteBodyMeasurementEntry(id);
    setEntries(storage.getBodyMeasurements());
  };

  return (
    <div className="space-y-4 animate-fadeIn">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={onBack} className={`p-2 rounded-lg transition-colors ${isDark ? 'hover:bg-[#222]' : 'hover:bg-gray-50'}`}>
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center">
            <Ruler className="w-4 h-4 text-blue-400" />
          </div>
          <h1 className="text-xl font-bold">Body Measurements</h1>
        </div>
      </div>

      {/* Quick add toggle */}
      {!adding && (
        <button
          onClick={() => setAdding(true)}
          className="w-full py-3 rounded-xl font-medium text-sm bg-gradient-to-r from-orange-500 to-red-600 text-white hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
        >
          <Plus className="w-4 h-4" /> Log measurements
        </button>
      )}

      {adding && (
        <div className={`rounded-xl border p-4 space-y-3 ${cardBg} ${cardBorder}`}>
          <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            New entry (cm)
          </div>
          <div className="grid grid-cols-2 gap-2">
            {FIELDS.map((f) => (
              <label key={f.key} className="flex flex-col gap-1">
                <span className={`text-[11px] ${subtle}`}>{f.label}</span>
                <input
                  type="number"
                  step="0.1"
                  inputMode="decimal"
                  value={form[f.key] ?? ''}
                  onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
                  placeholder="—"
                  className={`w-full rounded-lg px-3 py-2 text-sm border ${
                    isDark ? 'bg-[#252525] border-[#3e3e3e] text-white' : 'bg-white border-gray-200'
                  } focus:outline-none focus:border-orange-500`}
                />
              </label>
            ))}
          </div>
          <div>
            <label className={`text-[11px] ${subtle}`}>Notes (optional)</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. fasted, post workout"
              className={`w-full mt-1 rounded-lg px-3 py-2 text-sm border ${
                isDark ? 'bg-[#252525] border-[#3e3e3e] text-white' : 'bg-white border-gray-200'
              } focus:outline-none focus:border-orange-500`}
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => { setAdding(false); setForm({}); setNotes(''); }}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                isDark ? 'bg-zinc-800 hover:bg-zinc-700' : 'bg-gray-100 hover:bg-gray-200'
              }`}
            >
              Cancel
            </button>
            <button
              onClick={handleAdd}
              className="flex-1 py-2 rounded-lg text-sm font-medium bg-gradient-to-r from-orange-500 to-red-600 text-white hover:opacity-90 transition-opacity"
            >
              Save
            </button>
          </div>
        </div>
      )}

      {/* History */}
      {entries.length === 0 ? (
        <div className={`rounded-xl border p-6 text-center ${cardBg} ${cardBorder}`}>
          <Ruler className={`w-10 h-10 mx-auto mb-2 ${subtle}`} />
          <p className={`text-sm ${subtle}`}>No measurements logged yet.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map((entry, i) => {
            const prev = entries[i + 1];
            return (
              <div key={entry.id} className={`rounded-xl border p-3 ${cardBg} ${cardBorder}`}>
                <div className="flex items-center justify-between mb-2">
                  <div className={`text-xs ${subtle}`}>
                    {new Date(entry.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                    {entry.notes && ` · ${entry.notes}`}
                  </div>
                  <button
                    onClick={() => handleDelete(entry.id)}
                    className={`p-1.5 rounded-md ${isDark ? 'text-zinc-500 hover:bg-red-500/15 hover:text-red-400' : 'text-gray-400 hover:bg-red-50 hover:text-red-600'}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  {FIELDS.filter((f) => entry.measurements[f.key] !== undefined).map((f) => {
                    const cur = entry.measurements[f.key]!;
                    const old = prev?.measurements[f.key];
                    const delta = old !== undefined ? cur - old : null;
                    return (
                      <div key={f.key} className="flex items-center justify-between">
                        <span className={subtle}>{f.label}</span>
                        <span className="font-medium">
                          {cur}
                          <span className={subtle}> cm</span>
                          {delta !== null && delta !== 0 && (
                            <span className={`ml-1 text-[11px] ${delta > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                              {delta > 0 ? '+' : ''}{delta.toFixed(1)}
                            </span>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
