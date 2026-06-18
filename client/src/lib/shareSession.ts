const SHARE_TOKEN_PREFIX = "share-token:";

function storageKey(roomId: string): string {
  return `${SHARE_TOKEN_PREFIX}${roomId}`;
}

export function saveShareToken(roomId: string, shareToken: string): void {
  try {
    window.sessionStorage.setItem(storageKey(roomId), shareToken);
  } catch {
    // Private browsing / storage restrictions should not crash room creation.
  }
}

export function loadShareToken(roomId: string | undefined): string | null {
  if (!roomId) return null;
  try {
    return window.sessionStorage.getItem(storageKey(roomId));
  } catch {
    return null;
  }
}

export function clearShareToken(roomId: string): void {
  try {
    window.sessionStorage.removeItem(storageKey(roomId));
  } catch {
    // Best-effort cleanup only.
  }
}
