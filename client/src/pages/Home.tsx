import { useNavigate } from "react-router-dom";
import { useState } from "react";
import {
  apiBase,
  CREATE_ROOM_COLD_TIMEOUT_MS,
  CREATE_ROOM_RETRY_GAP_MS,
  CREATE_ROOM_TIMEOUT_MS,
} from "../lib/apiBase";
import { xhrPost } from "../lib/xhrRequest";
import { InstallAppHint } from "../components/InstallAppHint";

function isAbortError(e: unknown): boolean {
  return (
    (typeof DOMException !== "undefined" &&
      e instanceof DOMException &&
      e.name === "AbortError") ||
    (e instanceof Error && e.name === "AbortError")
  );
}

export function Home() {
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function startSharing() {
    setBusy(true);
    setErr(null);
    const url = `${apiBase()}/api/rooms`;
    try {
      const postOnce = (timeoutMs: number) => xhrPost(url, timeoutMs);

      let res: Awaited<ReturnType<typeof xhrPost>>;
      try {
        res = await postOnce(CREATE_ROOM_COLD_TIMEOUT_MS);
      } catch (e) {
        if (!isAbortError(e)) throw e;
        await new Promise((r) => window.setTimeout(r, CREATE_ROOM_RETRY_GAP_MS));
        try {
          res = await postOnce(CREATE_ROOM_TIMEOUT_MS);
        } catch (e2) {
          if (!isAbortError(e2)) throw e2;
          await new Promise((r) => window.setTimeout(r, CREATE_ROOM_RETRY_GAP_MS));
          res = await postOnce(CREATE_ROOM_TIMEOUT_MS);
        }
      }

      if (!res.ok) {
        throw new Error("No se pudo crear la sesión.");
      }
      let data: { roomId?: string; shareToken?: string };
      try {
        data = JSON.parse(res.text) as { roomId?: string; shareToken?: string };
      } catch {
        throw new Error("Respuesta inválida del servidor.");
      }
      if (!data.roomId || !data.shareToken) throw new Error("Respuesta inválida del servidor.");
      try {
        window.sessionStorage.setItem(`shareToken:${data.roomId}`, data.shareToken);
      } catch {
        // La URL de la pantalla de compartir también lleva el token por si sessionStorage no está disponible.
      }
      navigate(`/s/${data.roomId}?shareToken=${encodeURIComponent(data.shareToken)}`);
    } catch (e) {
      let msg = "No se pudo crear la sesión.";
      if (isAbortError(e)) {
        msg = "La conexión tardó demasiado. Reintentá.";
      } else if (e instanceof Error && e.message) {
        msg = e.message;
      }
      setErr(msg);
    } finally {
      setBusy(false);
    }
  }

  function joinViewer() {
    const id = code.trim();
    if (!id) {
      setErr("Ingresá un código de sesión.");
      return;
    }
    navigate(`/v/${id}`);
  }

  return (
    <div className="layout">
      <h1 style={{ fontSize: "1.35rem", fontWeight: 600, marginTop: 0 }}>
        Ubicación en vivo
      </h1>

      {err ? (
        <p style={{ color: "var(--danger)" }} role="alert">
          {err}
        </p>
      ) : null}

      <div className="card" style={{ marginTop: "1rem" }}>
        <h2 style={{ fontSize: "1rem", marginTop: 0 }}>Compartir</h2>
        <button type="button" onClick={startSharing} disabled={busy} aria-busy={busy}>
          {busy ? "Creando sesión…" : "Empezar a compartir"}
        </button>
      </div>

      <div className="card" style={{ marginTop: "1rem" }}>
        <h2 style={{ fontSize: "1rem", marginTop: 0 }}>Seguir</h2>
        <div className="row">
          <input
            className="input-code"
            placeholder="Código de sesión"
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
