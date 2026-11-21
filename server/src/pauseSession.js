/**
 * Cada carga de la página empieza el epoch en 1. Al recargar, pagehide
 * pausa con el epoch de esa carga y el documento nuevo vuelve a mandar 1,
 * así que un epoch mayor no alcanza para salir de la pausa.
 * Cada documento manda un id de sesión distinto. La misma sesión sigue
 * pausada; otra sesión (recarga o pestaña nueva) puede publicar de nuevo.
 */

export function readSession(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(value)) return null;
  return value;
}

export function locationBlockedByPause({ pausedEpoch, liveEpoch, pausedSession, epoch, session }) {
  const paused = pausedEpoch != null && pausedEpoch >= liveEpoch;
  if (!paused) return false;
  if (session && (!pausedSession || session !== pausedSession)) return false;
  return epoch == null || epoch <= pausedEpoch;
}

export function shouldClearPause({ pausedEpoch, pausedSession, epoch, session }) {
  if (pausedEpoch == null) return false;
  if (session && (!pausedSession || session !== pausedSession)) return true;
  return epoch != null && epoch > pausedEpoch;
}

/** Una pausa vieja no puede tapar un documento que ya publicó después. */
export function pauseSuperseded({ epoch, liveEpoch, session, activeSession }) {
  if (epoch < liveEpoch) return true;
  if (session && activeSession && session !== activeSession) return true;
  return false;
}
