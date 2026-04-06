import { Loader } from "@googlemaps/js-api-loader";

const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

let promise: Promise<typeof google> | null = null;

export function getMapsApiKey(): string | undefined {
  return apiKey?.trim() || undefined;
}

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
    promise = loader.load();
  }
  return promise;
}
