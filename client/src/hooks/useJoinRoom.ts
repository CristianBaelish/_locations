import { useEffect } from "react";
import type { Socket } from "socket.io-client";

/** Emite `join` al conectar y en cada reconexión (Socket.io puede conectar después del primer render). */
export function useJoinRoom(socket: Socket | null, roomId: string | undefined): void {
  useEffect(() => {
    if (!socket || !roomId) return;
    const join = () => {
      socket.emit("join", { roomId });
    };
    if (socket.connected) join();
    socket.on("connect", join);
    return () => {
      socket.off("connect", join);
      socket.emit("leave", { roomId });
    };
  }, [socket, roomId]);
}
