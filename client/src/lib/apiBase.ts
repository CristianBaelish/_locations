/** Empty in dev (Vite proxy); set `VITE_API_ORIGIN` when the client is hosted separately from the API. */
export function apiBase(): string {
  const o = import.meta.env.VITE_API_ORIGIN;
  return typeof o === "string" && o.length > 0 ? o.replace(/\/$/, "") : "";
}
