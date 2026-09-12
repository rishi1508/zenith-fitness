import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { listNutritionDays } from '../../health/store';
import { hapticImpact } from '../../haptics';
import { CAPTION, IconButton, Sheet, SUB } from '../../ui';
import {
  isDatePickable, monthDaysWithEntries, monthEnd, monthGrid, monthStart, monthTitle, shiftMonth,
} from './nutritionHelpers';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export interface DayPickerSheetProps {
  /** The day the diary is showing. */
  date: string;
  today: string;
  /** Account creation day — nothing before it can hold a diary entry. */
  minDate?: string;
  onPick: (date: string) => void;
  onClose: () => void;
}

/**
 * Month calendar behind the diary's date header. Days with food logged are
 * filled in the accent colour, the way the streak calendar marks a workout;
 * future days and days before the account existed are greyed out.
 *
 * The marks come from the local day cache only (`listNutritionDays`), so
 * flicking through months costs nothing — months older than the 90-day cache
 * simply show no marks.
 */
export function DayPickerSheet({ date, today, minDate, onPick, onClose }: DayPickerSheetProps) {
  const [month, setMonth] = useState(() => monthStart(date));

  const cells = useMemo(() => monthGrid(month), [month]);
  const logged = useMemo(
    () => monthDaysWithEntries(listNutritionDays(monthStart(month), monthEnd(month)), month),
    [month],
  );

  const canGoBack = !minDate || monthEnd(shiftMonth(month, -1)) >= minDate;
  const canGoForward = monthStart(shiftMonth(month, 1)) <= today;

  const pick = (day: string) => {
    void hapticImpact('light');
    onPick(day);
  };

  return (
    <Sheet open onClose={onClose} title="Pick a day">
      <div className="flex items-center justify-between gap-2">
        <IconButton
          icon={ChevronLeft} label="Previous month" size="sm"
          disabled={!canGoBack}
          className={canGoBack ? '' : 'opacity-40 pointer-events-none'}
          onClick={() => setMonth((m) => shiftMonth(m, -1))}
        />
        <span className="text-[15px] font-bold text-text">{monthTitle(month)}</span>
        <IconButton
          icon={ChevronRight} label="Next month" size="sm"
          disabled={!canGoForward}
          className={canGoForward ? '' : 'opacity-40 pointer-events-none'}
          onClick={() => setMonth((m) => shiftMonth(m, 1))}
        />
      </div>

      <div className="grid grid-cols-7 gap-1">
        {WEEKDAYS.map((d) => (
          <span key={d} className={`${CAPTION} text-center`}>{d.slice(0, 1)}</span>
        ))}
        {cells.map((day, i) => {
          if (!day) return <span key={`pad-${i}`} aria-hidden />;
          const pickable = isDatePickable(day, today, minDate);
          const selected = day === date;
          const filled = logged.has(day);
          return (
            <button
              key={day}
              disabled={!pickable}
              onClick={() => pick(day)}
              aria-current={selected ? 'date' : undefined}
              className={`h-10 rounded-full text-[13px] font-semibold tabular-nums transition-colors ${
                pickable ? '' : 'text-subtle opacity-40 pointer-events-none'
              } ${filled && pickable ? 'bg-accent text-white' : 'text-text'} ${
                selected ? 'ring-2 ring-accent ring-offset-2 ring-offset-surface' : ''
              }`}
            >
              {Number(day.slice(8))}
            </button>
          );
        })}
      </div>

      <p className={SUB}>Filled days have food logged.</p>
    </Sheet>
  );
}
