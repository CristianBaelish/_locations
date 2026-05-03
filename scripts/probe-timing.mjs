/**
 * Mide tiempos de GET /health y POST /api/rooms (Render directo y vía Vercel).
 * Uso: node scripts/probe-timing.mjs
 *
 * Si Render está en frío, el primer GET puede tardar varios minutos: es normal en plan gratis.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const deploy = JSON.parse(readFileSync(join(root, "config", "deploy-urls.json"), "utf8"));

const render = deploy.renderBackendOrigin.replace(/\/$/, "");
const vercel = deploy.vercelPublicOrigin.replace(/\/$/, "");
const TIMEOUT_MS = 600_000;

async function timed(label, fn) {
  const t0 = Date.now();
  try {
    const result = await fn();
    const ms = Date.now() - t0;
    return { label, ms, ok: true, ...result };
  } catch (e) {
    const ms = Date.now() - t0;
    return {
      label,
      ms,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

async function getHealth(base) {
  const res = await fetch(`${base}/health`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = (await res.text()).trim();
  return {
    status: res.status,
    body: text,
    pass: res.ok && text === "ok",
  };
}

async function postRooms(base) {
  const res = await fetch(`${base}/api/rooms`, {
    method: "POST",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  let roomId;
  try {
    roomId = JSON.parse(text).roomId;
  } catch {
    roomId = null;
  }
  return {
    status: res.status,
    bodyPreview: text.slice(0, 100),
    pass: res.ok && typeof roomId === "string" && roomId.length > 0,
  };
}

console.log("Probe de API (timeouts hasta %d s)\n", TIMEOUT_MS / 1000);

const steps = [
  ["GET /health (Render directo)", () => getHealth(render)],
  ["GET /health (vía Vercel)", () => getHealth(vercel)],
  ["POST /api/rooms (Render directo)", () => postRooms(render)],
  ["POST /api/rooms (vía Vercel)", () => postRooms(vercel)],
];

for (const [stepLabel, fn] of steps) {
  process.stdout.write(`${stepLabel}… `);
  const r = await timed(stepLabel, fn);
  if (!r.ok) {
    console.log(`FALLO (${r.ms} ms): ${r.error}`);
    continue;
  }
  const { pass, status, body, bodyPreview } = r;
  const detail =
    typeof body === "string" ? `body="${body}"` : `body=${bodyPreview ?? "?"}`;
  console.log(`${pass ? "OK" : "RESPUESTA INESPERADA"} — ${r.ms} ms — HTTP ${status} — ${detail}`);
}

console.log("\nHecho. Tiempos altos en el primer GET suelen ser cold start en Render.");
