/**
 * Backend (Node en Render), visto desde el navegador:
 *
 * - Sin `VITE_API_ORIGIN`: REST y `/health` van por **mismo origen**. En builds de Vercel, Socket.io va
 *   directo a Render (`VITE_DEFAULT_RENDER_BACKEND`) porque el proxy WebSocket de Vercel suele fallar.
 *   En builds servidos por Render (API + SPA en el mismo host), Socket.io queda en mismo origen.
 * - `VITE_DEFAULT_RENDER_BACKEND` / fallback: solo para SSR sin `window`, tests, o enlaces absolutos de respaldo.
 * - Con `VITE_API_ORIGIN`: todo va a esa URL explícita.
 *
 * Nota: el proxy de Vercel hacia Render tiene tope ~2 min; el cold start gratis puede superarlo (reintentá).
 */
function defaultRenderBackend(): string {
  const v = import.meta.env.VITE_DEFAULT_RENDER_BACKEND;
  if (typeof v === "string" && v.trim().length > 0) {
    return v.trim().replace(/\/$/, "");
  }
  return "https://locationsbaelish.onrender.com";
}

/** Override explícito de la URL del API (si no, en prod se usa `defaultRenderBackend`). */
export function explicitBackendOrigin(): string | undefined {
  const o = import.meta.env.VITE_API_ORIGIN;
  if (typeof o === "string" && o.trim().length > 0) {
    return o.trim().replace(/\/$/, "");
  }
  return undefined;
}

/**
 * Base para `fetch` / XHR al API REST (vacío = mismo origen: Vite o Vercel resuelven Render).
 */
export function apiBase(): string {
  const explicit = explicitBackendOrigin();
  if (explicit) return explicit;
  if (typeof window !== "undefined") return "";
  if (import.meta.env.PROD) return defaultRenderBackend();
  return "";
}

/**
 * Origen para Socket.io: en Vercel, **Render directo**; en Render all-in-one y dev/preview local, mismo
 * origen (`undefined`).
 */
export function socketServerOrigin(): string | undefined {
  const explicit = explicitBackendOrigin();
  if (explicit) return explicit;
  if (import.meta.env.DEV) return undefined;
  if (typeof window !== "undefined") {
    const h = window.location.hostname;
    if (h === "localhost" || h === "127.0.0.1") return undefined;
    if (/^192\.168\.\d+\.\d+$/.test(h)) return undefined;
  }
  if (import.meta.env.VITE_BUILT_ON_VERCEL !== "1") return undefined;
  return defaultRenderBackend();
}

/** URL de GET `/health` (mismo origen que la app si hay `window`, para no depender del DNS a onrender.com). */
export function healthCheckUrl(): string {
  const o = explicitBackendOrigin();
  if (o) return `${o}/health`;
  if (typeof window !== "undefined") return `${window.location.origin}/health`;
  return `${defaultRenderBackend()}/health`;
}

const DEFAULT_FETCH_TIMEOUT_MS = 45_000;

/**
 * Primer POST /api/rooms: una sola conexión hasta respuesta — cubre cold start de Render sin “GET /health”
 * que agota el timeout justo antes de que el proceso termine de levantar (dos fases en serie eran frágiles).
 */
export const CREATE_ROOM_COLD_TIMEOUT_MS = 600_000;

/** Reintentos tras cold post (servidor ya debería estar arriba). */
export const CREATE_ROOM_TIMEOUT_MS = 120_000;

/** Pausa entre reintentos tras un timeout (AbortError). */
export const CREATE_ROOM_RETRY_GAP_MS = 2000;

/** Peor caso aprox. para la barra de progreso: cold POST + 2×POST templado + pausas. */
export function createRoomWorstCaseMs(): number {
  return (
    CREATE_ROOM_COLD_TIMEOUT_MS +
    CREATE_ROOM_RETRY_GAP_MS +
    CREATE_ROOM_TIMEOUT_MS * 2 +
    CREATE_ROOM_RETRY_GAP_MS * 2
  );
}

/** `fetch` con tope de tiempo (Render asleep puede tardar; sin esto el botón queda en "Creando…" indefinidamente). */
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<Response> {
  const { timeoutMs = DEFAULT_FETCH_TIMEOUT_MS, ...rest } = init;
  const ctrl = new AbortController();
  const id = window.setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(input, { ...rest, signal: ctrl.signal });
  } finally {
    window.clearTimeout(id);
  }
}
