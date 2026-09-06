import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, Dumbbell, HeartPulse, Pencil, RefreshCw, ShieldCheck } from 'lucide-react';
import type { ActivityDay } from '../../types';
import { addDaysISO, fetchActivityRange, getActivityDay, listActivityDays, localDateISO, saveActivityDay, subscribeHealth } from '../../health/store';
import {
  formatSleep, getPermissionState, lastSyncedAt, openSettings, requestPermissions, syncRecentDays, type PermissionState,
} from '../../activity';
import { Button, Card, EmptyState, IconButton, SectionHeader, Sheet, StatTile, CAPTION, H2, SUB } from '../../ui';

interface ActivityViewProps {
  onBack: () => void;
}

const WINDOW_DAYS = 7;
const SYNC_INTERVAL_MS = 15 * 60 * 1000;

function dayLabel(date: string): string {
  const today = localDateISO();
  if (date === today) return 'Today';
  if (date === addDaysISO(today, -1)) return 'Yesterday';
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}

function shortDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { weekday: 'narrow' });
}

function sourceLabel(source: ActivityDay['source']): string {
  if (source === 'manual') return 'Entered by hand';
  if (source === 'mixed') return 'Health Connect + manual';
  return 'From Health Connect';
}

function syncedLabel(iso: string | null): string {
  if (!iso) return 'Never synced';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'Synced just now';
  if (mins < 60) return `Synced ${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `Synced ${hours}h ago`;
  return `Synced ${new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`;
}

/** "strengthTraining" → "Strength training". */
function sessionLabel(type: string): string {
  return type.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
}

/** Activity + Health Connect — docs/HEALTH_SPEC.md §4. */
export function ActivityView({ onBack }: ActivityViewProps) {
  const today = localDateISO();
  const [date, setDate] = useState(today);
  const [, bumpVersion] = useState(0);
  const [permission, setPermission] = useState<PermissionState | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [synced, setSynced] = useState(() => lastSyncedAt());
  const [editing, setEditing] = useState(false);

  useEffect(() => subscribeHealth(() => bumpVersion((n) => n + 1)), []);

  const day = getActivityDay(date);
  const from = addDaysISO(today, -(WINDOW_DAYS - 1));
  const cached = new Map(listActivityDays(from, today).map((d) => [d.date, d]));
  const week = Array.from({ length: WINDOW_DAYS }, (_, i) => addDaysISO(from, i)).map((d) => cached.get(d) ?? null);

  const runSync = useCallback(async () => {
    setSyncing(true);
    try {
      await syncRecentDays(WINDOW_DAYS);
    } finally {
      setSynced(lastSyncedAt());
      setSyncing(false);
    }
  }, []);

  // One range read when the view opens, then sync at most once every 15 minutes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await fetchActivityRange(addDaysISO(today, -(WINDOW_DAYS - 1)), today);
      if (cancelled) return;
      const state = await getPermissionState();
      if (cancelled) return;
      setPermission(state);
      if (state !== 'granted' && state !== 'partial') return;
      const last = lastSyncedAt();
      if (!last || Date.now() - new Date(last).getTime() > SYNC_INTERVAL_MS) await runSync();
    })();
    return () => { cancelled = true; };
  }, [today, runSync]);

  const connect = async () => {
    const state = await requestPermissions();
    setPermission(state);
    if (state === 'granted' || state === 'partial') await runSync();
  };

  const maxSteps = Math.max(1, ...week.map((d) => d?.steps ?? 0));
  const sessions = day.sessions ?? [];
  const connected = permission === 'granted' || permission === 'partial';

  return (
    <div className="space-y-4 animate-fadeIn">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <IconButton icon={ArrowLeft} label="Back" onClick={onBack} />
          <h1 className={H2}>Activity</h1>
        </div>
        {connected && (
          <Button variant="secondary" size="sm" icon={RefreshCw} loading={syncing} onClick={runSync}>Sync now</Button>
        )}
      </div>

      {permission !== null && !connected && <ConnectCard state={permission} onConnect={connect} />}

      <div className="flex items-center justify-between gap-2">
        <IconButton icon={ChevronLeft} label="Previous day" size="sm" onClick={() => setDate(addDaysISO(date, -1))} />
        <span className="text-sm font-bold text-text">{dayLabel(date)}</span>
        <IconButton icon={ChevronRight} label="Next day" size="sm" disabled={date >= today} onClick={() => setDate(addDaysISO(date, 1))} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <StatTile eyebrow="Steps" tone="accent" value={day.steps?.toLocaleString('en-IN') ?? '—'} sub={sourceLabel(day.source)} />
        <StatTile
          eyebrow="Active"
          value={day.activeKcal ?? '—'}
          unit={day.activeKcal !== undefined ? 'kcal' : undefined}
          sub={day.totalKcal !== undefined ? `${day.totalKcal} kcal total` : 'Energy burned'}
        />
        <StatTile eyebrow="Sleep" value={day.sleepMin !== undefined ? formatSleep(day.sleepMin) : '—'} sub="Time in bed" />
        <StatTile
          eyebrow="Resting HR"
          value={day.restingHr ?? '—'}
          unit={day.restingHr !== undefined ? 'bpm' : undefined}
          sub={day.avgHr !== undefined ? `${day.avgHr} bpm average` : 'Beats per minute'}
        />
      </div>

      <Card>
        <div className="flex items-baseline justify-between mb-3">
          <span className={CAPTION}>Steps · last 7 days</span>
          <span className="text-xs text-muted">{maxSteps > 1 ? `peak ${maxSteps.toLocaleString('en-IN')}` : 'No data yet'}</span>
        </div>
        <div className="flex items-end gap-1.5 h-24">
          {week.map((d, i) => {
            const dISO = addDaysISO(from, i);
            const steps = d?.steps ?? 0;
            return (
              <button
                key={dISO}
                onClick={() => setDate(dISO)}
                title={`${dayLabel(dISO)} — ${steps.toLocaleString('en-IN')} steps`}
                className="flex-1 h-full flex flex-col justify-end group"
              >
                <span
                  className={`w-full rounded-t-sm transition-colors ${dISO === date ? 'bg-accent' : 'bg-accent/35 group-hover:bg-accent/60'}`}
                  style={{ height: `${steps ? Math.max((steps / maxSteps) * 100, 4) : 2}%` }}
                />
              </button>
            );
          })}
        </div>
        <div className="flex gap-1.5 mt-1.5">
          {week.map((_, i) => {
            const dISO = addDaysISO(from, i);
            return (
              <span key={dISO} className={`flex-1 text-center text-[10px] ${dISO === date ? 'text-accent font-bold' : 'text-subtle'}`}>
                {shortDay(dISO)}
              </span>
            );
          })}
        </div>
      </Card>

      <div className="space-y-2.5">
        <SectionHeader caption={`Sessions · ${dayLabel(date)}`} />
        {sessions.length === 0 ? (
          <EmptyState icon={Dumbbell} title="No sessions" body="Workouts you finish in Zenith, plus anything Health Connect recorded, land here." />
        ) : (
          <Card padding="list">
            {sessions.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-text truncate">{sessionLabel(s.type)}</div>
                  <div className={SUB}>
                    {new Date(s.startAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })} · {s.durationMin} min
                    {s.kcal !== undefined && ` · ${s.kcal} kcal`}
                  </div>
                </div>
                <span className="text-[11px] text-subtle shrink-0">{s.source === 'health-connect' ? 'Health Connect' : 'Zenith'}</span>
              </div>
            ))}
          </Card>
        )}
      </div>

      <Button variant="secondary" size="md" icon={Pencil} full onClick={() => setEditing(true)}>Enter manually</Button>

      <p className="text-[11px] text-center text-subtle">
        {connected ? syncedLabel(synced) : 'Health Connect not connected — days you enter by hand are kept as-is.'}
      </p>

      {editing && <ManualEntrySheet day={day} onClose={() => setEditing(false)} />}
    </div>
  );
}

function ConnectCard({ state, onConnect }: { state: PermissionState; onConnect: () => void }) {
  if (state === 'unavailable') {
    return (
      <Card tone="info">
        <div className="flex items-center gap-2 mb-1">
          <ShieldCheck className="w-4 h-4 text-info" strokeWidth={1.75} />
          <span className={CAPTION}>Manual mode</span>
        </div>
        <p className={SUB}>
          Health Connect needs the Android app with Health Connect installed. Steps, sleep and calories can still be
          entered by hand.
        </p>
      </Card>
    );
  }

  return (
    <Card tone="accent">
      <div className="flex items-center gap-2 mb-1">
        <HeartPulse className="w-4 h-4 text-accent" strokeWidth={1.75} />
        <span className={CAPTION}>Connect Health Connect</span>
      </div>
      <p className={`${SUB} mb-3`}>
        Zenith reads your steps, active and total calories, heart rate, resting heart rate, sleep and workout sessions.
        It stays on your phone and in your own Zenith account — nothing is sold or shared.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="md" onClick={onConnect}>{state === 'partial' ? 'Grant the rest' : 'Connect'}</Button>
        <Button variant="secondary" size="md" onClick={openSettings}>Health Connect settings</Button>
      </div>
    </Card>
  );
}

/** Mounted only while open, so the fields seed from the day once. */
function ManualEntrySheet({ day, onClose }: { day: ActivityDay; onClose: () => void }) {
  const [steps, setSteps] = useState(day.steps !== undefined ? String(day.steps) : '');
  const [sleepMin, setSleepMin] = useState(day.sleepMin !== undefined ? String(day.sleepMin) : '');
  const [activeKcal, setActiveKcal] = useState(day.activeKcal !== undefined ? String(day.activeKcal) : '');

  const save = () => {
    const next: ActivityDay = { ...day, source: day.source === 'manual' ? 'manual' : 'mixed' };
    const put = (raw: string, key: 'steps' | 'sleepMin' | 'activeKcal') => {
      const n = Number(raw);
      if (raw.trim() !== '' && Number.isFinite(n) && n >= 0) next[key] = Math.round(n);
    };
    put(steps, 'steps');
    put(sleepMin, 'sleepMin');
    put(activeKcal, 'activeKcal');
    saveActivityDay(next);
    onClose();
  };

  return (
    <Sheet open onClose={onClose} title={`Log activity · ${dayLabel(day.date)}`}>
      <NumberField label="Steps" value={steps} onChange={setSteps} placeholder="e.g. 8500" />
      <NumberField label="Sleep (minutes)" value={sleepMin} onChange={setSleepMin} placeholder="e.g. 430" />
      <NumberField label="Active calories (kcal)" value={activeKcal} onChange={setActiveKcal} placeholder="e.g. 480" />
      <Button size="lg" full onClick={save}>Save</Button>
    </Sheet>
  );
}

function NumberField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className={CAPTION}>{label}</span>
      <input
        type="number"
        inputMode="numeric"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 px-3 rounded-control bg-surface-2 border border-border text-text text-sm focus:outline-none focus:border-accent"
      />
    </label>
  );
}
