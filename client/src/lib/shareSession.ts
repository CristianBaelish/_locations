import { apiBase } from "./apiBase";

const TOKEN_PREFIX = "live-street-pov:share-token:";

function storageKey(roomId: string): string {
  return `${TOKEN_PREFIX}${roomId}`;
}

export function storeShareToken(roomId: string, shareToken: string): void {
  try {
    window.sessionStorage.setItem(storageKey(roomId), shareToken);
  } catch {
    // Sharing can still work in the current render; persistence is best-effort.
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
    // Ignore storage failures; server-side token invalidation is authoritative.
  }
}

export function requestStopSharing(roomId: string, shareToken: string): void {
  const url = `${apiBase()}/api/rooms/${encodeURIComponent(roomId)}/stop`;
  const body = JSON.stringify({ shareToken });
  void fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => {
    // The socket event may already have succeeded; otherwise the next online request can start a new room.
  });
}
