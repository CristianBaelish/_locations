import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { distanceKm } from "../lib/geo";
import { messageInsecureGeolocationContext } from "../lib/geoErrors";
import type { LatLng } from "../components/StreetFollowView";

/**
 * Distancia desde el dispositivo del visor hasta quien comparte.
 * Sigue la posición del visor con watchPosition; el botón fuerza una lectura nueva.
 */
export function useViewerDistanceKm(target: LatLng | null): {
  km: number | null;
  error: string | null;
  refresh: () => void;
} {
  const targetRef = useRef(target);
  targetRef.current = target;
  const hasFix = useRef(false);

  const [viewer, setViewer] = useState<LatLng | null>(null);
  const [error, setError] = useState<string | null>(null);

  const active = target != null;

  const onFix = useCallback((lat: number, lng: number) => {
    hasFix.current = true;
    setViewer({ lat, lng });
    setError(null);
  }, []);

  const onFail = useCallback((message: string, clear: boolean) => {
    if (clear || !hasFix.current) {
      if (clear) {
        hasFix.current = false;
        setViewer(null);
      }
      setError(message);
    }
  }, []);

  const refresh = useCallback(() => {
    if (!targetRef.current) return;
    if (!navigator.geolocation) {
      onFail("Ubicación no disponible", true);
      return;
    }
    if (typeof window !== "undefined" && !window.isSecureContext) {
      onFail(messageInsecureGeolocationContext(), true);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => onFix(p.coords.latitude, p.coords.longitude),
      () => onFail("Ubicación no disponible", false),
      { enableHighAccuracy: false, maximumAge: 0, timeout: 25_000 }
    );
  }, [onFail, onFix]);

  useEffect(() => {
    if (!active) {
      hasFix.current = false;
      setViewer(null);
      setError(null);
      return;
    }
    if (!navigator.geolocation) {
      onFail("Ubicación no disponible", true);
      return;
    }
    if (typeof window !== "undefined" && !window.isSecureContext) {
      onFail(messageInsecureGeolocationContext(), true);
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (p) => onFix(p.coords.latitude, p.coords.longitude),
      () => onFail("Ubicación no disponible", false),
      { enableHighAccuracy: false, maximumAge: 15_000, timeout: 25_000 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [active, onFail, onFix]);

  const km = useMemo(() => {
    if (!viewer || !target) return null;
    return Math.round(distanceKm(viewer, target) * 100) / 100;
  }, [viewer, target]);

  return { km, error, refresh };
}
