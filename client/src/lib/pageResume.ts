import type { Socket } from "socket.io-client";

/** Tras dormir el celular, el socket puede figurar conectado con el polling ya muerto. */
export function kickSocket(socket: Socket | null | undefined): void {
  if (!socket) return;
  if (socket.connected) socket.disconnect();
  socket.connect();
}

/** Corre al volver de segundo plano o al salir de la caché atrás/adelante. No corre en la carga inicial. */
export function onPageResume(run: () => void): () => void {
  let hiddenAt = document.visibilityState === "hidden" ? Date.now() : 0;

  const onVis = () => {
    if (document.visibilityState === "hidden") {
      hiddenAt = Date.now();
      return;
    }
    const awayMs = hiddenAt ? Date.now() - hiddenAt : 0;
    hiddenAt = 0;
    if (awayMs >= 1_200) run();
  };

  const onShow = (event: PageTransitionEvent) => {
    if (event.persisted) run();
  };

  document.addEventListener("visibilitychange", onVis);
  window.addEventListener("pageshow", onShow);
  return () => {
    document.removeEventListener("visibilitychange", onVis);
    window.removeEventListener("pageshow", onShow);
  };
}
