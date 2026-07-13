const STORAGE_PREFIX = "live-pov-share-token:";

export function rememberShareToken(roomId: string, shareToken: string): void {
  try {
    window.sessionStorage.setItem(`${STORAGE_PREFIX}${roomId}`, shareToken);
  } catch {
    /* sessionStorage can be unavailable in private or embedded contexts. */
  }
}

export function getShareToken(roomId: string | undefined): string | null {
  if (!roomId) return null;
  try {
    return window.sessionStorage.getItem(`${STORAGE_PREFIX}${roomId}`);
  } catch {
    return null;
  }
}

export function forgetShareToken(roomId: string | undefined): void {
  if (!roomId) return;
  try {
    window.sessionStorage.removeItem(`${STORAGE_PREFIX}${roomId}`);
  } catch {
    /* best effort */
  }
}
