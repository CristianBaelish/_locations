const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

let promise: Promise<typeof google> | null = null;

export function getMapsApiKey(): string | undefined {
  return apiKey?.trim() || undefined;
}

const MAPS_LOAD_TIMEOUT_MS = 60_000;

/**
 * Script oficial de Google, directo desde maps.googleapis.com.
 * El bootstrap copiado de @googlemaps/js-api-loader hace que Google responda
 * NotLoadingAPIFromGoogleMapsError y la vista de calle no llega a mostrarse.
 */
export function loadGoogleMaps(): Promise<typeof google> {
  const key = getMapsApiKey();
  if (!key) {
    return Promise.reject(new Error("Falta VITE_GOOGLE_MAPS_API_KEY"));
  }
  if (window.google?.maps?.Map && window.google.maps.geometry) {
    return Promise.resolve(window.google);
  }
  if (!promise) {
    promise = new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        promise = null;
        reject(new Error("Google Maps no respondió a tiempo."));
      }, MAPS_LOAD_TIMEOUT_MS);

      window.__livePovMapsReady = () => {
        window.clearTimeout(timeout);
        if (window.google?.maps) resolve(window.google);
        else {
          promise = null;
          reject(new Error("No se pudo cargar el mapa."));
        }
      };

      const script = document.createElement("script");
      const params = new URLSearchParams({
        key,
        v: "weekly",
        libraries: "geometry",
        callback: "__livePovMapsReady",
        loading: "async",
      });
      script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
      script.async = true;
      script.onerror = () => {
        window.clearTimeout(timeout);
        promise = null;
        reject(new Error("No se pudo cargar el mapa."));
      };
      document.head.appendChild(script);
    });
  }
  return promise;
}
