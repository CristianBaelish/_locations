import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import {
  apiBase,
  CREATE_ROOM_COLD_TIMEOUT_MS,
  CREATE_ROOM_RETRY_GAP_MS,
  CREATE_ROOM_TIMEOUT_MS,
  createRoomWorstCaseMs,
  healthCheckUrl,
} from "../lib/apiBase";
import { xhrPost } from "../lib/xhrRequest";
import { InstallAppHint } from "../components/InstallAppHint";
import { rememberShareToken } from "../lib/shareToken";

function isAbortError(e: unknown): boolean {
  return (
    (typeof DOMException !== "undefined" &&
      e instanceof DOMException &&
      e.name === "AbortError") ||
    (e instanceof Error && e.name === "AbortError")
  );
}

function formatMmSs(totalMs: number): string {
  const s = Math.max(0, Math.floor(totalMs / 1000));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function formatApproxMinutes(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60_000));
  return min === 1 ? "~1 min" : `~${min} min`;
}

export function Home() {
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [createElapsedMs, setCreateElapsedMs] = useState(0);
  /** readyState ≥ 2 en el POST /api/rooms: el servidor ya envió cabeceras HTTP. */
  const [createHeadersSeen, setCreateHeadersSeen] = useState(false);

  const createWorstMs = createRoomWorstCaseMs();

  useEffect(() => {
    if (!busy) {
      setCreateElapsedMs(0);
      return;
    }
    const started = Date.now();
    const id = window.setInterval(() => {
      setCreateElapsedMs(Date.now() - started);
    }, 400);
    return () => window.clearInterval(id);
  }, [busy]);

  async function startSharing() {
    setBusy(true);
    setCreateHeadersSeen(false);
    setErr(null);
    const base = apiBase();
    const url = `${base}/api/rooms`;
    try {
      if (import.meta.env.PROD && base.startsWith("http://")) {
        throw new Error(
          "VITE_API_ORIGIN debe usar https:// (página en Vercel es HTTPS; con http:// el navegador bloquea la petición)."
        );
      }

      const postOnce = (timeoutMs: number) =>
        xhrPost(url, timeoutMs, () => setCreateHeadersSeen(true));

      let res: Awaited<ReturnType<typeof xhrPost>>;
      try {
        res = await postOnce(CREATE_ROOM_COLD_TIMEOUT_MS);
      } catch (e) {
        if (!isAbortError(e)) throw e;
        setCreateHeadersSeen(false);
        await new Promise((r) => window.setTimeout(r, CREATE_ROOM_RETRY_GAP_MS));
        try {
          res = await postOnce(CREATE_ROOM_TIMEOUT_MS);
        } catch (e2) {
          if (!isAbortError(e2)) throw e2;
          setCreateHeadersSeen(false);
          await new Promise((r) => window.setTimeout(r, CREATE_ROOM_RETRY_GAP_MS));
          res = await postOnce(CREATE_ROOM_TIMEOUT_MS);
        }
      }

      if (!res.ok) {
        const snippet = res.text.slice(0, 120);
        throw new Error(
          `No se pudo crear la sesión (${res.status}). ${snippet ? `Respuesta: ${snippet}` : "Revisá que el servicio en Render esté en marcha y que config/deploy-urls.json (o VITE_DEFAULT_RENDER_BACKEND en Vercel) coincida con la URL del panel; o definí VITE_API_ORIGIN con https://… sin barra final." }`
        );
      }
      let data: { roomId?: string; shareToken?: string };
      try {
        data = JSON.parse(res.text) as { roomId?: string; shareToken?: string };
      } catch {
        throw new Error("Respuesta inválida del servidor (no es JSON).");
      }
      if (!data.roomId || !data.shareToken) throw new Error("Respuesta inválida del servidor");
      rememberShareToken(data.roomId, data.shareToken);
      navigate(`/s/${data.roomId}`, { state: { shareToken: data.shareToken } });
    } catch (e) {
      const noConn = `No hay conexión con el API (${url}). Probá ${healthCheckUrl()} en otra pestaña (debe verse la palabra ok).`;
      let msg: string;
      if (isAbortError(e)) {
        msg = `Tiempo de espera agotado (hasta ~${formatApproxMinutes(createWorstMs)} en el peor caso). En Render gratis el arranque en frío puede tardar mucho. Abrí ${healthCheckUrl()} en otra pestaña: tiene que verse ok. Si instalaste la app (PWA) o tenés el sitio abierto hace días, cerrá todas las pestañas y volvé a entrar para cargar la última versión del cliente.`;
      } else if (
        e instanceof TypeError &&
        String(e.message).includes("fetch")
      ) {
        msg = noConn;
      } else if (e instanceof Error && e.message.includes("Error de red")) {
        msg = noConn;
      } else if (e instanceof Error) {
        msg = e.message;
      } else {
        msg = "Error";
      }
      setErr(msg);
    } finally {
      setCreateHeadersSeen(false);
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
        Google Maps (<code>VITE_GOOGLE_MAPS_API_KEY</code>): en{" "}
        <strong>local</strong>, archivo <code>.env</code> en la raíz del repo o <code>client/.env</code> y
        reiniciá <code>npm run dev</code>. En <strong>Vercel</strong>, Project → Settings → Environment
        Variables (Production) y volvé a desplegar. El API de sincronización (Render u otro host) debe estar
        activo para crear sesiones y compartir ubicación.
      </div>

      {err ? (
        <p style={{ color: "var(--danger)" }} role="alert">
          {err}
        </p>
      ) : null}

      <div className="card" style={{ marginTop: "1rem" }}>
        <h2 style={{ fontSize: "1rem", marginTop: 0 }}>Compartir recorrido</h2>
        <p className="muted">Genera un enlace y permite el GPS en el navegador.</p>
        <button type="button" onClick={startSharing} disabled={busy} aria-busy={busy}>
          {busy ? `Creando sesión… ${formatMmSs(createElapsedMs)}` : "Empezar a compartir"}
        </button>
        {busy ? (
          <div style={{ marginTop: "0.65rem" }}>
            <div
              className="create-room-progress"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.min(100, Math.round((createElapsedMs / createWorstMs) * 100))}
              aria-label="Progreso aproximado de la petición al servidor"
            >
              <div
                style={{
                  width: `${Math.min(100, (createElapsedMs / createWorstMs) * 100)}%`,
                }}
              />
            </div>
            <p className="muted" style={{ marginTop: "0.5rem", marginBottom: 0, fontSize: "0.85rem" }}>
              {createHeadersSeen ? (
                <>
                  <strong>Servidor ya contestó</strong> (POST /api/rooms). Leyendo respuesta…{" "}
                </>
              ) : (
                <>
                  <strong>Sin respuesta HTTP todavía</strong> — el POST sale desde tu dominio en Vercel hacia Render
                  (sin GET /health previo). En plan gratis el cold start puede tardar varios minutos; no cierres la
                  pestaña. Si se corta ~2 min, puede ser el tope del proxy de Vercel: reintentá.{" "}
                </>
              )}
              {formatMmSs(createElapsedMs)} · tope aprox. total {formatMmSs(createWorstMs)}.
            </p>
            <p className="muted" style={{ marginTop: "0.35rem", marginBottom: 0, fontSize: "0.85rem" }}>
              <a href={healthCheckUrl()} target="_blank" rel="noreferrer">
                Abrir comprobación del API
              </a>{" "}
              en otra pestaña si querés ver si ya responde “ok”.
            </p>
          </div>
        ) : null}
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

      <p className="muted" style={{ fontSize: "0.82rem", marginTop: "1.25rem" }}>
        <strong>Si un enlace directo a <code>*.onrender.com</code> “carga para siempre”:</strong> puede ser el
        DNS del operador (p. ej. sufijo <code>.com.ar</code>). La app usa <strong>tu dominio en Vercel</strong>{" "}
        para API, <code>/health</code> y Socket.io; probá el botón de arriba o cambiá DNS a{" "}
        <strong>1.1.1.1</strong> / <strong>8.8.8.8</strong> si algo sigue fallando.
      </p>

      <p className="muted" style={{ fontSize: "0.82rem", marginTop: "1.25rem" }}>
        <strong>Si tarda, da error o ves 502 en /health:</strong> 502 en Render suele ser el proxy sin proceso
        detrás (deploy fallido, comando de arranque mal, o carpeta raíz incorrecta: tiene que ejecutarse{" "}
        <code>server</code> con <code>npm start</code> → <code>node src/index.js</code>). Revisá{" "}
        <em>Logs</em> y <em>Events</em> en Render. En plan gratis la primera petición tras inactividad puede
        tardar mucho. La URL del API debe coincidir con <code>vercel.json</code> y{" "}
        <code>config/deploy-urls.json</code>.
      </p>

      <InstallAppHint />
    </div>
  );
}
