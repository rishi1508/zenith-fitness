/**
 * Utility functions for Zenith Fitness
 */

// Format volume: 1500 -> 1.5k, 1500000 -> 1.5t
export function formatVolume(volume: number): string {
  if (volume >= 1000000) return (volume / 1000000).toFixed(1) + 't';
  if (volume >= 1000) return (volume / 1000).toFixed(1) + 'k';
  return volume.toString();
}

// Calculate estimated 1RM using Epley formula
// 1RM = weight × (1 + reps / 30)
export function calculateEstimated1RM(weight: number, reps: number): number {
  if (reps === 1) return weight; // Already a 1RM
  if (reps === 0 || weight === 0) return 0;
  return Math.round(weight * (1 + reps / 30));
}
