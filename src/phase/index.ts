// Phase engine barrel — docs/HEALTH_SPEC.md §5.
export {
  weightTrend, classifyPhase, adaptiveMaintenance, evaluateGoal, weeksElapsed, plannedWeights, planDrift,
  MAINTAIN_BAND_PCT, MIN_TREND_POINTS, MIN_TREND_SPAN_DAYS,
} from './engine';
export type { TrendPoint, WeightTrend, MaintenanceEstimate, GoalStatus, GoalEvaluation } from './engine';
