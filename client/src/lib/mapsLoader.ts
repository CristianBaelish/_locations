import { Loader } from "@googlemaps/js-api-loader";

const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

let promise: Promise<typeof google> | null = null;

export function getMapsApiKey(): string | undefined {
  return apiKey?.trim() || undefined;
}

const MAPS_LOAD_TIMEOUT_MS = 60_000;

export function loadGoogleMaps(): Promise<typeof google> {
  const key = getMapsApiKey();
  if (!key) {
    return Promise.reject(new Error("Falta VITE_GOOGLE_MAPS_API_KEY"));
  }
  if (!promise) {
    const loader = new Loader({
      apiKey: key,
      version: "weekly",
      libraries: ["geometry"],
    });
    const load = loader.load();
    promise = Promise.race([
      load,
      new Promise<typeof google>((_, reject) => {
        window.setTimeout(
          () =>
            reject(
              new Error(
                `Google Maps no respondió en ${MAPS_LOAD_TIMEOUT_MS / 1000}s (red lenta, bloqueo o API key inválida).`
              )
            ),
          MAPS_LOAD_TIMEOUT_MS
        );
      }),
    ]).catch((e: unknown) => {
      promise = null;
      throw e;
    }) as Promise<typeof google>;
  }
  return promise;
}
