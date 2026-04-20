import { useEffect, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { socketServerOrigin } from "../lib/apiBase";

export function useSocket(): {
  socket: Socket | null;
  connectionError: string | null;
} {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  useEffect(() => {
    const origin = socketServerOrigin();
    const s = io(origin, {
      path: "/socket.io",
      transports: ["websocket", "polling"],
      timeout: 45_000,
      reconnectionAttempts: 12,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 10_000,
    });
    setSocket(s);

    const onErr = (err: Error) => {
      setConnectionError(
        err.message ||
          "No se pudo conectar al servidor de sincronización (Socket.io). Revisá VITE_API_ORIGIN en Vercel y que el API en Render esté despierto."
      );
    };
    const onConnect = () => setConnectionError(null);

    s.on("connect_error", onErr);
    s.on("connect", onConnect);

    return () => {
      s.off("connect_error", onErr);
      s.off("connect", onConnect);
      s.close();
    };
  }, []);

  return { socket, connectionError };
}
