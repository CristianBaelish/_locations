/**
 * Backend (Node en Render, etc.)
 *
 * - Sin `VITE_API_ORIGIN`: el cliente usa rutas relativas `/api` y `/health` — **mismo origen que la página**
 *   (p. ej. `https://locationspov.vercel.app/api/...`). Vercel reescribe eso a Render según `vercel.json`.
 * - Con `VITE_API_ORIGIN`: REST y comprobación de salud van a esa URL (override explícito).
 * - Socket.io no puede usar el mismo truco que un GET; si no hay override, en producción conecta al host
 *   de `VITE_DEFAULT_RENDER_BACKEND` (misma base que `destination` en `vercel.json`, ver `config/deploy-urls.json`).
 */
function defaultRenderBackend(): string {
  const v = import.meta.env.VITE_DEFAULT_RENDER_BACKEND;
  if (typeof v === "string" && v.trim().length > 0) {
    return v.trim().replace(/\/$/, "");
  }
  return "https://locationsbaelish.onrender.com";
}

/** URL del API solo si la definís en el build; si no, vacío = mismo origen que el HTML. */
export function explicitBackendOrigin(): string | undefined {
  const o = import.meta.env.VITE_API_ORIGIN;
  if (typeof o === "string" && o.trim().length > 0) {
    return o.trim().replace(/\/$/, "");
  }
  return undefined;
}

/**
 * Base para `fetch` al API REST.
 * Por defecto cadena vacía → `fetch("/api/...")` respecto a `locationspov.vercel.app` (o el dominio que uses).
 */
export function apiBase(): string {
  return explicitBackendOrigin() ?? "";
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

/** `/health` en el mismo sitio que la app, o en el backend explícito. */
export function healthCheckUrl(): string {
  const o = explicitBackendOrigin();
  if (o) return `${o}/health`;
  if (typeof window !== "undefined") return `${window.location.origin}/health`;
  return "/health";
}

const DEFAULT_FETCH_TIMEOUT_MS = 45_000;

/** GET /health antes del POST para “despertar” Render gratis (el primer request suele ser el más lento). */
export const HEALTH_WAKE_TIMEOUT_MS = 180_000;

/** Tras el wake, crear sala (segundo request ya en proceso caliente). */
export const CREATE_ROOM_TIMEOUT_MS = 90_000;

/** Pausa entre reintentos tras un timeout (AbortError) en el POST. */
export const CREATE_ROOM_RETRY_GAP_MS = 2000;

/** Peor caso aprox. para la barra de progreso: wake + 2×POST + pausa. */
export function createRoomWorstCaseMs(): number {
  return HEALTH_WAKE_TIMEOUT_MS + CREATE_ROOM_TIMEOUT_MS * 2 + CREATE_ROOM_RETRY_GAP_MS;
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
