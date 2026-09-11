import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { GymEquipment } from '../../../types';
import { deleteEquipment, saveEquipment, setEquipmentStatus } from '../../../gymService';
import { Button, Card, Sheet, useConfirm, useToast } from '../../../ui';
import { H2, SUB } from '../../../ui/styles';

/** "2h 30m" / "45m" / "none" — downtime an owner can read at a glance. */
function downtimeLabel(min: number): string {
  const rounded = Math.round(min);
  if (rounded <= 0) return 'no downtime';
  const hours = Math.floor(rounded / 60);
  const mins = rounded % 60;
  if (hours === 0) return `${mins}m down`;
  return mins === 0 ? `${hours}h down` : `${hours}h ${mins}m down`;
}

/**
 * The machines on the floor and whether they are usable. Flipping a
 * machine down stamps the time; flipping it back banks the minutes it
 * was out, which is all the asset-health figure needs — no outage log,
 * no extra reads.
 */
export function EquipmentSection({
  gymId,
  equipment,
  canEdit,
  onChange,
}: {
  gymId: string;
  equipment: GymEquipment[];
  canEdit: boolean;
  onChange: (next: GymEquipment[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { showToast } = useToast();
  const { confirm } = useConfirm();

  const handleAdd = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      const machine = await saveEquipment(gymId, { name: trimmed });
      onChange([...equipment, machine].sort((a, b) => a.name.localeCompare(b.name)));
      setName('');
      setAdding(false);
      showToast(`${machine.name} added`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not add the machine', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleStatus = async (machine: GymEquipment, status: 'ok' | 'down') => {
    if (machine.status === status) return;
    setBusyId(machine.id);
    try {
      const next = await setEquipmentStatus(gymId, machine, status);
      onChange(equipment.map((e) => (e.id === next.id ? next : e)));
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not update the machine', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (machine: GymEquipment) => {
    const ok = await confirm({
      title: 'Remove machine?',
      message: `${machine.name} and its downtime record will be removed from asset health.`,
      confirmLabel: 'Remove',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await deleteEquipment(gymId, machine.id);
      onChange(equipment.filter((e) => e.id !== machine.id));
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not remove the machine', 'error');
    }
  };

  return (
    <Card>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h2 className={H2}>Equipment</h2>
          <p className={SUB}>Mark a machine down and its downtime counts against uptime</p>
        </div>
        {canEdit && (
          <Button size="sm" variant="secondary" icon={Plus} onClick={() => setAdding(true)} className="shrink-0">
            Add
          </Button>
        )}
      </div>

      {equipment.length === 0 ? (
        <p className="text-sm text-muted py-2">Add your machines to start tracking uptime.</p>
      ) : (
        <div className="divide-y divide-border">
          {equipment.map((machine) => (
            <div key={machine.id} className="flex items-center gap-2 py-2">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-text truncate">{machine.name}</div>
                <div className={`text-xs ${machine.status === 'down' ? 'text-danger' : 'text-muted'}`}>
                  {machine.status === 'down' ? 'Out of service' : downtimeLabel(machine.downtimeMin)}
                </div>
              </div>

              <div role="group" aria-label={`${machine.name} status`} className="flex rounded-control border border-border overflow-hidden shrink-0">
                {(['ok', 'down'] as const).map((status) => (
                  <button
                    key={status}
                    type="button"
                    disabled={!canEdit || busyId === machine.id}
                    aria-pressed={machine.status === status}
                    onClick={() => handleStatus(machine, status)}
                    className={`w-[52px] h-10 text-[13px] font-bold transition-colors disabled:opacity-60 ${
                      machine.status === status
                        ? status === 'ok' ? 'bg-ok/15 text-ok' : 'bg-danger/15 text-danger'
                        : 'text-subtle hover:text-text'
                    }`}
                  >
                    {status === 'ok' ? 'Up' : 'Down'}
                  </button>
                ))}
              </div>

              {canEdit && (
                <button
                  type="button"
                  aria-label={`Remove ${machine.name}`}
                  onClick={() => handleDelete(machine)}
                  className="w-10 h-10 shrink-0 flex items-center justify-center rounded-control text-subtle hover:text-danger transition-colors"
                >
                  <Trash2 className="w-4 h-4" strokeWidth={1.75} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <Sheet open={adding} onClose={() => setAdding(false)} title="Add machine">
        <input
          type="text"
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void handleAdd(); }}
          placeholder="Leg press"
          className="w-full h-11 rounded-control px-3 text-sm bg-surface-2 border border-border text-text placeholder:text-subtle focus:outline-none focus:border-accent"
        />
        <Button full size="lg" loading={saving} onClick={handleAdd} disabled={!name.trim()}>
          Add machine
        </Button>
      </Sheet>
    </Card>
  );
}
