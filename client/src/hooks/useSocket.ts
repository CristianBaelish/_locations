import { useEffect, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { socketServerOrigin } from "../lib/apiBase";

/** Render gratis / redes lentas: el handshake puede tardar >45s; si no, el otro dispositivo ve timeout al conectar. */
const SOCKET_CONNECT_TIMEOUT_MS = 180_000;

export function useSocket(): {
  socket: Socket | null;
  connected: boolean;
  connectionError: string | null;
} {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  useEffect(() => {
    const origin = socketServerOrigin();
    const s = io(origin, {
      path: "/socket.io",
      /** Solo polling: evita fallos de WebSocket en proxies (Vercel, móvil). */
      transports: ["polling"],
      timeout: SOCKET_CONNECT_TIMEOUT_MS,
      reconnectionAttempts: 24,
      reconnectionDelay: 2_000,
      reconnectionDelayMax: 15_000,
    });
    setSocket(s);

    const onErr = (err: Error) => {
      setConnected(false);
      setConnectionError("Sin conexión. Reintentá en un momento.");
    };
    const onConnect = () => {
      setConnected(true);
      setConnectionError(null);
    };
    const onDisconnect = () => setConnected(false);

    s.on("connect_error", onErr);
    s.on("connect", onConnect);
    s.on("disconnect", onDisconnect);

    return () => {
      s.off("connect_error", onErr);
      s.off("connect", onConnect);
      s.off("disconnect", onDisconnect);
      s.close();
    };
  }, []);

  return { socket, connected, connectionError };
}
