import { describe, it, expect } from 'vitest';
import {
  haversineMeters, withinGeofence, formatDistance, positionFailureMessage, DEFAULT_GEOFENCE_M,
} from '../src/geo';

// A real gym-sized reference: Iron Temple's imagined front door in
// Bengaluru, plus points a known distance away.
const GYM = { lat: 12.9716, lng: 77.5946 };
/** One degree of latitude on the mean-radius sphere, metres. */
const DEG_LAT_M = 111_194.93;

describe('haversineMeters', () => {
  it('is zero for the same point', () => {
    expect(haversineMeters(GYM, { ...GYM })).toBe(0);
  });

  it('matches one degree of latitude', () => {
    const d = haversineMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
    expect(d).toBeCloseTo(DEG_LAT_M, 0);
  });

  it('matches one degree of longitude on the equator', () => {
    const d = haversineMeters({ lat: 0, lng: 0 }, { lat: 0, lng: 1 });
    expect(d).toBeCloseTo(DEG_LAT_M, 0);
  });

  it('shrinks longitude degrees away from the equator', () => {
    const atEquator = haversineMeters({ lat: 0, lng: 0 }, { lat: 0, lng: 1 });
    const at60 = haversineMeters({ lat: 60, lng: 0 }, { lat: 60, lng: 1 });
    expect(at60).toBeCloseTo(atEquator / 2, -1);
  });

  it('is symmetric', () => {
    const a = { lat: 12.9716, lng: 77.5946 };
    const b = { lat: 19.076, lng: 72.8777 };
    expect(haversineMeters(a, b)).toBeCloseTo(haversineMeters(b, a), 6);
  });

  it('gets Bengaluru → Mumbai right (~845 km)', () => {
    const d = haversineMeters({ lat: 12.9716, lng: 77.5946 }, { lat: 19.076, lng: 72.8777 });
    expect(d / 1000).toBeGreaterThan(830);
    expect(d / 1000).toBeLessThan(860);
  });

  it('handles the antimeridian', () => {
    const d = haversineMeters({ lat: 0, lng: 179.995 }, { lat: 0, lng: -179.995 });
    expect(d).toBeCloseTo(DEG_LAT_M * 0.01, 0);
  });
});

describe('withinGeofence', () => {
  const metresNorth = (m: number) => ({ lat: GYM.lat + m / DEG_LAT_M, lng: GYM.lng });

  it('accepts someone standing in the gym', () => {
    const r = withinGeofence(GYM, GYM, 100);
    expect(r.ok).toBe(true);
    expect(r.distanceM).toBe(0);
  });

  it('accepts just inside the radius', () => {
    const r = withinGeofence(metresNorth(90), GYM, 100);
    expect(r.ok).toBe(true);
    expect(r.distanceM).toBeCloseTo(90, 0);
  });

  it('rejects just outside the radius, and says how far', () => {
    const r = withinGeofence(metresNorth(150), GYM, 100);
    expect(r.ok).toBe(false);
    expect(r.distanceM).toBeCloseTo(150, 0);
  });

  it('rejects the scan-from-home case', () => {
    const r = withinGeofence(metresNorth(2400), GYM, 100);
    expect(r.ok).toBe(false);
    expect(formatDistance(r.distanceM)).toBe('2.4 km');
  });

  it('is inclusive at exactly the radius', () => {
    const point = metresNorth(100);
    const exact = haversineMeters(point, GYM);
    expect(withinGeofence(point, GYM, exact).ok).toBe(true);
    expect(withinGeofence(point, GYM, exact - 0.01).ok).toBe(false);
  });

  it('defaults to a 100 m radius', () => {
    expect(DEFAULT_GEOFENCE_M).toBe(100);
    expect(withinGeofence(metresNorth(80), GYM).ok).toBe(true);
    expect(withinGeofence(metresNorth(120), GYM).ok).toBe(false);
  });

  it('honours a wider radius for a big campus', () => {
    expect(withinGeofence(metresNorth(400), GYM, 500).ok).toBe(true);
  });
});

describe('formatDistance', () => {
  it('rounds metres to the nearest ten', () => {
    expect(formatDistance(0)).toBe('0 m');
    expect(formatDistance(84)).toBe('80 m');
    expect(formatDistance(146)).toBe('150 m');
    expect(formatDistance(949)).toBe('950 m');
  });

  it('switches to kilometres', () => {
    expect(formatDistance(950)).toBe('1.0 km');
    expect(formatDistance(2_400)).toBe('2.4 km');
    expect(formatDistance(845_000)).toBe('845.0 km');
  });

  it('degrades gracefully on nonsense', () => {
    expect(formatDistance(Number.NaN)).toBe('—');
    expect(formatDistance(-5)).toBe('—');
  });
});

describe('positionFailureMessage', () => {
  it('always points at the daily code as the way through', () => {
    for (const reason of ['unsupported', 'denied', 'unavailable', 'timeout'] as const) {
      expect(positionFailureMessage(reason)).toContain('6-digit code');
    }
  });

  it('names the actual problem', () => {
    expect(positionFailureMessage('denied')).toContain('blocked');
    expect(positionFailureMessage('timeout')).toContain('too long');
  });
});
