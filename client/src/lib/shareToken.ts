const KEY_PREFIX = "locations.shareToken.";

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function saveShareToken(roomId: string, shareToken: string): void {
  storage()?.setItem(`${KEY_PREFIX}${roomId}`, shareToken);
}

export function loadShareToken(roomId: string): string | null {
  return storage()?.getItem(`${KEY_PREFIX}${roomId}`) ?? null;
}

export function removeShareToken(roomId: string): void {
  storage()?.removeItem(`${KEY_PREFIX}${roomId}`);
}
