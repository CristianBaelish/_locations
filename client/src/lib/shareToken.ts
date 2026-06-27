const PREFIX = "share-token:";

function storageKey(roomId: string): string {
  return `${PREFIX}${roomId}`;
}

export function saveShareToken(roomId: string, shareToken: string): void {
  try {
    window.sessionStorage.setItem(storageKey(roomId), shareToken);
  } catch {
    /* Session storage can be unavailable in hardened browsers; navigation state still covers the initial page. */
  }
}

export function readShareToken(roomId: string): string | null {
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
    /* Best-effort cleanup only. */
  }
}
