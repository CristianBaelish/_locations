/**
 * 1) Comprueba que vercel.json apunte al mismo backend que config/deploy-urls.json.
 * 2) Opcional (--probe): GET /health en Render y en el sitio Vercel (puede tardar si Render está frío).
 *
 * Uso:
 *   node scripts/verify-deployment.mjs
 *   node scripts/verify-deployment.mjs --probe
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const withProbe = process.argv.includes("--probe");

function loadJson(rel) {
  return JSON.parse(readFileSync(join(root, rel), "utf8"));
}

const deploy = loadJson("config/deploy-urls.json");
const vercel = loadJson("vercel.json");

const renderOrigin = deploy.renderBackendOrigin.replace(/\/$/, "");
const publicOrigin = deploy.vercelPublicOrigin.replace(/\/$/, "");

const rewrites = vercel.rewrites ?? [];
const dests = rewrites
  .map((r) => r.destination)
  .filter((d) => typeof d === "string" && d.startsWith("http"));

const bad = dests.filter((d) => !d.startsWith(renderOrigin));
if (bad.length) {
  console.error(
    "vercel.json: estas destination no usan renderBackendOrigin de config/deploy-urls.json:\n",
    bad.join("\n")
  );
  process.exit(1);
}

if (!dests.some((d) => d.includes("/api/"))) {
  console.error("vercel.json: no hay rewrite de /api hacia el backend.");
  process.exit(1);
}

if (!dests.some((d) => d.includes("/socket.io"))) {
  console.error("vercel.json: no hay rewrite de /socket.io hacia el backend (WebSocket + polling).");
  process.exit(1);
}

console.log("Config: vercel.json y config/deploy-urls.json coinciden en el origen de Render.");

if (!withProbe) {
  console.log('Omitido GET /health (añadí --probe para probar red; en Render gratis puede tardar >2 min en frío).');
  process.exit(0);
}

async function checkHealth(label, url, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    const text = (await res.text()).trim();
    if (!res.ok) {
      console.error(`${label}: HTTP ${res.status} — ${text.slice(0, 200)}`);
      return false;
    }
    if (text !== "ok") {
      console.error(`${label}: esperaba cuerpo "ok", recibí: ${text.slice(0, 200)}`);
      return false;
    }
    console.log(`${label}: ok (${url})`);
    return true;
  } catch (e) {
    console.error(`${label}: ${e instanceof Error ? e.message : e}`);
    return false;
  } finally {
    clearTimeout(t);
  }
}

/** Debe cubrir cold start de Render (GET /health vía Vercel puede tardar mucho en frío). */
const timeoutMs = 500_000;
let ok = true;
ok = (await checkHealth("Render directo", `${renderOrigin}/health`, timeoutMs)) && ok;
ok = (await checkHealth("Vercel (rewrite)", `${publicOrigin}/health`, timeoutMs)) && ok;

if (!ok) {
  console.error("\nRevisá Render (servicio / plan), DNS y que el deploy en Vercel esté al día.");
  process.exit(1);
}

async function checkSocketIo(label, base, timeoutMs) {
  const url = `${base.replace(/\/$/, "")}/socket.io/?EIO=4&transport=polling`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    const text = (await res.text()).trim();
    if (!res.ok || text.startsWith("<!") || !text.startsWith("0")) {
      console.error(`${label}: handshake Socket.io inválido (HTTP ${res.status}) — ${text.slice(0, 120)}`);
      return false;
    }
    console.log(`${label}: handshake Socket.io ok`);
    return true;
  } catch (e) {
    console.error(`${label} Socket.io: ${e instanceof Error ? e.message : e}`);
    return false;
  } finally {
    clearTimeout(t);
  }
}

ok = (await checkSocketIo("Render directo", renderOrigin, 30_000)) && ok;
ok = (await checkSocketIo("Vercel (rewrite)", publicOrigin, 30_000)) && ok;

if (!ok) {
  console.error("\nSocket.io no responde bien. Revisá CORS del servidor y rewrites de vercel.json.");
  process.exit(1);
}

console.log("\nProbes HTTP: /health y handshake Socket.io respondieron ok.");
