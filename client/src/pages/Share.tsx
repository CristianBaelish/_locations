import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useSocket } from "../hooks/useSocket";
import { StreetFollowView, type LatLng } from "../components/StreetFollowView";
import { distanceMeters, initialBearingDeg } from "../lib/geo";
import { CompassRose } from "../components/CompassRose";
import {
  describeGeolocationError,
  isSecureContextForGeolocation,
  messageInsecureGeolocationContext,
} from "../lib/geoErrors";
import { useJoinRoom } from "../hooks/useJoinRoom";

const MIN_INTERVAL_MS = 3500;
const MIN_MOVE_M = 12;
/** Mínimo desplazamiento entre emisiones para actualizar el rumbo por trayectoria */
const MIN_COURSE_M = 12;

export function Share() {
  const { roomId } = useParams<{ roomId: string }>();
  const { socket, connectionError } = useSocket();
  const [pos, setPos] = useState<LatLng | null>(null);
  const [heading, setHeading] = useState<number | null>(null);
  const [geoErr, setGeoErr] = useState<string | null>(null);
  const [copyOk, setCopyOk] = useState(false);
  const [geoRetryToken, setGeoRetryToken] = useState(0);
  const [movementBearing, setMovementBearing] = useState<number | null>(null);

  const lastEmit = useRef<{ t: number; lat: number; lng: number }>({
    t: 0,
    lat: NaN,
    lng: NaN,
  });
  const lastEmitCoords = useRef<{ lat: number; lng: number } | null>(null);
  const lastCourseDeg = useRef<number | null>(null);

  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const viewerUrl =
    typeof window !== "undefined" && roomId
      ? `${window.location.origin}${base}/v/${roomId}`
      : "";

  useJoinRoom(socket, roomId);

  const socketRef = useRef(socket);
  socketRef.current = socket;

  useEffect(() => {
    if (!roomId) return;

    if (!navigator.geolocation) {
      setGeoErr("Tu navegador no expone geolocalización.");
      return;
    }

    if (!isSecureContextForGeolocation()) {
      setGeoErr(messageInsecureGeolocationContext());
      return;
    }

    let lastUi = 0;
    const UI_MIN_MS = 400;

    const watchId = navigator.geolocation.watchPosition(
      (p) => {
        setGeoErr(null);
        const lat = p.coords.latitude;
        const lng = p.coords.longitude;
        const h = p.coords.heading;
        const now = Date.now();
        if (now - lastUi >= UI_MIN_MS) {
          lastUi = now;
          setPos({ lat, lng });
        }
        /** Si el GPS deja de mandar `heading` (muy habitual quieto o en PC), no dejamos un valor viejo. */
        setHeading(h != null && Number.isFinite(h) ? h : null);

        const prev = lastEmit.current;
        const moved =
          Number.isFinite(prev.lat) &&
          Number.isFinite(prev.lng) &&
          distanceMeters({ lat: prev.lat, lng: prev.lng }, { lat, lng }) >= MIN_MOVE_M;
        const due = now - prev.t >= MIN_INTERVAL_MS;

        if (due || moved) {
          const prevCoord = lastEmitCoords.current;
          if (prevCoord && distanceMeters(prevCoord, { lat, lng }) >= MIN_COURSE_M) {
            const brg = initialBearingDeg(prevCoord, { lat, lng });
            lastCourseDeg.current = brg;
            setMovementBearing(brg);
          }

          lastEmit.current = { t: now, lat, lng };
          lastEmitCoords.current = { lat, lng };

          const s = socketRef.current;
          if (s?.connected) {
            s.emit("location", {
              roomId,
              lat,
              lng,
              heading: h != null && Number.isFinite(h) ? h : null,
              courseDeg:
                lastCourseDeg.current != null && Number.isFinite(lastCourseDeg.current)
                  ? lastCourseDeg.current
                  : null,
              accuracy: p.coords.accuracy ?? undefined,
            });
          }
        }
      },
      (e) => {
        setGeoErr(describeGeolocationError(e));
      },
      /* false: en PC sin GPS, “alta precisión” suele forzar fallos del servicio de red de Chrome. */
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 45_000 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [roomId, geoRetryToken]);

  async function copyLink() {
    if (!viewerUrl) return;
    try {
      await navigator.clipboard.writeText(viewerUrl);
      setCopyOk(true);
      window.setTimeout(() => setCopyOk(false), 2000);
    } catch {
      setCopyOk(false);
    }
  }

  return (
    <div className="layout">
      <div className="row" style={{ marginBottom: "1rem" }}>
        <Link to="/" className="secondary" style={{ textDecoration: "none" }}>
          ← Inicio
        </Link>
      </div>

      <h1 style={{ fontSize: "1.2rem", fontWeight: 600, marginTop: 0 }}>Compartiendo</h1>
      <p className="muted">
        Sesión: <code>{roomId}</code>
      </p>

      {connectionError ? (
        <p style={{ color: "var(--danger)", marginBottom: "1rem" }} role="alert">
          {connectionError}
        </p>
      ) : null}

      <div className="card" style={{ marginBottom: "1rem" }}>
        <p className="muted" style={{ marginTop: 0 }}>
          Enlace para quien quiera seguirte:
        </p>
        <div className="row">
          <input className="input-code" style={{ flex: 1, minWidth: 0 }} readOnly value={viewerUrl} />
          <button type="button" onClick={copyLink} disabled={!viewerUrl}>
            {copyOk ? "Copiado" : "Copiar"}
          </button>
        </div>
      </div>

      {geoErr ? (
        <div className="card" style={{ marginBottom: "1rem", borderColor: "#5c3d3d" }} role="alert">
          <p style={{ color: "var(--danger)", marginTop: 0 }}>{geoErr}</p>
          <button type="button" className="secondary" onClick={() => setGeoRetryToken((n) => n + 1)}>
            Reintentar ubicación
          </button>
        </div>
      ) : !pos ? (
        <p className="muted">Obteniendo GPS…</p>
      ) : null}

      {pos ? (
        <div className="card" style={{ marginBottom: "1rem" }}>
          <CompassRose
            bearingDeg={movementBearing ?? heading}
            caption={
              movementBearing != null
                ? "Rumbo según último tramo de trayectoria enviado"
                : heading != null
                  ? "Orientación reportada por el dispositivo (si el navegador la expone)"
                  : "Te mové unos metros para estimar el rumbo por trayectoria"
            }
            compact
          />
        </div>
      ) : null}

      <StreetFollowView
        position={pos}
        headingDeg={heading}
        courseDeg={movementBearing}
      />
    </div>
  );
}
