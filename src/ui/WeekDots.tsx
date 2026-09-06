export type WeekDotState = 'on' | 'rest' | 'today' | 'off';

interface WeekDotsProps {
  /** Seven states, Sunday first. `today` is the outlined "not yet" cell;
   *  a day already trained today should be passed as `on`. */
  days: WeekDotState[];
  labels?: string[];
}

const DEFAULT_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const STATE: Record<WeekDotState, string> = {
  on: 'bg-accent text-white',
  rest: 'bg-transparent border border-dashed border-border text-subtle',
  today: 'bg-surface-2 text-text outline outline-2 -outline-offset-2 outline-accent',
  off: 'bg-surface-2 text-subtle',
};

const TITLE: Record<WeekDotState, string> = {
  on: 'Trained', rest: 'Rest day', today: 'Today', off: 'No workout',
};

/** Seven 34px day cells for the "This week" card. Purely presentational. */
export function WeekDots({ days, labels = DEFAULT_LABELS }: WeekDotsProps) {
  return (
    <div className="flex gap-1.5" role="list" aria-label="This week">
      {days.map((state, i) => (
        <span
          key={i}
          role="listitem"
          title={TITLE[state]}
          className={`w-[34px] h-[34px] rounded-[10px] flex items-center justify-center text-xs font-bold ${STATE[state]}`}
        >
          {labels[i]}
        </span>
      ))}
    </div>
  );
}
