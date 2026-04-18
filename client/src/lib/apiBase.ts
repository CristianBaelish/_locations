/**
 * Origen del backend Node (REST + Socket.io en Render u otro host).
 * - Dev sin env: `undefined` → el front usa rutas relativas `/api` (proxy de Vite).
 * - `VITE_API_ORIGIN`: URL sin barra final.
 * - Build en Vercel sin env: mismo host que el rewrite de `/api` en `vercel.json`.
 */
/** Mismo host que `destination` del rewrite `/api` en `vercel.json` (fallback si el build no inyectó `VERCEL=1`). */
const VERCEL_DEFAULT_BACKEND = "https://locationsbaelish.onrender.com";

export function syncServerOrigin(): string | undefined {
  const o = import.meta.env.VITE_API_ORIGIN;
  if (typeof o === "string" && o.trim().length > 0) {
    return o.trim().replace(/\/$/, "");
  }
  if (import.meta.env.VITE_BUILT_ON_VERCEL === "1") {
    return VERCEL_DEFAULT_BACKEND;
  }
  if (import.meta.env.PROD && typeof window !== "undefined") {
    const h = window.location.hostname;
    if (h === "vercel.app" || h.endsWith(".vercel.app")) {
      return VERCEL_DEFAULT_BACKEND;
    }
  }
  return undefined;
}

/**
 * Base para `fetch` al API REST.
 * Misma URL que Socket.io: en producción va directo al backend (CORS en Express), no al rewrite de Vercel.
 * Así se evitan peticiones colgadas al proxy y cold starts largos sin feedback.
 */
export function apiBase(): string {
  return syncServerOrigin() ?? "";
}

/** URL para ver si el backend responde (texto `ok`). En Vercel debe existir rewrite de `/health` en `vercel.json`. */
export function healthCheckUrl(): string {
  const o = syncServerOrigin();
  if (o) return `${o}/health`;
  if (typeof window !== "undefined") return `${window.location.origin}/health`;
  return "/health";
}

const DEFAULT_FETCH_TIMEOUT_MS = 45_000;

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
