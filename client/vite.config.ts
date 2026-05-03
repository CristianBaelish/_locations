import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { VitePWA } from "vite-plugin-pwa";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** HTTPS local para que el GPS funcione en el celular (HTTP + IP LAN no es “contexto seguro” en Chrome). */
const lanHttps = process.env.VITE_LAN_HTTPS === "1";

export default defineConfig(({ mode }) => {
  const repoRoot = path.resolve(__dirname, "..");
  const clientRoot = __dirname;
  const fromFiles = {
    ...loadEnv(mode, repoRoot, "VITE_"),
    ...loadEnv(mode, clientRoot, "VITE_"),
  };
  /** Vercel/CI inyecta VITE_* en process.env; loadEnv solo lee archivos .env */
  const fromProcess: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith("VITE_") && typeof v === "string" && v.length > 0) {
      fromProcess[k] = v;
    }
  }
  const merged = { ...fromFiles, ...fromProcess };

  const define: Record<string, string> = {};
  for (const [key, value] of Object.entries(merged)) {
    define[`import.meta.env.${key}`] = JSON.stringify(value);
  }
  /** Marcador de build en Vercel (p. ej. telemetría futura); el API en prod va directo a Render (ver `apiBase.ts`). */
  define["import.meta.env.VITE_BUILT_ON_VERCEL"] = JSON.stringify(
    process.env.VERCEL === "1" ? "1" : "0"
  );

  /** Misma URL que `destination` en vercel.json (config/deploy-urls.json). Override: VITE_DEFAULT_RENDER_BACKEND */
  const deployUrls = JSON.parse(
    readFileSync(path.join(repoRoot, "config", "deploy-urls.json"), "utf8")
  ) as { renderBackendOrigin: string };
  const renderBackend =
    (typeof merged.VITE_DEFAULT_RENDER_BACKEND === "string" && merged.VITE_DEFAULT_RENDER_BACKEND.trim()) ||
    (typeof process.env.VITE_DEFAULT_RENDER_BACKEND === "string" && process.env.VITE_DEFAULT_RENDER_BACKEND.trim()) ||
    deployUrls.renderBackendOrigin.replace(/\/$/, "");
  define["import.meta.env.VITE_DEFAULT_RENDER_BACKEND"] = JSON.stringify(renderBackend);

  const proxy = {
    "/api": { target: "http://localhost:3001", changeOrigin: true },
    "/health": { target: "http://localhost:3001", changeOrigin: true },
    "/socket.io": {
      target: "http://localhost:3001",
      changeOrigin: true,
      ws: true,
    },
  };

  return {
    envDir: repoRoot,
    define,
    plugins: [
      ...(lanHttps ? [basicSsl()] : []),
      react(),
      VitePWA({
        registerType: "autoUpdate",
        includeAssets: ["icon.svg"],
        manifest: {
          name: "Ubicación + vista de calle",
          short_name: "LivePOV",
          description: "Compartir ubicación en vivo y vista de calle aproximada",
          theme_color: "#0f1419",
          background_color: "#0f1419",
          display: "standalone",
          orientation: "any",
          start_url: "/",
          lang: "es",
          icons: [
            {
              src: "icon.svg",
              sizes: "512x512",
              type: "image/svg+xml",
              purpose: "any maskable",
            },
          ],
        },
        workbox: {
          /** Sin esto, el SW viejo puede seguir sirviendo JS con lógica antigua (URLs/timeouts) hasta cerrar todas las pestañas. */
          skipWaiting: true,
          clientsClaim: true,
          globPatterns: ["**/*.{js,css,html,ico,svg,png,woff2}"],
          navigateFallback: "/index.html",
          /** No servir el SPA HTML para rutas `/api` (evita respuestas raras si el SW intercepta). */
          navigateFallbackDenylist: [/^\/api/, /^\/health/],
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/api\.open-meteo\.com\/.*/i,
              handler: "NetworkFirst",
              options: {
                cacheName: "open-meteo",
                expiration: { maxEntries: 20, maxAgeSeconds: 300 },
              },
            },
          ],
        },
        devOptions: {
          enabled: false,
        },
      }),
    ],

    server: {
      ...(lanHttps ? { https: true } : {}),
      proxy,
    },
    /** `vite preview` desde el celular: mismo proxy que en dev + escuchar en todas las interfaces */
    preview: {
      host: true,
      port: 4173,
      strictPort: true,
      ...(lanHttps ? { https: true } : {}),
      proxy,
    },
  };
});
