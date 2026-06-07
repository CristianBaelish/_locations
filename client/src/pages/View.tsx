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
  heading?: number | null;
  courseDeg?: number | null;
  t?: number;
};

export function View() {
  const { roomId } = useParams<{ roomId: string }>();
  const { socket, connectionError } = useSocket();
  const [pos, setPos] = useState<LatLng | null>(null);
  const [heading, setHeading] = useState<number | null>(null);
  const [courseDeg, setCourseDeg] = useState<number | null>(null);
  const [waiting, setWaiting] = useState(true);
  const [ended, setEnded] = useState(false);

  useJoinRoom(socket, roomId);

  useEffect(() => {
    if (!socket || !roomId) return;

    const onUpdate = (p: UpdatePayload) => {
      setEnded(false);
      setWaiting(false);
      setPos({ lat: p.lat, lng: p.lng });
      if ("heading" in p) {
        setHeading(p.heading != null && Number.isFinite(p.heading) ? p.heading : null);
      }
      if ("courseDeg" in p) {
        setCourseDeg(p.courseDeg != null && Number.isFinite(p.courseDeg) ? p.courseDeg : null);
      }
    };

    const onEnded = () => {
      setEnded(true);
      setWaiting(false);
      setPos(null);
      setHeading(null);
      setCourseDeg(null);
    };

    socket.on("location-update", onUpdate);
    socket.on("sharing-ended", onEnded);
    return () => {
      socket.off("location-update", onUpdate);
      socket.off("sharing-ended", onEnded);
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

      {connectionError ? (
        <p style={{ color: "var(--danger)", marginBottom: "1rem" }} role="alert">
          {connectionError}
        </p>
      ) : null}

      {ended ? <p className="muted">Sesión finalizada</p> : null}
      {waiting && !ended && !connectionError ? <p className="muted">Esperando ubicación…</p> : null}

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
    </div>
  );
}
