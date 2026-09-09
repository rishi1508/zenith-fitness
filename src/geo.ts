/**
 * Distance maths for the location-verified gym check-in.
 *
 * Everything above the "browser" divider is pure and unit-tested in
 * `tests/geo.test.ts`. The one impure export (`requestPosition`) is a
 * thin promise wrapper around `navigator.geolocation` kept here so the
 * check-in view doesn't have to hand-roll it; it touches `navigator`
 * only inside the function body, so importing this module in Node is
 * safe.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

/** Mean Earth radius (IUGG), metres. */
const EARTH_RADIUS_M = 6_371_008.8;

/** Default geofence radius for poster-QR check-ins, metres. */
export const DEFAULT_GEOFENCE_M = 100;

const toRad = (deg: number): number => (deg * Math.PI) / 180;

/** Great-circle distance between two coordinates, in metres. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface GeofenceResult {
  /** True when the user is inside the radius (inclusive). */
  ok: boolean;
  distanceM: number;
}

/** Is `user` within `radiusM` of `gym`? Returns the distance either way
 *  so the caller can tell the member how far off they are. */
export function withinGeofence(user: LatLng, gym: LatLng, radiusM: number = DEFAULT_GEOFENCE_M): GeofenceResult {
  const distanceM = haversineMeters(user, gym);
  return { ok: distanceM <= radiusM, distanceM };
}

/** Human distance: "80 m", "450 m", "2.4 km". Rounded coarsely because
 *  a GPS fix is never precise enough to justify more. */
export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return '—';
  if (meters < 950) return `${Math.max(0, Math.round(meters / 10) * 10)} m`;
  // Round to 100 m first: (950/1000).toFixed(1) is "0.9", not "1.0".
  return `${(Math.round(meters / 100) / 10).toFixed(1)} km`;
}

export type PositionFailure = 'unsupported' | 'denied' | 'unavailable' | 'timeout';

/** Honest copy for every way a position request can fail. Each one
 *  points at the daily-code path, which staff control and which is
 *  never geofenced. */
export function positionFailureMessage(reason: PositionFailure): string {
  switch (reason) {
    case 'unsupported':
      return "This device can't share its location, so we can't confirm you're at the gym. Use today's 6-digit code from the front desk instead.";
    case 'denied':
      return "Location is blocked, so we can't confirm you're at the gym. Allow location for Zenith, or use today's 6-digit code from the front desk.";
    case 'timeout':
      return "Finding your location took too long. Try again, or use today's 6-digit code from the front desk.";
    case 'unavailable':
    default:
      return "Couldn't get your location. Try again near a window or outside, or use today's 6-digit code from the front desk.";
  }
}

// ---------- browser: the only impure export ----------

export type PositionResult =
  | { ok: true; coords: LatLng; accuracyM: number }
  | { ok: false; reason: PositionFailure };

/** One-shot high-accuracy position, never rejecting: every failure comes
 *  back as a typed reason so the caller can explain it. */
export function requestPosition(timeoutMs = 10_000): Promise<PositionResult> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return Promise.resolve({ ok: false, reason: 'unsupported' });
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        ok: true,
        coords: { lat: pos.coords.latitude, lng: pos.coords.longitude },
        accuracyM: pos.coords.accuracy,
      }),
      (err) => {
        const reason: PositionFailure =
          err.code === err.PERMISSION_DENIED ? 'denied'
            : err.code === err.TIMEOUT ? 'timeout'
              : 'unavailable';
        resolve({ ok: false, reason });
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
    );
  });
}
