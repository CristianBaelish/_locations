import { useEffect, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { socketServerOrigin } from "../lib/apiBase";

/** Render gratis / redes lentas: el handshake puede tardar >45s; si no, el otro dispositivo ve timeout al conectar. */
const SOCKET_CONNECT_TIMEOUT_MS = 180_000;

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
      /** Polling primero: más fiable si el WebSocket cae (proxies, redes móviles, “websocket error”). */
      transports: ["polling", "websocket"],
      timeout: SOCKET_CONNECT_TIMEOUT_MS,
      reconnectionAttempts: 24,
      reconnectionDelay: 2_000,
      reconnectionDelayMax: 15_000,
    });
    setSocket(s);

    const onErr = (err: Error) => {
      setConnectionError(
        err.message ||
          "No se pudo conectar al servidor de sincronización (Socket.io hacia Render). Revisá que el servicio en Render esté activo, DNS/firewall, y que `config/deploy-urls.json` coincida con la URL del backend."
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
