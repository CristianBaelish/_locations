import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useSocket } from "../hooks/useSocket";
import { useJoinRoom } from "../hooks/useJoinRoom";
import { StreetFollowView, type LatLng } from "../components/StreetFollowView";
import { ViewerContextPanel } from "../components/ViewerContextPanel";
import { CompassRose } from "../components/CompassRose";

type UpdatePayload = {
  lat: number;
  lng: number;
  heading?: number;
  courseDeg?: number;
  t?: number;
};

export function View() {
  const { roomId } = useParams<{ roomId: string }>();
  const socket = useSocket();
  const [pos, setPos] = useState<LatLng | null>(null);
  const [heading, setHeading] = useState<number | null>(null);
  const [courseDeg, setCourseDeg] = useState<number | null>(null);
  const [waiting, setWaiting] = useState(true);

  useJoinRoom(socket, roomId);

  useEffect(() => {
    if (!socket || !roomId) return;

    const onUpdate = (p: UpdatePayload) => {
      setWaiting(false);
      setPos({ lat: p.lat, lng: p.lng });
      if (p.heading != null && Number.isFinite(p.heading)) {
        setHeading(p.heading);
      }
      if (p.courseDeg != null && Number.isFinite(p.courseDeg)) {
        setCourseDeg(p.courseDeg);
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

      {waiting ? <p className="muted">Esperando la primera ubicación…</p> : null}

      <ViewerContextPanel sharerPos={pos} />

      {pos ? (
        <div className="card" style={{ marginBottom: "1rem" }}>
          <CompassRose
            bearingDeg={courseDeg ?? heading}
            caption={
              courseDeg != null
                ? "Rumbo según trayectoria reciente de quien comparte"
                : heading != null
                  ? "Orientación del dispositivo de quien comparte"
                  : "Aún sin rumbo por trayectoria (necesita moverse un poco)"
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
