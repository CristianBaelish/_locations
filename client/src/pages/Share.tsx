import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useSocket } from "../hooks/useSocket";
import { StreetFollowView, type LatLng } from "../components/StreetFollowView";
import { distanceMeters, initialBearingDeg, smallestAngleDelta } from "../lib/geo";
import { CompassRose } from "../components/CompassRose";
import { WarmStatus } from "../components/WarmStatus";
import {
  describeGeolocationError,
  isSecureContextForGeolocation,
  messageInsecureGeolocationContext,
} from "../lib/geoErrors";
import { useJoinRoom } from "../hooks/useJoinRoom";
import { useDeviceHeading } from "../hooks/useDeviceHeading";
import { apiBase, fetchWithTimeout } from "../lib/apiBase";
import { kickSocket, onPageResume } from "../lib/pageResume";
import { InstallAppHint } from "../components/InstallAppHint";

const MIN_INTERVAL_MS = 2000;
const HEARTBEAT_MS = 10_000;

function postStop(roomId: string) {
  const url = `${apiBase()}/api/rooms/${encodeURIComponent(roomId)}/stop`;
  void fetch(url, { method: "POST", keepalive: true, cache: "no-store" }).catch(() => {
    /* el socket también avisa el cierre */
  });
}
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
  const [resuming, setResuming] = useState(false);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [watchers, setWatchers] = useState<number | null>(null);
  const [sendOk, setSendOk] = useState(false);
  const canSend = typeof navigator !== "undefined" && typeof navigator.share === "function";

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
  const lastPostAt = useRef(0);

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
      postStop(roomId);
    };
  }, [roomId]);

  const socketRef = useRef(socket);
  socketRef.current = socket;
  const deviceHeadingRef = useRef(deviceHeading);
  deviceHeadingRef.current = deviceHeading;

  const postLocation = (payload: NonNullable<typeof lastGeoPayload.current>) => {
    if (!roomId) return;
    const url = `${apiBase()}/api/rooms/${encodeURIComponent(roomId)}/location`;
    void fetchWithTimeout(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      timeoutMs: 12_000,
      cache: "no-store",
    }).catch(() => {
      /* el socket puede seguir llevando la posición */
    });
  };

  const emitLocation = (payload: NonNullable<typeof lastGeoPayload.current>, reliable = false) => {
    if (!roomId || !sharingActive.current) return;
    lastGeoPayload.current = payload;
    const now = Date.now();
    if (reliable || now - lastPostAt.current >= 3_000) {
      lastPostAt.current = now;
      postLocation(payload);
    }
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
    if (roomId) {
      postStop(roomId);
      const s = socketRef.current;
      if (s?.connected) s.emit("stop-sharing", { roomId });
    }
    navigate("/");
  }

  useEffect(() => {
    if (!socket) return;
    const onStatus = (payload: { peers?: number }) => {
      if (typeof payload?.peers !== "number" || !Number.isFinite(payload.peers)) return;
      setWatchers(Math.max(0, payload.peers - 1));
    };
    socket.on("room-status", onStatus);
    return () => {
      socket.off("room-status", onStatus);
    };
  }, [socket]);

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
    let lastFixAt = Date.now();
    let cancelled = false;
    const UI_MIN_MS = 250;

    let denied = false;
    let hadFix = false;

    const onErr = (e: GeolocationPositionError) => {
      if (cancelled) return;
      if (e.code === e.PERMISSION_DENIED) denied = true;
      if (e.code === e.TIMEOUT) return;
      if (e.code === e.POSITION_UNAVAILABLE && hadFix) return;
      setGeoErr(describeGeolocationError(e));
    };

    const onPos = (p: GeolocationPosition) => {
      if (cancelled || !sharingActive.current) return;
      hadFix = true;
      lastFixAt = Date.now();
      setResuming(false);
      setGeoErr(null);
      setAccuracy(
        typeof p.coords.accuracy === "number" && Number.isFinite(p.coords.accuracy)
          ? p.coords.accuracy
          : null
      );
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
    };

    const watchId = navigator.geolocation.watchPosition(onPos, onErr, {
      enableHighAccuracy: isMobile,
      maximumAge: 5_000,
      timeout: 30_000,
    });

    const poke = () => {
      if (cancelled || document.visibilityState !== "visible") return;
      navigator.geolocation.getCurrentPosition(onPos, onErr, {
        enableHighAccuracy: isMobile,
        maximumAge: 0,
        timeout: 12_000,
      });
    };

    const stopResume = onPageResume(() => {
      if (cancelled) return;
      setResuming(true);
      const payload = lastGeoPayload.current;
      if (payload) postLocation(payload);
      kickSocket(socketRef.current);
      poke();
    });

    const heartbeatId = window.setInterval(() => {
      if (!sharingActive.current) return;
      const payload = lastGeoPayload.current;
      if (!payload) return;
      const heading = deviceHeadingRef.current ?? payload.heading;
      lastEmit.current.t = Date.now();
      emitLocation({ ...payload, heading }, true);
    }, HEARTBEAT_MS);

    let restartQueued = false;
    const watchdogId = window.setInterval(() => {
      if (cancelled || denied || !sharingActive.current || document.visibilityState !== "visible") return;
      const silent = Date.now() - lastFixAt;
      if (silent >= 10_000) poke();
      if (hadFix && silent >= 28_000 && !restartQueued) {
        restartQueued = true;
        setGeoRetryToken((n) => n + 1);
      }
    }, 8_000);

    return () => {
      cancelled = true;
      stopResume();
      navigator.geolocation.clearWatch(watchId);
      window.clearInterval(heartbeatId);
      window.clearInterval(watchdogId);
    };
  }, [roomId, geoRetryToken]);

  useEffect(() => {
    if (!roomId) return;
    let lock: { release: () => Promise<void> } | null = null;
    let stopped = false;
    const nav = navigator as Navigator & {
      wakeLock?: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> };
    };

    const acquire = () => {
      if (stopped || document.visibilityState !== "visible" || !nav.wakeLock) return;
      void nav.wakeLock
        .request("screen")
        .then((sentinel) => {
          if (stopped) {
            void sentinel.release();
            return;
          }
          lock = sentinel;
        })
        .catch(() => {
          /* el celular puede negar mantener la pantalla despierta */
        });
    };

    const onVis = () => {
      if (document.visibilityState === "visible") acquire();
    };

    acquire();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVis);
      void lock?.release();
    };
  }, [roomId]);

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

  async function sendLink() {
    if (!viewerUrl || !navigator.share) return;
    try {
      await navigator.share({
        title: "Seguime en vivo",
        text: "Mirá la calle donde estoy.",
        url: viewerUrl,
      });
      setSendOk(true);
      window.setTimeout(() => setSendOk(false), 2000);
    } catch {
      /* la persona canceló el envío */
    }
  }

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

      <h1 className="page-title">
        <span className="live-dot" aria-hidden="true" />
        Ya estás compartiendo
      </h1>
      <p className="muted" style={{ marginTop: "-0.25rem" }}>
        Dejá esta pantalla adelante, con el celular despierto. Si pasás a otra app o se apaga la pantalla, el
        enlace queda en el último lugar hasta que vuelvas.
      </p>
      {resuming ? (
        <p className="muted" role="status">
          Retomando la ubicación…
        </p>
      ) : null}

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
          {canSend ? (
            <button type="button" className="secondary" onClick={() => void sendLink()} disabled={!viewerUrl}>
              {sendOk ? "Listo" : "Enviar enlace"}
            </button>
          ) : null}
        </div>
        {watchers != null ? (
          <p className="muted" role="status" style={{ margin: "0.65rem 0 0" }}>
            {watchers === 0
              ? "Todavía nadie abrió el enlace."
              : watchers === 1
                ? "Hay alguien mirando."
                : `Hay ${watchers} personas mirando.`}
          </p>
        ) : null}
      </div>

      {geoErr ? (
        <div className="card card-alert" role="alert">
          <p style={{ color: "var(--danger)", marginTop: 0 }}>{geoErr}</p>
          <button type="button" className="secondary" onClick={() => setGeoRetryToken((n) => n + 1)}>
            Reintentar
          </button>
        </div>
      ) : !pos ? (
        <div className="card">
          <WarmStatus
            title="Buscando dónde estás"
            detail="Si el teléfono pregunta, aceptá la ubicación. Sin eso no podemos mostrar la calle."
            trackTime
          />
        </div>
      ) : null}

      {pos ? (
        <div className="card" style={{ marginBottom: "1rem" }}>
          <CompassRose bearingDeg={displayBearing} compact />
          {accuracy != null ? (
            <p className="muted" style={{ margin: "0.7rem 0 0" }}>
              {accuracy > 40
                ? `La señal está floja: el punto puede saltar unos ${Math.round(accuracy)} m.`
                : `Precisión de unos ${Math.round(accuracy)} m.`}
            </p>
          ) : null}
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

      <InstallAppHint />
    </div>
  );
}
