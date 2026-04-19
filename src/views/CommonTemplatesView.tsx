import { useState, useEffect, useMemo } from 'react';
import {
  ArrowLeft, Search, Loader2, Calendar, Dumbbell, User, Upload, Check, Plus,
} from 'lucide-react';
import type { WeeklyPlan, WorkoutTemplate } from '../types';
import * as storage from '../storage';
import * as sharedTemplates from '../sharedTemplatesService';
import type { SharedTemplate } from '../sharedTemplatesService';

interface CommonTemplatesViewProps {
  isDark: boolean;
  onBack: () => void;
}

export function CommonTemplatesView({ isDark, onBack }: CommonTemplatesViewProps) {
  const [list, setList] = useState<SharedTemplate[] | null>(null);
  const [search, setSearch] = useState('');
  const [importing, setImporting] = useState<string | null>(null);
  const [imported, setImported] = useState<Set<string>>(new Set());
  const [showPublish, setShowPublish] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState<string>('');

  const cardBg = isDark ? 'bg-[#1a1a1a]' : 'bg-white';
  const cardBorder = isDark ? 'border-[#2e2e2e]' : 'border-gray-200';
  const subtle = isDark ? 'text-zinc-500' : 'text-gray-500';

  useEffect(() => {
    (async () => {
      const result = await sharedTemplates.listSharedTemplates();
      setList(result);
    })();
  }, []);

  const filtered = useMemo(() => {
    if (!list) return null;
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.creatorName.toLowerCase().includes(q),
    );
  }, [list, search]);

  const handleImport = async (tpl: SharedTemplate) => {
    setImporting(tpl.id);
    try {
      if (tpl.type === 'weekly-plan') {
        const plan = tpl.payload as WeeklyPlan;
        const newPlan: WeeklyPlan = {
          ...plan,
          id: crypto.randomUUID(),
          name: `${plan.name} (from ${tpl.creatorName})`,
        };
        const existing = storage.getWeeklyPlans();
        storage.saveWeeklyPlans([...existing, newPlan]);
      } else {
        const t = tpl.payload as WorkoutTemplate;
        storage.saveTemplate({ ...t, id: crypto.randomUUID(), name: `${t.name} (from ${tpl.creatorName})` });
      }
      setImported((prev) => new Set(prev).add(tpl.id));
      sharedTemplates.bumpUseCount(tpl.id);
    } catch (err) {
      alert('Import failed: ' + (err instanceof Error ? err.message : 'unknown'));
    } finally {
      setImporting(null);
    }
  };

  const myPlans = storage.getWeeklyPlans();

  const handlePublish = async () => {
    if (!selectedPlanId) return;
    const plan = myPlans.find((p) => p.id === selectedPlanId);
    if (!plan) return;
    setPublishing(true);
    try {
      await sharedTemplates.publishSharedTemplate(plan.name, 'weekly-plan', plan);
      const result = await sharedTemplates.listSharedTemplates();
      setList(result);
      setShowPublish(false);
      setSelectedPlanId('');
    } catch (err) {
      alert('Publish failed: ' + (err instanceof Error ? err.message : 'unknown'));
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="space-y-4 animate-fadeIn">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className={`p-2 rounded-lg transition-colors ${isDark ? 'hover:bg-[#222]' : 'hover:bg-gray-50'}`}>
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-xl font-bold">Common Templates</h1>
        </div>
        <button
          onClick={() => setShowPublish(!showPublish)}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-500 text-white hover:bg-emerald-600 transition-colors"
        >
          <Upload className="w-3.5 h-3.5" /> Publish
        </button>
      </div>

      {/* Search */}
      <div className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border ${cardBg} ${cardBorder}`}>
        <Search className={`w-4 h-4 ${subtle}`} />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by template or creator name..."
          className={`flex-1 bg-transparent outline-none text-sm ${isDark ? 'placeholder-zinc-600' : 'placeholder-gray-400'}`}
        />
      </div>

      {/* Publish panel */}
      {showPublish && (
        <div className={`rounded-xl border p-4 space-y-3 ${cardBg} ${cardBorder}`}>
          <div className="text-sm font-medium">Publish one of your weekly plans</div>
          {myPlans.length === 0 ? (
            <p className={`text-sm ${subtle}`}>You haven't created any weekly plans yet.</p>
          ) : (
            <>
              <select
                value={selectedPlanId}
                onChange={(e) => setSelectedPlanId(e.target.value)}
                className={`w-full rounded-lg px-3 py-2 text-sm border ${isDark ? 'bg-[#252525] border-[#3e3e3e] text-white' : 'bg-white border-gray-200'} focus:outline-none focus:border-emerald-500`}
              >
                <option value="">Select a plan…</option>
                {myPlans.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <button
                onClick={handlePublish}
                disabled={!selectedPlanId || publishing}
                className="w-full bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white font-medium py-2 rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                {publishing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                Publish to community
              </button>
            </>
          )}
        </div>
      )}

      {/* List */}
      {list === null ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-orange-400" />
        </div>
      ) : filtered!.length === 0 ? (
        <div className={`rounded-xl border p-6 text-center ${cardBg} ${cardBorder}`}>
          <Dumbbell className={`w-10 h-10 mx-auto mb-2 ${subtle}`} />
          <p className={`text-sm ${subtle}`}>
            {search.trim() ? 'No templates match your search.' : 'No common templates yet — be the first to publish one!'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered!.map((tpl) => {
            const isImported = imported.has(tpl.id);
            const isImporting = importing === tpl.id;
            const exerciseCount = tpl.type === 'weekly-plan'
              ? (tpl.payload as WeeklyPlan).days.reduce((sum, d) => sum + (d.isRestDay ? 0 : d.exercises.length), 0)
              : (tpl.payload as WorkoutTemplate).exercises?.length || 0;
            return (
              <div key={tpl.id} className={`rounded-xl border p-3 ${cardBg} ${cardBorder}`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${isDark ? 'bg-emerald-500/15 text-emerald-400' : 'bg-emerald-100 text-emerald-600'}`}>
                      {tpl.type === 'weekly-plan' ? <Calendar className="w-5 h-5" /> : <Dumbbell className="w-5 h-5" />}
                    </div>
                    <div className="min-w-0">
                      <div className="font-medium text-sm truncate">{tpl.name}</div>
                      <div className={`text-xs flex items-center gap-2 ${subtle}`}>
                        <User className="w-3 h-3" /> {tpl.creatorName}
                        <span>·</span>
                        <span>{exerciseCount} exercises</span>
                        {tpl.useCount > 0 && <><span>·</span><span>{tpl.useCount} imported</span></>}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => handleImport(tpl)}
                    disabled={isImported || isImporting}
                    className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex-shrink-0 ${
                      isImported
                        ? 'bg-emerald-500/20 text-emerald-400'
                        : 'bg-gradient-to-r from-orange-500 to-red-600 text-white hover:opacity-90 disabled:opacity-50'
                    }`}
                  >
                    {isImported ? (
                      <><Check className="w-3.5 h-3.5" /> Added</>
                    ) : isImporting ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <><Plus className="w-3.5 h-3.5" /> Add</>
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
