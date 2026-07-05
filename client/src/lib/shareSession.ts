const PREFIX = "shareToken:";
const memoryTokens = new Map<string, string>();

function storageKey(roomId: string): string {
  return `${PREFIX}${roomId}`;
}

export function storeShareToken(roomId: string, shareToken: string): void {
  memoryTokens.set(roomId, shareToken);
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(storageKey(roomId), shareToken);
  } catch {
    // Some privacy modes disable sessionStorage; keep the token for this SPA session.
  }
}

export function readShareToken(roomId: string | undefined): string | null {
  if (!roomId) return null;
  if (typeof window !== "undefined") {
    try {
      const stored = window.sessionStorage.getItem(storageKey(roomId));
      if (stored) return stored;
    } catch {
      // Fall through to the in-memory token.
    }
  }
  return memoryTokens.get(roomId) ?? null;
}

export function clearShareToken(roomId: string): void {
  memoryTokens.delete(roomId);
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(storageKey(roomId));
  } catch {
    // Ignore storage cleanup failures.
  }
}
