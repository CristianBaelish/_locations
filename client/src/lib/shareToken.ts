const SHARE_TOKEN_PREFIX = "shareToken:";

function storage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

export function saveShareToken(roomId: string, shareToken: string): void {
  storage()?.setItem(`${SHARE_TOKEN_PREFIX}${roomId}`, shareToken);
}

export function readShareToken(roomId: string, fallback?: unknown): string | null {
  if (typeof fallback === "string" && fallback.length > 0) {
    return fallback;
  }
  return storage()?.getItem(`${SHARE_TOKEN_PREFIX}${roomId}`) ?? null;
}

export function clearShareToken(roomId: string): void {
  storage()?.removeItem(`${SHARE_TOKEN_PREFIX}${roomId}`);
}
