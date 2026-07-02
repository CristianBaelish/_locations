const PREFIX = "share-token:";

function storageKey(roomId: string): string {
  return `${PREFIX}${roomId}`;
}

export function readShareToken(roomId: string | undefined): string | null {
  if (!roomId || typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(storageKey(roomId));
  } catch {
    return null;
  }
}

export function writeShareToken(roomId: string, shareToken: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(storageKey(roomId), shareToken);
  } catch {
    // Navigation state still carries the token for the current SPA session.
  }
}

export function removeShareToken(roomId: string | undefined): void {
  if (!roomId || typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(storageKey(roomId));
  } catch {
    // Best effort cleanup only.
  }
}
