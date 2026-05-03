/**
 * Backend (Node en Render, etc.)
 *
 * - En **desarrollo** (`vite`): sin `VITE_API_ORIGIN`, rutas relativas `/api` y `/health` → proxy de Vite al puerto local.
 * - En **producción** (build): sin overrides, el cliente llama directo a `VITE_DEFAULT_RENDER_BACKEND` (Render).
 *   Así evitamos el proxy de Vercel (`vercel.json` rewrites): tiene tope ~2 min hacia orígenes externos y el
 *   cold start de Render gratis puede superarlo, dejando el wake sin cabeceras HTTP.
 * - Con `VITE_API_ORIGIN`: REST, `/health` y (vía `socketServerOrigin`) Socket.io usan esa base.
 * - `vercel.json` sigue siendo útil para previews o si alguien fuerza rutas relativas en otro despliegue.
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
 * Base para `fetch` / XHR al API REST.
 * En prod sin override → mismo host que Socket.io (`defaultRenderBackend`), no el origen de la página.
 */
export function apiBase(): string {
  const explicit = explicitBackendOrigin();
  if (explicit) return explicit;
  if (import.meta.env.PROD) return defaultRenderBackend();
  return "";
}

/**
 * Origen para Socket.io (siempre absoluto salvo dev + proxy de Vite).
 */
export function socketServerOrigin(): string | undefined {
  const explicit = explicitBackendOrigin();
  if (explicit) return explicit;
  if (import.meta.env.DEV) return undefined;
  if (typeof window !== "undefined") {
    const h = window.location.hostname;
    if (h === "localhost" || h === "127.0.0.1") return undefined;
  }
  return defaultRenderBackend();
}

/** URL absoluta de GET `/health` (wake de Render, enlace de diagnóstico). */
export function healthCheckUrl(): string {
  const o = explicitBackendOrigin();
  if (o) return `${o}/health`;
  if (import.meta.env.PROD) return `${defaultRenderBackend()}/health`;
  if (typeof window !== "undefined") return `${window.location.origin}/health`;
  return "/health";
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
