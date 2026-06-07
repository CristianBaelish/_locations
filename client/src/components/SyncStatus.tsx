type Props = {
  connected: boolean;
  role: "share" | "view";
  lastSentAt?: number | null;
  lastReceivedAt?: number | null;
  peers?: number | null;
};

function ago(ms: number | null | undefined): string | null {
  if (ms == null) return null;
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 5) return "ahora";
  if (s < 60) return `hace ${s} s`;
  return `hace ${Math.floor(s / 60)} min`;
}

export function SyncStatus({ connected, role, lastSentAt, lastReceivedAt, peers }: Props) {
  const sentAgo = role === "share" ? ago(lastSentAt) : null;
  const recvAgo = role === "view" ? ago(lastReceivedAt) : null;

  return (
    <div
      className="card"
      style={{
        marginBottom: "1rem",
        padding: "0.65rem 0.85rem",
        borderColor: connected ? "#2d4a3e" : "#5c3d3d",
      }}
      role="status"
    >
      <div style={{ fontSize: "0.88rem" }}>
        <strong>Sincronización:</strong>{" "}
        {connected ? (
          <span style={{ color: "#6ee7b7" }}>conectada</span>
        ) : (
          <span style={{ color: "var(--danger)" }}>sin conexión al servidor</span>
        )}
      </div>
      {role === "share" ? (
        <p className="muted" style={{ margin: "0.35rem 0 0", fontSize: "0.82rem" }}>
          {connected
            ? lastSentAt
              ? `Última ubicación enviada ${sentAgo}.`
              : "GPS listo pero aún no se envió ubicación (esperando señal)."
            : "El mapa local funciona, pero nadie puede verte hasta que se restablezca la conexión."}
          {peers != null && peers > 1 ? ` ${peers - 1} persona(s) siguiendo la sesión.` : null}
        </p>
      ) : (
        <p className="muted" style={{ margin: "0.35rem 0 0", fontSize: "0.82rem" }}>
          {connected
            ? lastReceivedAt
              ? `Última posición recibida ${recvAgo}.`
              : "Conectado al servidor, esperando que quien comparte envíe GPS."
            : "Sin conexión: no se pueden recibir ubicaciones en vivo."}
        </p>
      )}
    </div>
  );
}
