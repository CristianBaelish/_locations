const SHARE_TOKEN_PREFIX = "live-location-share-token:";
const inMemoryShareTokens = new Map<string, string>();

function shareTokenKey(roomId: string): string {
  return `${SHARE_TOKEN_PREFIX}${roomId}`;
}

export function storeShareToken(roomId: string, shareToken: string): void {
  inMemoryShareTokens.set(roomId, shareToken);
  try {
    window.sessionStorage.setItem(shareTokenKey(roomId), shareToken);
  } catch {
    // Storage can be unavailable in private modes; keep the in-memory token for this SPA session.
  }
}

export function readShareToken(roomId: string | undefined): string | null {
  if (!roomId) return null;
  try {
    return window.sessionStorage.getItem(shareTokenKey(roomId)) ?? inMemoryShareTokens.get(roomId) ?? null;
  } catch {
    return inMemoryShareTokens.get(roomId) ?? null;
  }
}

export function clearShareToken(roomId: string | undefined): void {
  if (!roomId) return;
  inMemoryShareTokens.delete(roomId);
  try {
    window.sessionStorage.removeItem(shareTokenKey(roomId));
  } catch {
    // Ignore unavailable storage; there is no persisted token to clean up.
  }
}
