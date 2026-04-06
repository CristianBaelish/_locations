/** Chrome/Android no da GPS con `http://` + IP local (192.168…); hace falta HTTPS o localhost. */
export function isSecureContextForGeolocation(): boolean {
  if (typeof window === "undefined") return true;
  return window.isSecureContext;
}

export function messageInsecureGeolocationContext(): string {
  return (
    "En el celular, Chrome no permite ubicación si entrás con http:// y la IP del Wi‑Fi (192.168…). " +
    "En el PC cerrá el servidor y ejecutá dev-lan-https.cmd; en el teléfono abrí https://TU-IP:5173 " +
    "(o el puerto que muestre Vite). La primera vez: Avanzado → Continuar (certificado local). " +
    "En Google Cloud, permití ese origen HTTPS en la clave de Maps."
  );
}

/** Texto útil cuando el navegador no puede obtener GPS/red de ubicación. */
export function describeGeolocationError(e: GeolocationPositionError): string {
  if (typeof window !== "undefined" && !window.isSecureContext) {
    return messageInsecureGeolocationContext();
  }

  const raw = (e.message || "").toLowerCase();
  const networkish =
    raw.includes("network") || raw.includes("network service") || e.code === e.POSITION_UNAVAILABLE;

  if (e.code === e.PERMISSION_DENIED) {
    return (
      "Ubicación denegada. Si entraste por http://192.168… en el celular, Chrome ni siquiera ofrece el permiso: " +
      "usá HTTPS (dev-lan-https.cmd). Si ya estás en https://, tocá el candado → Ubicación → Permitir."
    );
  }

  if (e.code === e.TIMEOUT) {
    return "Tiempo agotado al pedir la ubicación. Probá de nuevo cerca de una ventana, con WiFi, o en otro navegador.";
  }

  if (networkish || e.code === e.POSITION_UNAVAILABLE) {
    return (
      "No se pudo obtener la ubicación por red (Chrome a veces muestra “network service”). " +
      "Revisá en Windows: Configuración → Privacidad y seguridad → Ubicación (activada para apps de escritorio). " +
      "Desactivá VPN o extensiones que bloqueen ubicación. " +
      "Si entrás por la IP del PC (192.168…), probá http://localhost:5173 desde la misma máquina."
    );
  }

  return e.message || "No se pudo obtener la ubicación.";
}
