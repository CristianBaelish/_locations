import { useEffect, useState } from "react";
import { io, type Socket } from "socket.io-client";

const origin =
  typeof import.meta.env.VITE_API_ORIGIN === "string" &&
  import.meta.env.VITE_API_ORIGIN.length > 0
    ? import.meta.env.VITE_API_ORIGIN
    : undefined;

export function useSocket(): Socket | null {
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    const s = io(origin, { path: "/socket.io", transports: ["websocket", "polling"] });
    setSocket(s);
    return () => {
      s.close();
    };
  }, []);

  return socket;
}
