/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_GOOGLE_MAPS_API_KEY?: string;
  readonly VITE_API_ORIGIN?: string;
  readonly VITE_BUILT_ON_VERCEL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
