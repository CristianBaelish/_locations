import { apiBase } from "./apiBase";

const TOKEN_PREFIX = "live-street-pov:share-token:";

function storageKey(roomId: string): string {
  return `${TOKEN_PREFIX}${roomId}`;
}

export function storeShareToken(roomId: string, shareToken: string): void {
  try {
    window.sessionStorage.setItem(storageKey(roomId), shareToken);
  } catch {
    // Sharing can continue only while this tab has the token in memory.
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
    // Server-side token invalidation is authoritative.
  }
}

export function requestStopSharing(roomId: string, shareToken: string): void {
  const url = `${apiBase()}/api/rooms/${encodeURIComponent(roomId)}/stop`;
  void fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ shareToken }),
    keepalive: true,
  }).catch(() => {
    // The socket event is the primary path; this keepalive request is best-effort.
  });
}
