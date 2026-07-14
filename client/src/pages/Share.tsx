import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
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
import { useDeviceHeading } from "../hooks/useDeviceHeading";
import { apiBase } from "../lib/apiBase";
import { forgetShareToken, getShareToken } from "../lib/shareToken";

const MIN_INTERVAL_MS = 2000;
const MIN_MOVE_M = 5;
const MIN_COURSE_M = 3;
const MIN_UI_COURSE_M = 2;

const isMobile =
  typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

function requestStopSharing(roomId: string, shareToken: string): void {
  const url = `${apiBase()}/api/rooms/${encodeURIComponent(roomId)}/stop`;
  const body = JSON.stringify({ shareToken });

  if (typeof navigator.sendBeacon === "function") {
    const sent = navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
    if (sent) return;
  }

  void fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body,
    keepalive: true,
  }).catch(() => {});
}

export function Share() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { socket, connectionError } = useSocket();
  const locationState = location.state as { shareToken?: unknown } | null;
  const shareToken =
    getShareToken(roomId) ??
    (typeof locationState?.shareToken === "string" ? locationState.shareToken : null);
  const { heading: deviceHeading, needsPermission, requestPermission } = useDeviceHeading();
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

  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const viewerUrl =
    typeof window !== "undefined" && roomId
      ? `${window.location.origin}${base}/v/${roomId}`
      : "";

  useJoinRoom(socket, roomId);

  useEffect(() => {
    sharingActive.current = true;
    return () => {
      if (!sharingActive.current || !roomId || !shareToken) return;
      notifyStopSharing(roomId, shareToken);
      forgetShareToken(roomId);
    };
  }, [roomId, shareToken]);

  const socketRef = useRef(socket);
  socketRef.current = socket;
  const deviceHeadingRef = useRef(deviceHeading);
  deviceHeadingRef.current = deviceHeading;

  const emitLocation = (payload: NonNullable<typeof lastGeoPayload.current>) => {
    if (!roomId || !shareToken || !sharingActive.current) return;
    lastGeoPayload.current = payload;
    const s = socketRef.current;
    if (s?.connected) {
      s.emit("location", { roomId, shareToken, ...payload });
    }
  };

  function notifyStopSharing(roomId: string, shareToken: string) {
    const s = socketRef.current;
    if (s?.connected) {
      s.emit("stop-sharing", { roomId, shareToken });
    }
    requestStopSharing(roomId, shareToken);
  }

  function stopSharing() {
    sharingActive.current = false;
    if (roomId && shareToken) {
      notifyStopSharing(roomId, shareToken);
    }
    forgetShareToken(roomId);
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
  }, [socket, roomId, shareToken]);

  useEffect(() => {
    if (!roomId) return;

    if (!shareToken) {
      setGeoErr("No se pudo validar esta sesión. Volvé a crear el enlace para compartir.");
      return;
    }

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
  }, [roomId, shareToken, geoRetryToken]);

  useEffect(() => {
    if (
      deviceHeading == null ||
      !lastGeoPayload.current ||
      !roomId ||
      !shareToken ||
      !sharingActive.current
    ) {
      return;
    }
    const id = window.setTimeout(() => {
      const base = lastGeoPayload.current;
      if (!base) return;
      const payload = { ...base, heading: deviceHeading };
      lastGeoPayload.current = payload;
      emitLocation(payload);
    }, 400);
    return () => window.clearTimeout(id);
  }, [deviceHeading, roomId, shareToken]);

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
          <input className="input-code" style={{ flex: 1, minWidth: 0 }} readOnly value={viewerUrl} />
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
