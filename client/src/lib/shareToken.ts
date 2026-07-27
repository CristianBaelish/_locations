const keyFor = (roomId: string) => `share-token:${roomId}`;

export function saveShareToken(roomId: string, shareToken: string): void {
  try {
    window.sessionStorage.setItem(keyFor(roomId), shareToken);
  } catch {
    // Some privacy modes disable storage; navigation state still carries the token.
  }
}

export function loadShareToken(roomId: string | undefined, navigationToken?: string): string | null {
  if (navigationToken) return navigationToken;
  if (!roomId) return null;
  try {
    return window.sessionStorage.getItem(keyFor(roomId));
  } catch {
    return null;
  }
}

export function removeShareToken(roomId: string): void {
  try {
    window.sessionStorage.removeItem(keyFor(roomId));
  } catch {
    // Nothing else is required once the server has invalidated the token.
  }
}
