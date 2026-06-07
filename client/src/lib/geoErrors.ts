export function isSecureContextForGeolocation(): boolean {
  if (typeof window === "undefined") return true;
  return window.isSecureContext;
}

export function messageInsecureGeolocationContext(): string {
  return "Se necesita una conexión segura (HTTPS) para usar la ubicación.";
}

export function describeGeolocationError(e: GeolocationPositionError): string {
  if (typeof window !== "undefined" && !window.isSecureContext) {
    return messageInsecureGeolocationContext();
  }

  if (e.code === e.PERMISSION_DENIED) {
    return "Permiso de ubicación denegado.";
  }

  if (e.code === e.TIMEOUT) {
    return "No se obtuvo la ubicación a tiempo.";
  }

  if (e.code === e.POSITION_UNAVAILABLE) {
    return "Ubicación no disponible.";
  }

  return "No se pudo obtener la ubicación.";
}
