const SHARE_TOKEN_KEY_PREFIX = "share-token:";

function keyForRoom(roomId: string): string {
  return `${SHARE_TOKEN_KEY_PREFIX}${roomId}`;
}

export function rememberShareToken(roomId: string, shareToken: string): void {
  try {
    window.sessionStorage.setItem(keyForRoom(roomId), shareToken);
  } catch {
    // Some browsers can block storage; navigation state still covers the initial page load.
  }
}

export function readShareToken(roomId: string): string | null {
  try {
    return window.sessionStorage.getItem(keyForRoom(roomId));
  } catch {
    return null;
  }
}
