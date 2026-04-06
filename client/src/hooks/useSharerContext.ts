import { useEffect, useRef, useState } from "react";
import { fetchSharerWeatherContext, type SharerWeatherContext } from "../lib/openMeteo";
import type { LatLng } from "../components/StreetFollowView";

export function useSharerContext(sharerPos: LatLng | null): {
  data: SharerWeatherContext | null;
  loading: boolean;
  error: string | null;
} {
  const posRef = useRef(sharerPos);
  posRef.current = sharerPos;

  const [data, setData] = useState<SharerWeatherContext | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const key = sharerPos ? `${sharerPos.lat.toFixed(3)}_${sharerPos.lng.toFixed(3)}` : "";

  useEffect(() => {
    if (!key) {
      setData(null);
      setError(null);
      return;
    }

    const p = posRef.current;
    if (!p) return;

    let cancelled = false;
    const t = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      void fetchSharerWeatherContext(p.lat, p.lng)
        .then((d) => {
          if (!cancelled) {
            setData(d);
            setError(null);
          }
        })
        .catch((e: unknown) => {
          if (!cancelled) {
            setData(null);
            setError(e instanceof Error ? e.message : "Clima no disponible");
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 900);

    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [key]);

  return { data, loading, error };
}
