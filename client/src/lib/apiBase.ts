/**
 * Base URL para `fetch` al API REST.
 * - Dev: vacío → proxy de Vite a localhost:3001.
 * - Build en Vercel: vacío → `/api` en el mismo dominio; `vercel.json` reenvía a Render (sin CORS).
 * - Otros: `VITE_API_ORIGIN` = URL del servidor (p. ej. Render).
 */
export function apiBase(): string {
  if (import.meta.env.VITE_BUILT_ON_VERCEL === "1") return "";
  const o = import.meta.env.VITE_API_ORIGIN;
  return typeof o === "string" && o.length > 0 ? o.trim().replace(/\/$/, "") : "";
}
