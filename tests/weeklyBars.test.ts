import { describe, it, expect } from 'vitest';
import type { NutritionDay } from '../src/types';
import { weeklySeries } from '../src/views/nutrition/nutritionHelpers';

function day(over: Partial<NutritionDay> = {}): NutritionDay {
  return { date: '2026-09-01', entries: [], waterMl: 0, updatedAt: '2026-09-01T07:00:00.000Z', ...over };
}

describe('weeklySeries', () => {
  it('zero-fills any day missing from the cache', () => {
    const days = [day({ date: '2026-09-05', waterMl: 500 }), day({ date: '2026-09-07', waterMl: 750 })];
    const { days: points } = weeklySeries(days, '2026-09-01', '2026-09-07', (d) => d.waterMl, 0);
    expect(points.map((p) => p.date)).toEqual([
      '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06', '2026-09-07',
    ]);
    expect(points.map((p) => p.value)).toEqual([0, 0, 0, 0, 500, 0, 750]);
  });

  it('counts logged days that reached the target', () => {
    const days = [
      day({ date: '2026-09-05', waterMl: 500 }), // logged, under target
      day({ date: '2026-09-06', waterMl: 1000 }), // logged, met target
      day({ date: '2026-09-07', waterMl: 0 }), // not logged
    ];
    const { onTarget, logged } = weeklySeries(days, '2026-09-01', '2026-09-07', (d) => d.waterMl, 1000);
    expect(logged).toBe(2);
    expect(onTarget).toBe(1);
  });

  it('reports nothing logged when the whole week is empty', () => {
    const { onTarget, logged } = weeklySeries([], '2026-09-01', '2026-09-07', (d) => d.waterMl, 1000);
    expect(logged).toBe(0);
    expect(onTarget).toBe(0);
  });
});
