const STORAGE_PREFIX = "live-street-pov:shareToken:";
const memoryTokens = new Map<string, string>();

function storageKey(roomId: string): string {
  return `${STORAGE_PREFIX}${roomId}`;
}

export function saveShareToken(roomId: string, shareToken: string): void {
  memoryTokens.set(roomId, shareToken);
  try {
    window.sessionStorage.setItem(storageKey(roomId), shareToken);
  } catch {
    /* Session storage may be unavailable in private modes; memory still covers SPA navigation. */
  }
}

export function readShareToken(roomId: string): string | null {
  try {
    const stored = window.sessionStorage.getItem(storageKey(roomId));
    if (stored) {
      memoryTokens.set(roomId, stored);
      return stored;
    }
  } catch {
    /* Fall back to in-memory token. */
  }
  return memoryTokens.get(roomId) ?? null;
}

export function forgetShareToken(roomId: string): void {
  memoryTokens.delete(roomId);
  try {
    window.sessionStorage.removeItem(storageKey(roomId));
  } catch {
    /* Nothing else to clear. */
  }
}
