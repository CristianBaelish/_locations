/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_GOOGLE_MAPS_API_KEY?: string;
  readonly VITE_API_ORIGIN?: string;
  readonly VITE_BUILT_ON_VERCEL?: string;
  /** Inyectado en build desde config/deploy-urls.json (override: VITE_DEFAULT_RENDER_BACKEND). */
  readonly VITE_DEFAULT_RENDER_BACKEND?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Callback opcional de la API de Maps JS ante error de autenticación / referrer. */
interface Window {
  gm_authFailure?: () => void;
}
