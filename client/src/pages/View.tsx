import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useSocket } from "../hooks/useSocket";
import { useJoinRoom } from "../hooks/useJoinRoom";
import { StreetFollowView, type LatLng } from "../components/StreetFollowView";
import { ViewerContextPanel } from "../components/ViewerContextPanel";
import { CompassRose } from "../components/CompassRose";
import { WarmStatus } from "../components/WarmStatus";
import { apiBase, fetchWithTimeout } from "../lib/apiBase";
import { kickSocket, onPageResume } from "../lib/pageResume";

type UpdatePayload = {
  lat?: number;
  lng?: number;
  heading?: number | null;
  courseDeg?: number | null;
  t?: number;
  ended?: boolean;
};

export function View() {
  const { roomId } = useParams<{ roomId: string }>();
  const { socket, connectionError } = useSocket();
  const [pos, setPos] = useState<LatLng | null>(null);
  const [heading, setHeading] = useState<number | null>(null);
  const [courseDeg, setCourseDeg] = useState<number | null>(null);
  const [waiting, setWaiting] = useState(true);
  const [ended, setEnded] = useState(false);
  const [receivedAt, setReceivedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const lastStamp = useRef(0);
  const lastClientReceipt = useRef(0);
  const endedRef = useRef(false);
  const socketRef = useRef(socket);
  socketRef.current = socket;
  const pullRef = useRef<() => void>(() => {});
  const lastKick = useRef(0);

  useJoinRoom(socket, roomId, "viewer");

  function endSession() {
    endedRef.current = true;
    lastClientReceipt.current = 0;
    setEnded(true);
    setWaiting(false);
    setPos(null);
    setHeading(null);
    setCourseDeg(null);
    setReceivedAt(null);
  }

  function applyUpdate(p: UpdatePayload) {
    if (endedRef.current || p.ended) {
      if (p.ended) endSession();
      return;
    }
    if (typeof p.lat !== "number" || typeof p.lng !== "number") return;
    const stamp = typeof p.t === "number" && Number.isFinite(p.t) ? p.t : Date.now();
    if (stamp <= lastStamp.current) return;
    lastStamp.current = stamp;
    lastClientReceipt.current = Date.now();
    setWaiting(false);
    setReceivedAt(Date.now());
    setPos({ lat: p.lat, lng: p.lng });
    if ("heading" in p) {
      setHeading(p.heading != null && Number.isFinite(p.heading) ? p.heading : null);
    }
    if ("courseDeg" in p) {
      setCourseDeg(p.courseDeg != null && Number.isFinite(p.courseDeg) ? p.courseDeg : null);
    }
  }

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!socket || !roomId) return;

    const onUpdate = (p: UpdatePayload) => {
      applyUpdate(p);
    };

    const onEnded = () => {
      endSession();
    };

    socket.on("location-update", onUpdate);
    socket.on("sharing-ended", onEnded);
    return () => {
      socket.off("location-update", onUpdate);
      socket.off("sharing-ended", onEnded);
    };
  }, [socket, roomId]);

  useEffect(() => {
    if (!roomId) return;
    let cancelled = false;
    let inflight = false;

    const pull = () => {
      if (cancelled || inflight || endedRef.current) return;
      inflight = true;
      const root = apiBase();
      const url = `${root}/api/rooms/${encodeURIComponent(roomId)}/location`;
      void fetchWithTimeout(url, { timeoutMs: 8_000, cache: "no-store" })
        .then(async (res) => {
          if (cancelled || res.status === 204 || !res.ok) return;
          const data = (await res.json()) as UpdatePayload;
          if (data.ended) {
            endSession();
            return;
          }
          if (typeof data.lat !== "number" || typeof data.lng !== "number") return;
          applyUpdate(data);
        })
        .catch(() => {
          /* el socket puede seguir vivo */
        })
        .finally(() => {
          inflight = false;
        });
    };

    pullRef.current = pull;
    pull();
    const id = window.setInterval(pull, 4_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [roomId]);

  useEffect(() => {
    return onPageResume(() => {
      pullRef.current();
      lastKick.current = Date.now();
      kickSocket(socketRef.current);
    });
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState !== "visible" || endedRef.current) return;
      const seen = lastClientReceipt.current;
      if (seen <= 0 || Date.now() - seen < 22_000) return;
      const now = Date.now();
      if (now - lastKick.current < 15_000) return;
      lastKick.current = now;
      pullRef.current();
      kickSocket(socketRef.current);
    }, 5_000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="layout layout-wide">
      <div className="row" style={{ marginBottom: "1rem" }}>
        <Link to="/" className="secondary" style={{ textDecoration: "none" }}>
          ← Inicio
        </Link>
      </div>

      <h1 className="page-title">Estás siguiendo este recorrido</h1>
      {receivedAt != null && !ended ? (
        <p
          className="muted"
          style={{
            marginTop: "-0.25rem",
            color: now - receivedAt > 35_000 ? "var(--danger)" : undefined,
          }}
        >
          {now - receivedAt > 35_000
            ? "Quedó en el último lugar. Quien comparte tiene que volver a la app, con la pantalla despierta."
            : `Ubicación de hace ${Math.max(0, Math.round((now - receivedAt) / 1000))} s`}
        </p>
      ) : null}

      {connectionError ? (
        <p style={{ color: "var(--danger)", marginBottom: "1rem" }} role="alert">
          {connectionError}
        </p>
      ) : null}

      {ended ? <p className="muted">Sesión finalizada</p> : null}
      {waiting && !ended && !connectionError ? (
        <div className="card">
          <WarmStatus
            title="Esperando a quien comparte"
            detail="Cuando empiece a caminar, la calle aparece acá."
            trackTime
          />
        </div>
      ) : null}

      {ended ? null : (
        <>
          <ViewerContextPanel sharerPos={pos} />

          {pos ? (
            <div className="card" style={{ marginBottom: "1rem" }}>
              <CompassRose bearingDeg={heading ?? courseDeg} compact />
            </div>
          ) : null}

          <StreetFollowView
            position={pos}
            headingDeg={heading}
            courseDeg={courseDeg}
            positionSource="remote"
            layout="viewer"
          />
        </>
      )}
    </div>
  );
}
