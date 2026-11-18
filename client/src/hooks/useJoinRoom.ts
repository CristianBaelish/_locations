import { useEffect } from "react";
import type { Socket } from "socket.io-client";

export type RoomRole = "sharer" | "viewer";

/** Misma pestaña conserva el id al recargar, así un refresco no suma otra persona. */
function clientId(): string {
  const key = "livepov-client";
  try {
    const existing = sessionStorage.getItem(key);
    if (existing && /^[A-Za-z0-9_-]{8,64}$/.test(existing)) return existing;
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    sessionStorage.setItem(key, id);
    return id;
  } catch {
    return "sin-guardar";
  }
}

/** Emite `join` al conectar y en cada reconexión (Socket.io puede conectar después del primer render). */
export function useJoinRoom(
  socket: Socket | null,
  roomId: string | undefined,
  role: RoomRole
): void {
  useEffect(() => {
    if (!socket || !roomId) return;
    const join = () => {
      socket.emit("join", { roomId, role, clientId: clientId() });
    };
    if (socket.connected) join();
    socket.on("connect", join);
    return () => {
      socket.off("connect", join);
    };
  }, [socket, roomId, role]);
}
