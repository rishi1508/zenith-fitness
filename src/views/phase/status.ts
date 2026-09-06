// Shared display bits for the phase view and card — docs/HEALTH_SPEC.md §5.
import type { GoalStatus } from '../../phase';
import type { PhaseGoal } from '../../types';
import type { PillTone } from '../../ui';

export const STATUS_LABEL: Record<GoalStatus, string> = {
  'on-track': 'On track',
  'too-fast': 'Too fast',
  'too-slow': 'Too slow',
  stalled: 'Stalled',
  insufficient: 'Need more data',
};

export const STATUS_TONE: Record<GoalStatus, PillTone> = {
  'on-track': 'ok',
  'too-fast': 'danger',
  'too-slow': 'warn',
  stalled: 'warn',
  insufficient: 'neutral',
};

export const GOAL_LABEL: Record<PhaseGoal, string> = { cut: 'Cut', maintain: 'Maintain', bulk: 'Bulk' };

/** Signed number with a real minus sign: "−0.42", "+0.25". */
export function signed(value: number, digits = 2): string {
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value).toFixed(digits)}`;
}

/** "−0.42 kg · −0.54 %" per week, or "—" when the trend is unreadable. */
export function rateBadge(rateKgPerWeek: number, ratePctPerWeek: number): string {
  return `${signed(rateKgPerWeek)} kg · ${signed(ratePctPerWeek)} %`;
}
