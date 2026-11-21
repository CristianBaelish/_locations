/** Id de esta carga de la página. No se guarda: una recarga tiene que ser otra sesión. */
export function createShareSessionId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid && /^[A-Za-z0-9_-]{8,64}$/.test(uuid)) return uuid;
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}
