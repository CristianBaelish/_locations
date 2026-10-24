import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useSocket } from "../hooks/useSocket";
import { useJoinRoom } from "../hooks/useJoinRoom";
import { StreetFollowView } from "../components/StreetFollowView";
import { ViewerContextPanel } from "../components/ViewerContextPanel";
import { CompassRose } from "../components/CompassRose";
import { apiBase, fetchWithTimeout } from "../lib/apiBase";
import {
  applyLiveFix,
  applyLocationMiss,
  applySharingEnded,
  initialViewerLocationState,
  type LiveFix,
  type ViewerLocationState,
} from "../lib/viewerLocation";

export function View() {
  const { roomId } = useParams<{ roomId: string }>();
  const { socket, connectionError } = useSocket();
  const locRef = useRef<ViewerLocationState>(initialViewerLocationState());
  const [loc, setLoc] = useState(locRef.current);
  const [now, setNow] = useState(() => Date.now());

  const commit = useCallback((next: ViewerLocationState) => {
    if (next === locRef.current) return;
    locRef.current = next;
    setLoc(next);
  }, []);

  useJoinRoom(socket, roomId);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!socket || !roomId) return;

    const onUpdate = (p: LiveFix) => {
      commit(applyLiveFix(locRef.current, p, Date.now()));
    };

    const onEnded = () => {
      commit(applySharingEnded(locRef.current));
    };

    socket.on("location-update", onUpdate);
    socket.on("sharing-ended", onEnded);
    return () => {
      socket.off("location-update", onUpdate);
      socket.off("sharing-ended", onEnded);
    };
  }, [socket, roomId, commit]);

  useEffect(() => {
    if (!roomId) return;
    let cancelled = false;
    let inflight = false;

    const pull = () => {
      if (cancelled || inflight) return;
      inflight = true;
      const seqAtStart = locRef.current.seq;
      const root = apiBase();
      const url = `${root}/api/rooms/${encodeURIComponent(roomId)}/location`;
      void fetchWithTimeout(url, { timeoutMs: 8_000, cache: "no-store" })
        .then(async (res) => {
          if (cancelled) return;
          if (res.status === 204) {
            commit(applyLocationMiss(locRef.current, seqAtStart));
            return;
          }
          if (!res.ok) return;
          const data = (await res.json()) as LiveFix;
          if (cancelled) return;
          commit(applyLiveFix(locRef.current, data, Date.now()));
        })
        .catch(() => {
          /* el socket puede seguir vivo */
        })
        .finally(() => {
          inflight = false;
        });
    };

    pull();
    const id = window.setInterval(pull, 4_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [roomId, commit]);

  return (
    <div className="layout layout-wide">
      <div className="row" style={{ marginBottom: "1rem" }}>
        <Link to="/" className="secondary" style={{ textDecoration: "none" }}>
          ← Inicio
        </Link>
      </div>

      <h1 style={{ fontSize: "1.2rem", fontWeight: 600, marginTop: 0 }}>Siguiendo</h1>
      {loc.receivedAt != null && !loc.ended ? (
        <p
          className="muted"
          style={{
            marginTop: "-0.25rem",
            color: now - loc.receivedAt > 20_000 ? "var(--danger)" : undefined,
          }}
        >
          {now - loc.receivedAt > 20_000
            ? "Sin actualización reciente. Reintentando…"
            : `Ubicación de hace ${Math.max(0, Math.round((now - loc.receivedAt) / 1000))} s`}
        </p>
      ) : null}

      {connectionError ? (
        <p style={{ color: "var(--danger)", marginBottom: "1rem" }} role="alert">
          {connectionError}
        </p>
      ) : null}

      {loc.ended ? <p className="muted">Sesión finalizada</p> : null}
      {loc.waiting && !loc.ended && !connectionError ? (
        <p className="muted">Esperando ubicación…</p>
      ) : null}

      <ViewerContextPanel sharerPos={loc.pos} />

      {loc.pos ? (
        <div className="card" style={{ marginBottom: "1rem" }}>
          <CompassRose bearingDeg={loc.heading ?? loc.courseDeg} compact />
        </div>
      ) : null}

      <StreetFollowView
        position={loc.pos}
        headingDeg={loc.heading}
        courseDeg={loc.courseDeg}
        positionSource="remote"
        layout="viewer"
      />
    </div>
  );
}
