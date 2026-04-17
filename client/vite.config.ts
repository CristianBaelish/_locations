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
  /** En el build de Vercel, REST va por mismo origen + rewrite → evita "Failed to fetch" por CORS hacia Render */
  define["import.meta.env.VITE_BUILT_ON_VERCEL"] = JSON.stringify(
    process.env.VERCEL === "1" ? "1" : "0"
  );

  const proxy = {
    "/api": { target: "http://localhost:3001", changeOrigin: true },
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
          globPatterns: ["**/*.{js,css,html,ico,svg,png,woff2}"],
          navigateFallback: "/index.html",
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
