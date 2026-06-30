const SHARE_TOKEN_PREFIX = "locations.shareToken.";

function storageKey(roomId: string): string {
  return `${SHARE_TOKEN_PREFIX}${roomId}`;
}

function canUseSessionStorage(): boolean {
  return typeof window !== "undefined" && typeof window.sessionStorage !== "undefined";
}

export function saveShareToken(roomId: string, shareToken: string): void {
  if (!canUseSessionStorage()) return;
  try {
    window.sessionStorage.setItem(storageKey(roomId), shareToken);
  } catch {
    // Private browsing modes can disable sessionStorage; navigation state still carries the token.
  }
}

export function loadShareToken(roomId: string): string | null {
  if (!canUseSessionStorage()) return null;
  try {
    return window.sessionStorage.getItem(storageKey(roomId));
  } catch {
    return null;
  }
}

export function clearShareToken(roomId: string): void {
  if (!canUseSessionStorage()) return;
  try {
    window.sessionStorage.removeItem(storageKey(roomId));
  } catch {
    // Best-effort cleanup only.
  }
}

export function shareTokenFromNavigationState(state: unknown): string | null {
  if (!state || typeof state !== "object") return null;
  const token = (state as { shareToken?: unknown }).shareToken;
  return typeof token === "string" && token.length > 0 ? token : null;
}
