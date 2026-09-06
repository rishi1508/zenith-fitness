import { useCallback, useEffect, useState } from 'react';
import type { ChartSettings } from '../types';
import { getAppSettings, updateAppSettings } from '../storage';
import { MA_WINDOW_MAX, MA_WINDOW_MIN, clamp } from './chartMath';

export type SeriesKey = 'showMovingAverage' | 'showRawPoints';

/** Same-window broadcast so every mounted chart re-reads after a write.
 *  (`zenith-data-refresh` covers changes that arrive via sync.) */
const CHANGE_EVENT = 'zenith-chart-settings';

function readSettings(): ChartSettings {
  const s = getAppSettings().chart;
  return {
    showMovingAverage: s.showMovingAverage,
    // Never both off — fall back to the raw series.
    showRawPoints: s.showRawPoints || !s.showMovingAverage,
    movingAverageWindow: clamp(Math.round(s.movingAverageWindow) || 5, MA_WINDOW_MIN, MA_WINDOW_MAX),
  };
}

/** Global chart preferences (MA on/off, raw points on/off, MA window),
 *  persisted via AppSettings and shared by every chart in the app. */
export function useChartSettings() {
  const [settings, setSettings] = useState<ChartSettings>(readSettings);

  useEffect(() => {
    const reload = () => setSettings(readSettings());
    window.addEventListener('zenith-data-refresh', reload);
    window.addEventListener(CHANGE_EVENT, reload);
    return () => {
      window.removeEventListener('zenith-data-refresh', reload);
      window.removeEventListener(CHANGE_EVENT, reload);
    };
  }, []);

  const update = useCallback((patch: Partial<ChartSettings>) => {
    updateAppSettings('chart', patch);
    setSettings(readSettings());
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  const toggleSeries = useCallback((key: SeriesKey) => {
    const cur = readSettings();
    const other: SeriesKey = key === 'showMovingAverage' ? 'showRawPoints' : 'showMovingAverage';
    const patch: Partial<ChartSettings> = {};
    patch[key] = !cur[key];
    // Turning off the last visible series turns the other one back on.
    if (!patch[key] && !cur[other]) patch[other] = true;
    update(patch);
  }, [update]);

  const setWindow = useCallback((window: number) => {
    update({ movingAverageWindow: clamp(Math.round(window), MA_WINDOW_MIN, MA_WINDOW_MAX) });
  }, [update]);

  return { settings, toggleSeries, setWindow };
}
