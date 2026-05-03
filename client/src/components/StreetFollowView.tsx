import { useEffect, useMemo, useRef, useState } from "react";
import { loadGoogleMaps } from "../lib/mapsLoader";
import { useDebounced } from "../hooks/useDebounced";

export type LatLng = { lat: number; lng: number };

type Props = {
  position: LatLng | null;
  /** Degrees, 0–360, when the device reports it */
  headingDeg?: number | null;
  /** Rumbo por trayectoria (prioridad sobre headingDeg para el POV de Street View) */
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
  const povSourceRef = useRef<{ course: number | null; heading: number | null }>({
    course: null,
    heading: null,
  });
  povSourceRef.current = {
    course: courseDeg != null && Number.isFinite(courseDeg) ? courseDeg : null,
    heading: headingDeg != null && Number.isFinite(headingDeg) ? headingDeg : null,
  };

  const [mapsError, setMapsError] = useState<string | null>(null);
  const [mapsReady, setMapsReady] = useState(false);
  const [panoHint, setPanoHint] = useState<string | null>(null);
  const [panoHasImage, setPanoHasImage] = useState(false);

  const stablePosition = useMemo((): LatLng | null => {
    if (!position) return null;
    return { lat: position.lat, lng: position.lng };
  }, [position ? `${position.lat.toFixed(4)}_${position.lng.toFixed(4)}` : ""]);

  const debouncedPos = useDebounced(stablePosition, 900);

  useEffect(() => {
    let cancelled = false;

    /** Google llama esto si la clave es inválida, el referrer no está permitido o falta facturación. */
    const prevGmAuthFailure = window.gm_authFailure;
    window.gm_authFailure = () => {
      if (!cancelled) {
        setMapsError(
          "Google Maps rechazó la clave (restricciones del sitio, facturación o API no habilitada). En Google Cloud → Credenciales → tu clave → «Restricciones de aplicación» permití HTTPS de tu dominio (p. ej. https://locationspov.vercel.app/* y http://localhost:*). Revisá también Facturación del proyecto."
        );
      }
      if (typeof prevGmAuthFailure === "function") prevGmAuthFailure();
    };

    loadGoogleMaps()
      .then((g) => {
        if (cancelled || !mapEl.current || !panoEl.current) return;

        const defaultCenter = { lat: 40.4168, lng: -3.7038 };
        const map = new g.maps.Map(mapEl.current, {
          center: defaultCenter,
          zoom: 6,
          mapTypeControl: true,
          mapTypeControlOptions: { style: g.maps.MapTypeControlStyle.DROPDOWN_MENU },
          streetViewControl: false,
          fullscreenControl: true,
        });

        const pano = new g.maps.StreetViewPanorama(panoEl.current, {
          visible: false,
          addressControl: true,
          linksControl: true,
          panControl: true,
          enableCloseButton: false,
        });

        map.setStreetView(pano);

        const marker = new g.maps.Marker({
          map,
          position: defaultCenter,
          title: "Posición compartida",
        });

        mapRef.current = map;
        markerRef.current = marker;
        panoRef.current = pano;
        svRef.current = new g.maps.StreetViewService();
        setMapsReady(true);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setMapsError(e instanceof Error ? e.message : "No se pudo cargar Google Maps");
        }
      });

    return () => {
      cancelled = true;
      window.gm_authFailure = prevGmAuthFailure;
    };
  }, []);

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
    if (!mapsReady || !debouncedPos) return;
    const map = mapRef.current;
    const marker = markerRef.current;
    const pano = panoRef.current;
    const sv = svRef.current;
    if (!map || !marker || !pano || !sv) return;

    const g = google.maps;
    const latLng = new g.LatLng(debouncedPos.lat, debouncedPos.lng);
    map.panTo(latLng);
    map.setZoom(17);
    marker.setPosition(latLng);

    const myRequest = ++panoRequestId.current;
    setPanoHint(null);
    setPanoHasImage(false);
    pano.setVisible(false);

    void Promise.race([
      findNearestPanorama(sv, latLng).then((r) => ({ t: "ok" as const, r })),
      new Promise<{ t: "timeout" }>((resolve) => {
        window.setTimeout(() => resolve({ t: "timeout" }), PANO_SEARCH_TIMEOUT_MS);
      }),
    ]).then((boxed) => {
      if (panoRequestId.current !== myRequest) return;

      if (boxed.t === "timeout") {
        setPanoHint(
          "Street View no respondió a tiempo (red lenta o API ocupada). El mapa sigue mostrando tu posición; podés reintentar moviéndote un poco."
        );
        panoRef.current?.setVisible(false);
        setPanoHasImage(false);
        return;
      }

      const result = boxed.r;
      const panoNow = panoRef.current;
      if (!panoNow || !result?.data?.location?.pano) {
        setPanoHint(
          "No hay Street View cerca (interior, zona rural o sin recorrido). El mapa muestra tu ubicación."
        );
        panoNow?.setVisible(false);
        setPanoHasImage(false);
        return;
      }

      const { data } = result;
      const loc = data.location;
      if (!loc?.pano) {
        setPanoHint(
          "No hay Street View cerca (interior, zona rural o sin recorrido). El mapa muestra tu ubicación."
        );
        panoNow.setVisible(false);
        setPanoHasImage(false);
        return;
      }
      panoNow.setPano(loc.pano);

      const { course, heading: deviceH } = povSourceRef.current;
      let povHeading = 0;
      if (course != null) {
        povHeading = course;
      } else if (deviceH != null) {
        povHeading = deviceH;
      } else if (loc.latLng) {
        povHeading = g.geometry.spherical.computeHeading(loc.latLng, latLng);
      }

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
  }, [mapsReady, debouncedPos]);

  useEffect(() => {
    if (!panoHasImage || !panoRef.current) return;
    const { course, heading: deviceH } = povSourceRef.current;
    const deg = course ?? deviceH;
    if (deg == null) return;
    panoRef.current.setPov({ heading: deg, pitch: 0 });
  }, [courseDeg, headingDeg, panoHasImage]);

  if (mapsError) {
    return (
      <div className="card">
        <p className="muted" style={{ color: "var(--danger)", margin: 0 }}>
          {mapsError}
        </p>
        <p className="muted" style={{ marginTop: "0.75rem", marginBottom: 0 }}>
          Si ves el cartel gris <em>Something went wrong</em> pero no este mensaje: abrí la consola (F12) y buscá
          errores de <code>RefererNotAllowedMapError</code> o similar. Suele faltar en la clave la URL exacta de
          producción en restricciones HTTP, o la cuenta de facturación en Google Cloud.
        </p>
        <p className="muted" style={{ marginTop: "0.75rem", marginBottom: 0 }}>
          En local: <code>VITE_GOOGLE_MAPS_API_KEY</code> en <code>.env</code> o <code>client/.env</code> y reiniciá
          Vite. En Vercel/Render: la misma variable en el panel y <strong>volver a desplegar</strong> el front.
        </p>
      </div>
    );
  }

  return (
    <div>
      {panoHint ? (
        <p className="muted" style={{ margin: "0 0 0.5rem" }}>
          {panoHint}
        </p>
      ) : null}
      <div className={`split${layout === "viewer" ? " split--viewer" : ""}`}>
        <div ref={mapEl} className="map-box" />
        <div className="pano-box">
          {!panoHasImage && mapsReady ? (
            <div className="pano-placeholder pano-inner" style={{ position: "absolute", inset: 0, zIndex: 1 }}>
              {debouncedPos
                ? "Buscando vista de calle cercana…"
                : positionSource === "remote"
                  ? "Esperando la posición de quien comparte la sesión…"
                  : "Esperando posición GPS para cargar Street View…"}
            </div>
          ) : null}
          <div ref={panoEl} className="pano-inner" />
        </div>
      </div>
    </div>
  );
}
