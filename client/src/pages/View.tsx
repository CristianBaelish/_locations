import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useSocket } from "../hooks/useSocket";
import { useJoinRoom } from "../hooks/useJoinRoom";
import { StreetFollowView, type LatLng } from "../components/StreetFollowView";
import { ViewerContextPanel } from "../components/ViewerContextPanel";
import { CompassRose } from "../components/CompassRose";
import { SyncStatus } from "../components/SyncStatus";

type UpdatePayload = {
  lat: number;
  lng: number;
  heading?: number | null;
  courseDeg?: number | null;
  t?: number;
};

export function View() {
  const { roomId } = useParams<{ roomId: string }>();
  const { socket, connected, connectionError } = useSocket();
  const [pos, setPos] = useState<LatLng | null>(null);
  const [heading, setHeading] = useState<number | null>(null);
  const [courseDeg, setCourseDeg] = useState<number | null>(null);
  const [waiting, setWaiting] = useState(true);
  const [lastReceivedAt, setLastReceivedAt] = useState<number | null>(null);

  useJoinRoom(socket, roomId);

  useEffect(() => {
    if (!socket || !roomId) return;

    const onUpdate = (p: UpdatePayload) => {
      setWaiting(false);
      setLastReceivedAt(Date.now());
      setPos({ lat: p.lat, lng: p.lng });
      if ("heading" in p) {
        setHeading(p.heading != null && Number.isFinite(p.heading) ? p.heading : null);
      }
      if ("courseDeg" in p) {
        setCourseDeg(p.courseDeg != null && Number.isFinite(p.courseDeg) ? p.courseDeg : null);
      }
    };

    socket.on("location-update", onUpdate);
    return () => {
      socket.off("location-update", onUpdate);
    };
  }, [socket, roomId]);

  return (
    <div className="layout layout-wide">
      <div className="row" style={{ marginBottom: "1rem" }}>
        <Link to="/" className="secondary" style={{ textDecoration: "none" }}>
          ← Inicio
        </Link>
      </div>

      <h1 style={{ fontSize: "1.2rem", fontWeight: 600, marginTop: 0 }}>Siguiendo</h1>
      <p className="muted">
        Sesión: <code>{roomId}</code>
      </p>

      <SyncStatus connected={connected} role="view" lastReceivedAt={lastReceivedAt} />

      {connectionError ? (
        <p style={{ color: "var(--danger)", marginBottom: "1rem" }} role="alert">
          {connectionError}
        </p>
      ) : null}

      {waiting && connected && !connectionError ? (
        <p className="muted">
          Conectado al servidor. Esperando la primera ubicación de quien comparte (debe tener abierta la página
          «Compartiendo» con el mismo código <code>{roomId}</code>).
        </p>
      ) : null}
      {waiting && !connected && !connectionError ? (
        <p className="muted">Conectando al servidor de sincronización…</p>
      ) : null}

      <ViewerContextPanel sharerPos={pos} />

      {pos ? (
        <div className="card" style={{ marginBottom: "1rem" }}>
          <CompassRose
            bearingDeg={heading ?? courseDeg}
            caption={
              heading != null
                ? "Brújula del dispositivo de quien comparte"
                : courseDeg != null
                  ? "Rumbo según trayectoria reciente de quien comparte"
                  : "Aún sin rumbo (quien comparte puede activar la brújula o moverse un poco)"
            }
            compact
          />
        </div>
      ) : null}

      <StreetFollowView
        position={pos}
        headingDeg={heading}
        courseDeg={courseDeg}
        positionSource="remote"
        layout="viewer"
      />
    </div>
  );
}
