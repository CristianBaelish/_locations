const memoryShareTokens = new Map<string, string>();

export function shareTokenKey(roomId: string): string {
  return `share-token:${roomId}`;
}

export function rememberShareToken(roomId: string, shareToken: string): void {
  memoryShareTokens.set(roomId, shareToken);
  try {
    window.sessionStorage.setItem(shareTokenKey(roomId), shareToken);
  } catch {
    // Fail closed if storage is unavailable; the share page can still use in-memory state.
  }
}

export function readShareToken(roomId: string | undefined): string | null {
  if (!roomId) return null;
  try {
    return window.sessionStorage.getItem(shareTokenKey(roomId)) ?? memoryShareTokens.get(roomId) ?? null;
  } catch {
    return memoryShareTokens.get(roomId) ?? null;
  }
}

export function forgetShareToken(roomId: string | undefined): void {
  if (!roomId) return;
  memoryShareTokens.delete(roomId);
  try {
    window.sessionStorage.removeItem(shareTokenKey(roomId));
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
}
