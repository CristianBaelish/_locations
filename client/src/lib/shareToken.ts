const STORAGE_PREFIX = "live-street-pov:share-token:";

function storageKey(roomId: string): string {
  return `${STORAGE_PREFIX}${roomId}`;
}

export function storeShareToken(roomId: string, shareToken: string): void {
  try {
    window.sessionStorage.setItem(storageKey(roomId), shareToken);
  } catch {
    // Browsers can disable storage; the navigation state still carries the token for this tab.
  }
}

export function removeShareToken(roomId: string): void {
  try {
    window.sessionStorage.removeItem(storageKey(roomId));
  } catch {
    // Best-effort cleanup only.
  }
}

export function readShareToken(
  roomId: string | undefined,
  navigationState: unknown
): string | null {
  if (!roomId) return null;

  if (
    navigationState &&
    typeof navigationState === "object" &&
    "shareToken" in navigationState
  ) {
    const stateToken = (navigationState as { shareToken?: unknown }).shareToken;
    if (typeof stateToken === "string" && stateToken.length > 0) {
      storeShareToken(roomId, stateToken);
      return stateToken;
    }
  }

  try {
    const stored = window.sessionStorage.getItem(storageKey(roomId));
    return stored && stored.length > 0 ? stored : null;
  } catch {
    return null;
  }
}
