/** Meters between two WGS84 points (haversine). */
export function distanceMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const R = 6371000;
  const φ1 = (a.lat * Math.PI) / 180;
  const φ2 = (b.lat * Math.PI) / 180;
  const Δφ = ((b.lat - a.lat) * Math.PI) / 180;
  const Δλ = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
  return R * c;
}

/** Kilómetros (2 decimales útiles para UI). */
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  return distanceMeters(a, b) / 1000;
}

/**
 * Rumbo inicial en grados [0,360): de `from` hacia `to` (N=0, E=90).
 * Sirve para dirección de trayectoria entre dos puntos GPS.
 */
export function initialBearingDeg(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number }
): number {
  const φ1 = (from.lat * Math.PI) / 180;
  const φ2 = (to.lat * Math.PI) / 180;
  const Δλ = ((to.lng - from.lng) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  const θ = Math.atan2(y, x);
  return ((θ * 180) / Math.PI + 360) % 360;
}

const CARDINAL_ES = [
  "Norte",
  "Noreste",
  "Este",
  "Sureste",
  "Sur",
  "Suroeste",
  "Oeste",
  "Noroeste",
] as const;

/** Punto cardinal aproximado en español (8 rumbos). */
export function bearingToCardinalEs(deg: number): string {
  const x = ((deg % 360) + 360) % 360;
  const i = Math.round(x / 45) % 8;
  return CARDINAL_ES[i] ?? "Norte";
}
