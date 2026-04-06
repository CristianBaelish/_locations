import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { apiBase } from "../lib/apiBase";
import { InstallAppHint } from "../components/InstallAppHint";

export function Home() {
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function startSharing() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`${apiBase()}/api/rooms`, { method: "POST" });
      if (!res.ok) throw new Error("No se pudo crear la sesión");
      const data = (await res.json()) as { roomId?: string };
      if (!data.roomId) throw new Error("Respuesta inválida");
      navigate(`/s/${data.roomId}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  function joinViewer() {
    const id = code.trim();
    if (!id) {
      setErr("Escribe un código o pega el ID del enlace.");
      return;
    }
    navigate(`/v/${id}`);
  }

  return (
    <div className="layout">
      <h1 style={{ fontSize: "1.35rem", fontWeight: 600, marginTop: 0 }}>
        Ubicación en vivo + vista de calle
      </h1>
      <p className="muted">
        Comparte tu posición; quien tenga el enlace verá el mapa y la vista de Street View más cercana
        (las imágenes pueden ser anteriores a hoy).
      </p>

      <div className="banner">
        Clave Google Maps (<code>VITE_GOOGLE_MAPS_API_KEY</code>): archivo <code>.env</code> en la{" "}
        <strong>raíz del proyecto</strong> o en <code>client/.env</code>. Tras cambiar el{" "}
        <code>.env</code>, reinicia <code>npm run dev</code>. El servidor de sincronización debe estar en
        marcha.
      </div>

      {err ? (
        <p style={{ color: "var(--danger)" }} role="alert">
          {err}
        </p>
      ) : null}

      <div className="card" style={{ marginTop: "1rem" }}>
        <h2 style={{ fontSize: "1rem", marginTop: 0 }}>Compartir recorrido</h2>
        <p className="muted">Genera un enlace y permite el GPS en el navegador.</p>
        <button type="button" onClick={startSharing} disabled={busy}>
          {busy ? "Creando…" : "Empezar a compartir"}
        </button>
      </div>

      <div className="card" style={{ marginTop: "1rem" }}>
        <h2 style={{ fontSize: "1rem", marginTop: 0 }}>Ver recorrido</h2>
        <p className="muted">Pega el código que te pasaron o el último segmento del enlace.</p>
        <div className="row">
          <input
            className="input-code"
            placeholder="ej. xYz12abCde"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && joinViewer()}
            aria-label="Código de sesión"
          />
          <button type="button" className="secondary" onClick={joinViewer}>
            Entrar
          </button>
        </div>
      </div>

      <InstallAppHint />
    </div>
  );
}
