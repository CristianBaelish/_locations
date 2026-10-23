import { useEffect, useRef, useState } from "react";
import { fetchSharerWeatherContext, type SharerWeatherContext } from "../lib/openMeteo";
import type { LatLng } from "../components/StreetFollowView";

const WEATHER_REFRESH_MS = 10 * 60 * 1000;

export function useSharerContext(sharerPos: LatLng | null): {
  data: SharerWeatherContext | null;
  loading: boolean;
  error: string | null;
} {
  const posRef = useRef(sharerPos);
  posRef.current = sharerPos;
  const dataRef = useRef<SharerWeatherContext | null>(null);

  const [data, setData] = useState<SharerWeatherContext | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const key = sharerPos ? `${sharerPos.lat.toFixed(3)}_${sharerPos.lng.toFixed(3)}` : "";

  useEffect(() => {
    if (!key) {
      dataRef.current = null;
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;

    const load = () => {
      const p = posRef.current;
      if (!p) return;
      if (!dataRef.current) {
        setLoading(true);
        setError(null);
      }
      void fetchSharerWeatherContext(p.lat, p.lng)
        .then((d) => {
          if (cancelled) return;
          dataRef.current = d;
          setData(d);
          setError(null);
        })
        .catch(() => {
          if (cancelled) return;
          if (!dataRef.current) setError("No disponible");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    };

    const t = window.setTimeout(load, 900);
    const interval = window.setInterval(load, WEATHER_REFRESH_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(t);
      window.clearInterval(interval);
    };
  }, [key]);

  return { data, loading, error };
}
