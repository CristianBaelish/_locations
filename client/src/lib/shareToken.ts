export function shareTokenStorageKey(roomId: string): string {
  return `live-street-pov:share-token:${roomId}`;
}

export function loadShareToken(roomId: string | undefined): string | null {
  if (!roomId || typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(shareTokenStorageKey(roomId));
  } catch {
    return null;
  }
}
