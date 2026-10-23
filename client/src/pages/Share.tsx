import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useSocket } from "../hooks/useSocket";
import { StreetFollowView, type LatLng } from "../components/StreetFollowView";
import { distanceMeters, initialBearingDeg, smallestAngleDelta } from "../lib/geo";
import { CompassRose } from "../components/CompassRose";
import {
  describeGeolocationError,
  isSecureContextForGeolocation,
  messageInsecureGeolocationContext,
} from "../lib/geoErrors";
import { useJoinRoom } from "../hooks/useJoinRoom";
import { useDeviceHeading } from "../hooks/useDeviceHeading";

const MIN_INTERVAL_MS = 2000;
const HEARTBEAT_MS = 15_000;
const MIN_MOVE_M = 5;
const MIN_COURSE_M = 3;
const MIN_UI_COURSE_M = 2;
const HEADING_EMIT_DEG = 2;
const HEADING_EMIT_MS = 180;

const isMobile =
  typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

export function Share() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const { socket, connectionError } = useSocket();
  const { heading: deviceHeading, needsPermission, requestPermission } = useDeviceHeading();
  const [pos, setPos] = useState<LatLng | null>(null);
  const [heading, setHeading] = useState<number | null>(null);
  const [geoErr, setGeoErr] = useState<string | null>(null);
  const [copyOk, setCopyOk] = useState(false);
  const linkInputRef = useRef<HTMLInputElement>(null);
  const [geoRetryToken, setGeoRetryToken] = useState(0);
  const [movementBearing, setMovementBearing] = useState<number | null>(null);

  const lastEmit = useRef<{ t: number; lat: number; lng: number }>({
    t: 0,
    lat: NaN,
    lng: NaN,
  });
  const lastEmitCoords = useRef<{ lat: number; lng: number } | null>(null);
  const lastGpsCoords = useRef<{ lat: number; lng: number } | null>(null);
  const lastCourseDeg = useRef<number | null>(null);
  const hasEmitted = useRef(false);
  const sharingActive = useRef(true);
  const lastGeoPayload = useRef<{
    lat: number;
    lng: number;
    heading: number | null;
    courseDeg: number | null;
    accuracy?: number;
  } | null>(null);
  const lastHeadingEmit = useRef(0);

  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const viewerUrl =
    typeof window !== "undefined" && roomId
      ? `${window.location.origin}${base}/v/${roomId}`
      : "";

  useJoinRoom(socket, roomId);

  useEffect(() => {
    sharingActive.current = true;
    return () => {
      if (!sharingActive.current || !roomId) return;
      const s = socketRef.current;
      if (s?.connected) {
        s.emit("stop-sharing", { roomId });
      }
    };
  }, [roomId]);

  const socketRef = useRef(socket);
  socketRef.current = socket;
  const deviceHeadingRef = useRef(deviceHeading);
  deviceHeadingRef.current = deviceHeading;

  const emitLocation = (payload: NonNullable<typeof lastGeoPayload.current>, reliable = false) => {
    if (!roomId || !sharingActive.current) return;
    lastGeoPayload.current = payload;
    const s = socketRef.current;
    if (!s) return;
    if (!s.connected) {
      s.connect();
      return;
    }
    const body = { roomId, ...payload };
    if (!reliable) {
      s.emit("location", body);
      return;
    }
    s.timeout(8_000).emit("location", body, (err: unknown) => {
      if (!err || !sharingActive.current) return;
      if (s.connected) s.disconnect();
      s.connect();
    });
  };

  function stopSharing() {
    sharingActive.current = false;
    const s = socketRef.current;
    if (roomId && s?.connected) {
      s.emit("stop-sharing", { roomId });
    }
    navigate("/");
  }

  useEffect(() => {
    if (!socket || !roomId) return;
    const flushPendingLocation = () => {
      const payload = lastGeoPayload.current;
      if (!payload) return;
      emitLocation(payload);
    };
    socket.on("connect", flushPendingLocation);
    flushPendingLocation();
    return () => {
      socket.off("connect", flushPendingLocation);
    };
  }, [socket, roomId]);

  useEffect(() => {
    if (!roomId) return;

    if (!navigator.geolocation) {
      setGeoErr("Ubicación no disponible en este navegador.");
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
        if (!sharingActive.current) return;
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
      if (!sharingActive.current) return;
      const payload = lastGeoPayload.current;
      if (!payload) return;
      const heading = deviceHeadingRef.current ?? payload.heading;
      lastEmit.current.t = Date.now();
      emitLocation({ ...payload, heading }, true);
    }, HEARTBEAT_MS);

    return () => {
      navigator.geolocation.clearWatch(watchId);
      window.clearInterval(heartbeatId);
    };
  }, [roomId, geoRetryToken]);

  useEffect(() => {
    if (deviceHeading == null || !roomId || !sharingActive.current) return;
    const base = lastGeoPayload.current;
    if (!base) return;
    const now = Date.now();
    const prev = base.heading;
    const turned = prev == null || smallestAngleDelta(prev, deviceHeading) >= HEADING_EMIT_DEG;
    if (!turned || now - lastHeadingEmit.current < HEADING_EMIT_MS) return;
    lastHeadingEmit.current = now;
    emitLocation({ ...base, heading: deviceHeading });
  }, [deviceHeading, roomId]);

  async function copyLink() {
    if (!viewerUrl) return;
    try {
      await navigator.clipboard.writeText(viewerUrl);
      setCopyOk(true);
    } catch {
      const input = linkInputRef.current;
      if (input) {
        input.focus();
        input.select();
      }
      setCopyOk(false);
    }
    window.setTimeout(() => setCopyOk(false), 2000);
  }

  const displayBearing = deviceHeading ?? movementBearing ?? heading;

  return (
    <div className="layout">
      <div className="row" style={{ marginBottom: "1rem", justifyContent: "space-between" }}>
        <Link to="/" className="secondary" style={{ textDecoration: "none" }}>
          ← Inicio
        </Link>
        <button type="button" className="secondary" onClick={stopSharing}>
          Dejar de compartir
        </button>
      </div>

      <h1 style={{ fontSize: "1.2rem", fontWeight: 600, marginTop: 0 }}>Compartiendo</h1>

      {connectionError ? (
        <p style={{ color: "var(--danger)", marginBottom: "1rem" }} role="alert">
          {connectionError}
        </p>
      ) : null}

      <div className="card" style={{ marginBottom: "1rem" }}>
        <div className="row">
          <input
            ref={linkInputRef}
            className="input-code"
            style={{ flex: 1, minWidth: 0 }}
            readOnly
            value={viewerUrl}
            aria-label="Enlace para seguir"
          />
          <button type="button" onClick={copyLink} disabled={!viewerUrl}>
            {copyOk ? "Copiado" : "Copiar enlace"}
          </button>
        </div>
      </div>

      {geoErr ? (
        <div className="card" style={{ marginBottom: "1rem", borderColor: "#5c3d3d" }} role="alert">
          <p style={{ color: "var(--danger)", marginTop: 0 }}>{geoErr}</p>
          <button type="button" className="secondary" onClick={() => setGeoRetryToken((n) => n + 1)}>
            Reintentar
          </button>
        </div>
      ) : !pos ? (
        <p className="muted">Obteniendo ubicación…</p>
      ) : null}

      {pos ? (
        <div className="card" style={{ marginBottom: "1rem" }}>
          <CompassRose bearingDeg={displayBearing} compact />
          {needsPermission ? (
            <button
              type="button"
              className="secondary"
              style={{ marginTop: "0.75rem" }}
              onClick={() => void requestPermission()}
            >
              Activar brújula
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
