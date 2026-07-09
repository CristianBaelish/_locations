const SHARE_TOKEN_KEY_PREFIX = "locations.shareToken.";

function keyForRoom(roomId: string): string {
  return `${SHARE_TOKEN_KEY_PREFIX}${roomId}`;
}

export function storeShareToken(roomId: string, shareToken: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(keyForRoom(roomId), shareToken);
  } catch {
    // Some browsers disable sessionStorage; navigation state still covers the initial SPA transition.
  }
}

export function readShareToken(roomId: string | undefined): string | null {
  if (!roomId || typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(keyForRoom(roomId));
  } catch {
    return null;
  }
}

export function removeShareToken(roomId: string | undefined): void {
  if (!roomId || typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(keyForRoom(roomId));
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
}
