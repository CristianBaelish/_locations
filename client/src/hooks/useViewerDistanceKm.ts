import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { distanceKm } from "../lib/geo";
import { messageInsecureGeolocationContext } from "../lib/geoErrors";
import type { LatLng } from "../components/StreetFollowView";

/**
 * Distancia desde el dispositivo del visor hasta quien comparte.
 * Solo pide ubicación cuando cambia la posición redondeada del objetivo (evita bucles).
 */
export function useViewerDistanceKm(target: LatLng | null): {
  km: number | null;
  error: string | null;
  refresh: () => void;
} {
  const targetRef = useRef(target);
  targetRef.current = target;

  const [viewer, setViewer] = useState<LatLng | null>(null);
  const [error, setError] = useState<string | null>(null);

  const key = target ? `${target.lat.toFixed(4)}_${target.lng.toFixed(4)}` : "";

  const measure = useCallback(() => {
    const t = targetRef.current;
    if (!t) return;
    if (!navigator.geolocation) {
      setError("Ubicación no disponible");
      return;
    }
    if (typeof window !== "undefined" && !window.isSecureContext) {
      setViewer(null);
      setError(messageInsecureGeolocationContext());
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setViewer({ lat: p.coords.latitude, lng: p.coords.longitude });
        setError(null);
      },
      () => {
        setViewer(null);
        setError("Ubicación no disponible");
      },
      { enableHighAccuracy: false, maximumAge: 120_000, timeout: 25_000 }
    );
  }, []);

  useEffect(() => {
    if (!key) {
      setViewer(null);
      setError(null);
      return;
    }
    measure();
  }, [key, measure]);

  const km = useMemo(() => {
    const t = targetRef.current;
    if (!viewer || !t) return null;
    return Math.round(distanceKm(viewer, t) * 100) / 100;
  }, [viewer, key]);

  return { km, error, refresh: measure };
}
