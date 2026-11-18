import { useEffect, useMemo, useRef, useState } from "react";
import { loadGoogleMaps, resetGoogleMaps } from "../lib/mapsLoader";
import { WarmStatus } from "./WarmStatus";
import { useDebounced } from "../hooks/useDebounced";
import { distanceMeters, smallestAngleDelta } from "../lib/geo";

export type LatLng = { lat: number; lng: number };

type Props = {
  position: LatLng | null;
  /** Degrees, 0–360, when the device reports it */
  headingDeg?: number | null;
  /** Rumbo por trayectoria. La brújula (headingDeg) manda la cámara si existe. */
  courseDeg?: number | null;
  /** `remote` = visor (sin GPS); `device` = quien comparte */
  positionSource?: "device" | "remote";
  /** `viewer`: mapa más chico, Street View más grande */
  layout?: "balanced" | "viewer";
};

type PanoAttempt = {
  radius: number;
  source?: google.maps.StreetViewSource;
};

function requestPanorama(
  sv: google.maps.StreetViewService,
  latLng: google.maps.LatLng,
  attempt: PanoAttempt
): Promise<{ data: google.maps.StreetViewPanoramaData | null; status: google.maps.StreetViewStatus }> {
  return new Promise((resolve) => {
    const g = google.maps;
    const req: google.maps.StreetViewLocationRequest = {
      location: latLng,
      radius: attempt.radius,
      preference: g.StreetViewPreference.NEAREST,
    };
    if (attempt.source !== undefined) {
      req.source = attempt.source;
    }
    sv.getPanorama(req, (data, status) => {
      resolve({ data, status });
    });
  });
}

/** Solo llamar después de `loadGoogleMaps()` (google.maps ya existe). Máx. 2 peticiones por punto para no saturar. */
async function findNearestPanorama(
  sv: google.maps.StreetViewService,
  latLng: google.maps.LatLng
): Promise<{ data: google.maps.StreetViewPanoramaData; status: google.maps.StreetViewStatus } | null> {
  const g = google.maps;
  const attempts: PanoAttempt[] = [
    { radius: 100, source: g.StreetViewSource.OUTDOOR },
    { radius: 400 },
  ];

  for (const attempt of attempts) {
    const { data, status } = await requestPanorama(sv, latLng, attempt);
    if (status === g.StreetViewStatus.OK && data?.location?.pano) {
      return { data, status };
    }
  }
  return null;
}

const PANO_SEARCH_TIMEOUT_MS = 25_000;
/** Misma foto de calle mientras el punto no se aleje. Pedir una nueva en cada paso agota la cuota y la vista se congela. */
const PANO_MOVE_M = 35;
const PANO_RETRY_MS = 20_000;

export function StreetFollowView({
  position,
  headingDeg,
  courseDeg = null,
  positionSource = "device",
  layout = "balanced",
}: Props) {
  const mapEl = useRef<HTMLDivElement>(null);
  const panoEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);
  const panoRef = useRef<google.maps.StreetViewPanorama | null>(null);
  const svRef = useRef<google.maps.StreetViewService | null>(null);
  const panoRequestId = useRef(0);
  const panoTrack = useRef({ lat: Number.NaN, lng: Number.NaN, at: 0, hasImage: false });
  const povSourceRef = useRef<{ course: number | null; heading: number | null }>({
    course: null,
    heading: null,
  });
  povSourceRef.current = {
    course: courseDeg != null && Number.isFinite(courseDeg) ? courseDeg : null,
    heading: headingDeg != null && Number.isFinite(headingDeg) ? headingDeg : null,
  };
  const handsOffRef = useRef(true);
  const lockedPanoRef = useRef<string | null>(null);
  const suppressStreetRef = useRef(0);

  const [mapsError, setMapsError] = useState<string | null>(null);
  const [mapsLimited, setMapsLimited] = useState(false);
  const [mapsReady, setMapsReady] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [panoHint, setPanoHint] = useState<string | null>(null);
  const [panoHasImage, setPanoHasImage] = useState(false);
  const [panoRetry, setPanoRetry] = useState(0);
  const [handsOff, setHandsOff] = useState(true);
  handsOffRef.current = handsOff;

  const stablePosition = useMemo((): LatLng | null => {
    if (!position) return null;
    return { lat: position.lat, lng: position.lng };
  }, [position ? `${position.lat.toFixed(5)}_${position.lng.toFixed(5)}` : ""]);

  const panoDebounceMs = positionSource === "remote" ? 350 : 600;
  const debouncedPos = useDebounced(stablePosition, panoDebounceMs);

  useEffect(() => {
    const onLimited = () => setMapsLimited(true);
    if (window.__livePovMapsLimited) setMapsLimited(true);
    window.addEventListener("livepov-maps-limited", onLimited);
    return () => window.removeEventListener("livepov-maps-limited", onLimited);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const listeners: google.maps.MapsEventListener[] = [];

    loadGoogleMaps()
      .then((g) => {
        if (cancelled || !mapEl.current || !panoEl.current) return;

        const defaultCenter = { lat: 40.4168, lng: -3.7038 };
        const map = new g.maps.Map(mapEl.current, {
          center: defaultCenter,
          zoom: 6,
          colorScheme: "LIGHT",
          mapTypeControl: true,
          mapTypeControlOptions: { style: g.maps.MapTypeControlStyle.DROPDOWN_MENU },
          streetViewControl: false,
          fullscreenControl: true,
        });

        const panoOptions: google.maps.StreetViewPanoramaOptions & {
          motionTracking: boolean;
          motionTrackingControl: boolean;
        } = {
          visible: false,
          addressControl: false,
          clickToGo: false,
          linksControl: false,
          panControl: false,
          zoomControl: false,
          scrollwheel: false,
          disableDoubleClickZoom: true,
          fullscreenControl: false,
          motionTracking: false,
          motionTrackingControl: false,
          enableCloseButton: false,
        };
        const pano = new g.maps.StreetViewPanorama(panoEl.current, panoOptions);

        map.setStreetView(pano);

        const marker = new g.maps.Marker({
          title: "Posición compartida",
        });

        mapRef.current = map;
        markerRef.current = marker;
        panoRef.current = pano;
        svRef.current = new g.maps.StreetViewService();

        const revertLockedView = () => {
          if (cancelled || Date.now() < suppressStreetRef.current || !handsOffRef.current) return;
          const locked = lockedPanoRef.current;
          if (locked && pano.getPano() !== locked) {
            suppressStreetRef.current = Date.now() + 600;
            pano.setPano(locked);
          }
          const wanted = povSourceRef.current.heading ?? povSourceRef.current.course;
          if (wanted == null) return;
          const pov = pano.getPov();
          const pitch = pov?.pitch ?? 0;
          const headingNow = pov?.heading ?? 0;
          if (smallestAngleDelta(headingNow, wanted) > 2 || Math.abs(pitch) > 2) {
            suppressStreetRef.current = Date.now() + 600;
            pano.setPov({ heading: wanted, pitch: 0 });
          }
        };
        if (!cancelled) {
          listeners.push(pano.addListener("pov_changed", revertLockedView));
          listeners.push(pano.addListener("pano_changed", revertLockedView));
          setMapsReady(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMapsError("No pudimos abrir el mapa. Revisá la conexión e intentá de nuevo.");
        }
      });

    return () => {
      cancelled = true;
      for (const listener of listeners) listener.remove();
    };
  }, [loadAttempt]);

  useEffect(() => {
    if (!mapsReady || !mapEl.current || !panoEl.current) return;

    const resizeBoth = () => {
      const map = mapRef.current;
      const pano = panoRef.current;
      if (!window.google?.maps?.event) return;
      const ev = window.google.maps.event;
      if (map) ev.trigger(map, "resize");
      if (pano) ev.trigger(pano, "resize");
    };

    const ro = new ResizeObserver(() => {
      requestAnimationFrame(resizeBoth);
    });
    ro.observe(mapEl.current);
    ro.observe(panoEl.current);

    return () => ro.disconnect();
  }, [mapsReady]);

  useEffect(() => {
    if (!mapsReady) return;
    const map = mapRef.current;
    const marker = markerRef.current;
    if (!map || !marker) return;

    if (!stablePosition) {
      marker.setMap(null);
      panoRequestId.current += 1;
      panoTrack.current = { lat: Number.NaN, lng: Number.NaN, at: 0, hasImage: false };
      panoRef.current?.setVisible(false);
      setPanoHasImage(false);
      setPanoHint(null);
      return;
    }

    const g = google.maps;
    const latLng = new g.LatLng(stablePosition.lat, stablePosition.lng);
    const firstFix = marker.getMap() == null;
    marker.setMap(map);
    marker.setPosition(latLng);
    map.panTo(latLng);
    if (firstFix) map.setZoom(17);
  }, [mapsReady, stablePosition]);

  useEffect(() => {
    if (!mapsReady || !debouncedPos) return;
    const pano = panoRef.current;
    const sv = svRef.current;
    if (!pano || !sv) return;

    const g = google.maps;
    const latLng = new g.LatLng(debouncedPos.lat, debouncedPos.lng);

    const track = panoTrack.current;
    const haveFix = Number.isFinite(track.lat) && Number.isFinite(track.lng);
    const moved = !haveFix || distanceMeters(track, debouncedPos) >= PANO_MOVE_M;
    const retryDue = !track.hasImage && track.at > 0 && Date.now() - track.at >= PANO_RETRY_MS;
    if (haveFix && !moved && !retryDue) return;

    const myRequest = ++panoRequestId.current;
    const hadImage = track.hasImage;
    track.at = Date.now();
    track.lat = debouncedPos.lat;
    track.lng = debouncedPos.lng;
    if (!hadImage) setPanoHint(null);

    let timeoutId = 0;
    const timeout = new Promise<{ t: "timeout" }>((resolve) => {
      timeoutId = window.setTimeout(() => resolve({ t: "timeout" }), PANO_SEARCH_TIMEOUT_MS);
    });

    void Promise.race([
      findNearestPanorama(sv, latLng).then((r) => ({ t: "ok" as const, r })),
      timeout,
    ]).then((boxed) => {
      window.clearTimeout(timeoutId);
      if (panoRequestId.current !== myRequest) return;

      const keepCurrent = () => {
        if (hadImage) return;
        setPanoHint("Sin vista de calle en esta zona.");
        panoRef.current?.setVisible(false);
        panoTrack.current.hasImage = false;
        setPanoHasImage(false);
        window.setTimeout(() => {
          if (panoRequestId.current !== myRequest) return;
          setPanoRetry((n) => n + 1);
        }, PANO_RETRY_MS);
      };

      if (boxed.t === "timeout") {
        keepCurrent();
        return;
      }

      const result = boxed.r;
      const panoNow = panoRef.current;
      if (!panoNow || !result?.data?.location?.pano) {
        keepCurrent();
        return;
      }

      const { data } = result;
      const loc = data.location;
      if (!loc?.pano) {
        keepCurrent();
        return;
      }
      lockedPanoRef.current = loc.pano;
      suppressStreetRef.current = Date.now() + 600;
      panoNow.setPano(loc.pano);
      panoTrack.current.hasImage = true;

      const { course, heading: deviceH } = povSourceRef.current;
      let povHeading = 0;
      if (deviceH != null) {
        povHeading = deviceH;
      } else if (course != null) {
        povHeading = course;
      } else if (loc.latLng) {
        povHeading = g.geometry.spherical.computeHeading(loc.latLng, latLng);
      }

      suppressStreetRef.current = Date.now() + 600;
      panoNow.setPov({ heading: povHeading, pitch: 0 });
      panoNow.setVisible(true);
      setPanoHasImage(true);
      setPanoHint(null);

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (panoRequestId.current !== myRequest) return;
          const p = panoRef.current;
          if (p && window.google?.maps?.event) {
            window.google.maps.event.trigger(p, "resize");
          }
          const m = mapRef.current;
          if (m && window.google?.maps?.event) {
            window.google.maps.event.trigger(m, "resize");
          }
        });
      });
    });
  }, [mapsReady, debouncedPos, panoRetry]);

  useEffect(() => {
    const pano = panoRef.current;
    if (!mapsReady || !pano) return;
    const followOpts: google.maps.StreetViewPanoramaOptions & {
      motionTracking: boolean;
      motionTrackingControl: boolean;
    } = {
      clickToGo: !handsOff,
      linksControl: !handsOff,
      panControl: !handsOff,
      zoomControl: !handsOff,
      scrollwheel: !handsOff,
      disableDoubleClickZoom: handsOff,
      fullscreenControl: false,
      motionTracking: false,
      motionTrackingControl: false,
    };
    pano.setOptions(followOpts);
  }, [mapsReady, handsOff]);

  useEffect(() => {
    if (!handsOff || !panoHasImage || !panoRef.current) return;
    const { course, heading: deviceH } = povSourceRef.current;
    const deg = deviceH ?? course;
    if (deg == null) return;
    suppressStreetRef.current = Date.now() + 600;
    panoRef.current.setPov({ heading: deg, pitch: 0 });
  }, [courseDeg, headingDeg, panoHasImage, handsOff]);

  return (
    <div className="map-stage">
      {mapsLimited ? (
        <p className="note">
          Google limitó el mapa en esta página. Si ves la marca de agua o la calle en negativo, la
          facturación de la clave tiene que quedar activa.
        </p>
      ) : null}
      {mapsError ? (
        <div className="card card-alert" role="alert">
          <p style={{ color: "var(--danger)", marginTop: 0 }}>{mapsError}</p>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              resetGoogleMaps();
              setMapsError(null);
              setMapsReady(false);
              setLoadAttempt((n) => n + 1);
            }}
          >
            Reintentar
          </button>
        </div>
      ) : null}
      {panoHint ? (
        <p className="muted" style={{ margin: "0 0 0.5rem" }}>
          {panoHint}
        </p>
      ) : null}
      {mapsReady && position ? (
        <p className="muted" style={{ margin: "0 0 0.5rem" }}>
          {handsOff
            ? positionSource === "remote"
              ? "La calle sigue la brújula y el camino de quien comparte."
              : "La calle sigue tu brújula y tu camino."
            : "Estás moviendo la calle a mano. La brújula queda en pausa."}
        </p>
      ) : null}
      {!mapsError ? <div className="map-frame">
        {!mapsReady && !mapsError ? (
          <div className="map-loading">
            <WarmStatus title="Preparando el mapa" detail="Ya casi está." />
          </div>
        ) : null}
        <div className={`split${layout === "viewer" ? " split--viewer" : ""}`}>
        <div ref={mapEl} className="map-box" />
        <div className="pano-box">
          {!panoHasImage && mapsReady ? (
            <div className="pano-placeholder pano-inner" style={{ position: "absolute", inset: 0, zIndex: 1 }}>
              <WarmStatus
                title={!position ? "Esperando la ubicación" : "Buscando la calle"}
                detail={!position ? "Cuando llegue el punto, aparece el recorrido." : "Un momento, estamos cerca."}
                layout="row"
              />
            </div>
          ) : null}
          <div ref={panoEl} className="pano-inner" />
          {handsOff && panoHasImage ? <div className="pano-lock" aria-hidden="true" /> : null}
          {mapsReady && position ? (
            <div className="pano-toolbar">
              <button
                type="button"
                className="secondary"
                onClick={() => setHandsOff((locked) => !locked)}
                aria-pressed={handsOff}
              >
                {handsOff ? "Mover a mano" : "Seguir la brújula"}
              </button>
            </div>
          ) : null}
        </div>
        </div>
      </div> : null}
    </div>
  );
}
