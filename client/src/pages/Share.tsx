import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useSocket } from "../hooks/useSocket";
import { StreetFollowView, type LatLng } from "../components/StreetFollowView";
import { distanceMeters, initialBearingDeg } from "../lib/geo";
import { CompassRose } from "../components/CompassRose";
import { SyncStatus } from "../components/SyncStatus";
import {
  describeGeolocationError,
  isSecureContextForGeolocation,
  messageInsecureGeolocationContext,
} from "../lib/geoErrors";
import { useJoinRoom } from "../hooks/useJoinRoom";
import { useDeviceHeading } from "../hooks/useDeviceHeading";

const MIN_INTERVAL_MS = 2000;
const MIN_MOVE_M = 5;
const MIN_COURSE_M = 3;
/** Mínimo desplazamiento entre lecturas GPS para mostrar rumbo en la brújula local */
const MIN_UI_COURSE_M = 2;

const isMobile =
  typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

export function Share() {
  const { roomId } = useParams<{ roomId: string }>();
  const { socket, connected, connectionError } = useSocket();
  const { heading: deviceHeading, needsPermission, requestPermission } = useDeviceHeading();
  const [pos, setPos] = useState<LatLng | null>(null);
  const [heading, setHeading] = useState<number | null>(null);
  const [geoErr, setGeoErr] = useState<string | null>(null);
  const [copyOk, setCopyOk] = useState(false);
  const [geoRetryToken, setGeoRetryToken] = useState(0);
  const [movementBearing, setMovementBearing] = useState<number | null>(null);
  const [lastSentAt, setLastSentAt] = useState<number | null>(null);
  const [peers, setPeers] = useState<number | null>(null);

  const lastEmit = useRef<{ t: number; lat: number; lng: number }>({
    t: 0,
    lat: NaN,
    lng: NaN,
  });
  const lastEmitCoords = useRef<{ lat: number; lng: number } | null>(null);
  const lastGpsCoords = useRef<{ lat: number; lng: number } | null>(null);
  const lastCourseDeg = useRef<number | null>(null);
  const hasEmitted = useRef(false);
  const lastGeoPayload = useRef<{
    lat: number;
    lng: number;
    heading: number | null;
    courseDeg: number | null;
    accuracy?: number;
  } | null>(null);

  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const viewerUrl =
    typeof window !== "undefined" && roomId
      ? `${window.location.origin}${base}/v/${roomId}`
      : "";

  useJoinRoom(socket, roomId);

  const socketRef = useRef(socket);
  socketRef.current = socket;
  const deviceHeadingRef = useRef(deviceHeading);
  deviceHeadingRef.current = deviceHeading;

  const emitLocation = (payload: NonNullable<typeof lastGeoPayload.current>) => {
    if (!roomId) return;
    lastGeoPayload.current = payload;
    const s = socketRef.current;
    if (s?.connected) {
      s.emit("location", { roomId, ...payload });
      setLastSentAt(Date.now());
    }
  };

  useEffect(() => {
    if (!socket || !roomId) return;
    const flushPendingLocation = () => {
      const payload = lastGeoPayload.current;
      if (!payload) return;
      emitLocation(payload);
    };
    const onRoomStatus = (p: { peers?: number }) => {
      if (typeof p?.peers === "number") setPeers(p.peers);
    };
    socket.on("connect", flushPendingLocation);
    socket.on("room-status", onRoomStatus);
    flushPendingLocation();
    return () => {
      socket.off("connect", flushPendingLocation);
      socket.off("room-status", onRoomStatus);
    };
  }, [socket, roomId]);

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
    const UI_MIN_MS = 250;

    const watchId = navigator.geolocation.watchPosition(
      (p) => {
        setGeoErr(null);
        const lat = p.coords.latitude;
        const lng = p.coords.longitude;
        const gpsHeading = p.coords.heading;
        const compassHeading = deviceHeadingRef.current;
        const effectiveHeading =
          compassHeading != null
            ? compassHeading
            : gpsHeading != null && Number.isFinite(gpsHeading)
              ? gpsHeading
              : null;
        const now = Date.now();

        const prevGps = lastGpsCoords.current;
        if (prevGps && distanceMeters(prevGps, { lat, lng }) >= MIN_UI_COURSE_M) {
          const brg = initialBearingDeg(prevGps, { lat, lng });
          lastCourseDeg.current = brg;
          setMovementBearing(brg);
        }
        lastGpsCoords.current = { lat, lng };

        if (now - lastUi >= UI_MIN_MS) {
          lastUi = now;
          setPos({ lat, lng });
        }
        setHeading(effectiveHeading);

        const prev = lastEmit.current;
        const moved =
          Number.isFinite(prev.lat) &&
          Number.isFinite(prev.lng) &&
          distanceMeters({ lat: prev.lat, lng: prev.lng }, { lat, lng }) >= MIN_MOVE_M;
        const due = now - prev.t >= MIN_INTERVAL_MS;
        const first = !hasEmitted.current;

        if (first || due || moved) {
          const prevCoord = lastEmitCoords.current;
          if (prevCoord && distanceMeters(prevCoord, { lat, lng }) >= MIN_COURSE_M) {
            const brg = initialBearingDeg(prevCoord, { lat, lng });
            lastCourseDeg.current = brg;
            setMovementBearing(brg);
          }

          lastEmit.current = { t: now, lat, lng };
          lastEmitCoords.current = { lat, lng };
          hasEmitted.current = true;

          emitLocation({
            lat,
            lng,
            heading: effectiveHeading,
            courseDeg:
              lastCourseDeg.current != null && Number.isFinite(lastCourseDeg.current)
                ? lastCourseDeg.current
                : null,
            accuracy: p.coords.accuracy ?? undefined,
          });
        }
      },
      (e) => {
        setGeoErr(describeGeolocationError(e));
      },
      {
        enableHighAccuracy: isMobile,
        maximumAge: 5_000,
        timeout: 30_000,
      }
    );

    const heartbeatId = window.setInterval(() => {
      const payload = lastGeoPayload.current;
      if (!payload) return;
      const now = Date.now();
      if (now - lastEmit.current.t >= MIN_INTERVAL_MS) {
        lastEmit.current.t = now;
        emitLocation(payload);
      }
    }, MIN_INTERVAL_MS);

    return () => {
      navigator.geolocation.clearWatch(watchId);
      window.clearInterval(heartbeatId);
    };
  }, [roomId, geoRetryToken]);

  useEffect(() => {
    if (deviceHeading == null || !lastGeoPayload.current || !roomId) return;
    const id = window.setTimeout(() => {
      const base = lastGeoPayload.current;
      if (!base) return;
      const payload = { ...base, heading: deviceHeading };
      lastGeoPayload.current = payload;
      emitLocation(payload);
    }, 400);
    return () => window.clearTimeout(id);
  }, [deviceHeading, roomId]);

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

  async function enableCompass() {
    await requestPermission();
  }

  const displayBearing = deviceHeading ?? movementBearing ?? heading;

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

      <SyncStatus
        connected={connected}
        role="share"
        lastSentAt={lastSentAt}
        peers={peers}
      />

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
        <div
          className="card"
          style={{ marginBottom: "1rem", cursor: displayBearing == null ? "pointer" : undefined }}
          onClick={displayBearing == null ? () => void enableCompass() : undefined}
          role={displayBearing == null ? "button" : undefined}
          tabIndex={displayBearing == null ? 0 : undefined}
          onKeyDown={
            displayBearing == null
              ? (e) => {
                  if (e.key === "Enter" || e.key === " ") void enableCompass();
                }
              : undefined
          }
        >
          <CompassRose
            bearingDeg={displayBearing}
            caption={
              deviceHeading != null
                ? "Brújula del dispositivo (magnetómetro)"
                : movementBearing != null
                  ? "Rumbo según tu movimiento reciente"
                  : heading != null
                    ? "Orientación reportada por el GPS"
                    : "Tocá aquí o movete unos metros para ver el rumbo"
            }
            compact
          />
          {needsPermission || displayBearing == null ? (
            <button
              type="button"
              className="secondary"
              style={{ marginTop: "0.75rem" }}
              onClick={(e) => {
                e.stopPropagation();
                void enableCompass();
              }}
            >
              Activar brújula del teléfono
            </button>
          ) : null}
        </div>
      ) : null}

      <StreetFollowView
        position={pos}
        headingDeg={deviceHeading ?? heading}
        courseDeg={movementBearing}
      />
    </div>
  );
}
