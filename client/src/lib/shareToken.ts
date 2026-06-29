const PREFIX = "shareToken:";

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function saveShareToken(roomId: string, shareToken: string): void {
  storage()?.setItem(`${PREFIX}${roomId}`, shareToken);
}

export function readShareToken(roomId: string): string | null {
  return storage()?.getItem(`${PREFIX}${roomId}`) ?? null;
}

export function clearShareToken(roomId: string): void {
  storage()?.removeItem(`${PREFIX}${roomId}`);
}
