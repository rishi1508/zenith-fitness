import { useState } from 'react';
import type { FoodItem } from '../../types';
import { FoodForm } from './FoodForm';
import type { FoodFormValues } from './FoodForm';
import { Sheet } from '../../ui';

/**
 * Correcting a food, shared by the add-food screen and the diary — a wrong
 * figure is most often noticed in the diary, hours after it was logged, so
 * both places need the same sheet.
 */

export function FoodSheet({ title, submitLabel, initial, createdBy, onClose, onSubmit }: {
  title: string;
  submitLabel: string;
  initial?: FoodItem;
  createdBy?: string;
  onClose: () => void;
  onSubmit: (values: FoodFormValues) => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Sheet open onClose={onClose} title={title}>
      {!createdBy && <p className="text-xs text-danger">Sign in to add or edit a food.</p>}
      <FoodForm
        initial={initial}
        submitLabel={submitLabel}
        busy={busy || !createdBy}
        onSubmit={(values) => {
          if (busy || !createdBy) return;
          setBusy(true);
          onSubmit(values);
        }}
      />
    </Sheet>
  );
}
