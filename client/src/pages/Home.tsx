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
import { WarmStatus } from "../components/WarmStatus";

const ROOM_ID_RE = /^[A-Za-z0-9_-]{6,64}$/;

function roomIdFromInput(raw: string): string {
  const trimmed = raw.trim();
  const fromPath = (path: string) => {
    const match = path.match(/\/(?:v|s)\/([^/?#]+)/);
    if (!match) return null;
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return match[1];
    }
  };
  try {
    const url = new URL(trimmed);
    return fromPath(url.pathname) ?? trimmed;
  } catch {
    return fromPath(trimmed) ?? trimmed;
  }
}

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
      let data: { roomId?: string };
      try {
        data = JSON.parse(res.text) as { roomId?: string };
      } catch {
        throw new Error("Respuesta inválida del servidor.");
      }
      if (!data.roomId) throw new Error("Respuesta inválida del servidor.");
      navigate(`/s/${data.roomId}`);
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
    const id = roomIdFromInput(code);
    if (!id) {
      setErr("Ingresá un código de sesión.");
      return;
    }
    if (!ROOM_ID_RE.test(id)) {
      setErr("El código no es válido.");
      return;
    }
    navigate(`/v/${id}`);
  }

  return (
    <div className="layout">
      <header className="hero">
        <p className="eyebrow">En vivo</p>
        <h1>Compartí el lugar donde estás</h1>
        <p className="lede">Quien tenga el enlace ve la calle, el clima y hacia dónde vas.</p>
      </header>

      {err ? (
        <p className="note note-alert" role="alert">
          {err}
        </p>
      ) : null}

      <div className="card">
        <h2>Compartir</h2>
        {busy ? (
          <WarmStatus
            title="Abriendo tu sesión"
            detail="No se trabó. Si el servidor estaba dormido, el primer intento puede tardar un minuto."
            trackTime
          />
        ) : (
          <button type="button" onClick={startSharing}>
            Compartir mi ubicación
          </button>
        )}
      </div>

      <div className="card">
        <h2>Seguir a alguien</h2>
        <p className="muted">Pegá el enlace o el código que te pasaron.</p>
        <div className="row">
          <input
            className="input-code"
            placeholder="Código o enlace"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && joinViewer()}
            aria-label="Código de sesión"
            disabled={busy}
          />
          <button type="button" className="secondary" onClick={joinViewer} disabled={busy}>
            Entrar
          </button>
        </div>
      </div>

      <InstallAppHint />
    </div>
  );
}
