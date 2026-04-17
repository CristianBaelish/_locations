import { useEffect, useState } from "react";
import { io, type Socket } from "socket.io-client";

const origin =
  typeof import.meta.env.VITE_API_ORIGIN === "string" &&
  import.meta.env.VITE_API_ORIGIN.length > 0
    ? import.meta.env.VITE_API_ORIGIN
    : undefined;

export function useSocket(): {
  socket: Socket | null;
  connectionError: string | null;
} {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  useEffect(() => {
    const s = io(origin, { path: "/socket.io", transports: ["websocket", "polling"] });
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
