/**
 * Sesión real de más de 2 minutos: el visor tiene que seguir recibiendo
 * la última ubicación aunque el socket se corte y vuelva a conectar.
 *
 *   node scripts/live-session.mjs
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { io } from "socket.io-client";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = 3099;
const base = `http://127.0.0.1:${port}`;
const DURATION_MS = 130_000;
const STEP_MS = 5_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function connect(label) {
  const socket = io(base, {
    transports: ["polling"],
    timeout: 8_000,
    reconnection: true,
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} no conectó`)), 8_000);
    socket.on("connect", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.on("connect_error", (error) => {
      console.log(label, "connect_error", error.message);
    });
  });
}

async function waitHealth() {
  const started = Date.now();
  for (;;) {
    try {
      const res = await fetch(`${base}/health`);
      if (res.ok) return;
    } catch {
      /* todavía no escucha */
    }
    if (Date.now() - started > 10_000) throw new Error("el servidor no arrancó");
    await sleep(200);
  }
}

const child = spawn(process.execPath, ["server/src/index.js"], {
  cwd: root,
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
child.stdout.on("data", (chunk) => {
  serverLog += chunk;
});
child.stderr.on("data", (chunk) => {
  serverLog += chunk;
});

try {
  await waitHealth();
  const created = await fetch(`${base}/api/rooms`, { method: "POST" });
  if (!created.ok) throw new Error(`POST /api/rooms ${created.status}`);
  const { roomId } = await created.json();
  if (!roomId) throw new Error("sin roomId");

  const received = [];
  const viewer = await connect("viewer");
  viewer.on("connect", () => {
    viewer.emit("join", { roomId });
  });
  viewer.emit("join", { roomId });
  viewer.on("location-update", (payload) => {
    received.push({ ...payload, at: Date.now() });
  });

  const sharer = await connect("sharer");
  sharer.emit("join", { roomId });

  const started = Date.now();
  let sent = 0;
  let lastLat = 0;
  let dropped = false;

  while (Date.now() - started < DURATION_MS) {
    const elapsed = Date.now() - started;
    if (!dropped && elapsed > 40_000) {
      dropped = true;
      const before = received.length;
      viewer.disconnect();
      await sleep(1_500);
      viewer.connect();
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("el visor no volvió a conectar")), 8_000);
        viewer.once("connect", () => {
          clearTimeout(timer);
          resolve();
        });
      });
      console.log(`corte del visor a los ${Math.round(elapsed / 1000)}s; tenía ${before} puntos`);
    }

    lastLat = -34.6 + sent * 0.001;
    const payload = { roomId, lat: lastLat, lng: -58.38, heading: 90, courseDeg: 90 };
    const ack = await new Promise((resolve) => {
      sharer.timeout(5_000).emit("location", payload, (err, body) => {
        resolve(err ? { ok: false, error: String(err.message || err) } : body);
      });
    });
    if (!ack?.ok) throw new Error(`el servidor no confirmó el punto ${sent}: ${ack?.error || "sin ack"}`);
    sent += 1;
    await sleep(STEP_MS);
  }

  await sleep(1_000);
  if (received.length < 2) throw new Error(`llegaron ${received.length} puntos`);

  const afterDrop = received.filter((point) => point.at >= started + 45_000);
  if (dropped && afterDrop.length < 5) {
    throw new Error(`después del corte solo llegaron ${afterDrop.length} puntos`);
  }

  const latest = received[received.length - 1];
  if (Math.abs(latest.lat - lastLat) > 0.0001) {
    throw new Error(`el visor se quedó en ${latest.lat} y el último envío fue ${lastLat}`);
  }

  let gap = 0;
  for (let i = 1; i < received.length; i += 1) {
    gap = Math.max(gap, received[i].at - received[i - 1].at);
  }
  if (gap > 25_000) throw new Error(`hubo un silencio de ${Math.round(gap / 1000)}s`);

  const cached = await fetch(`${base}/api/rooms/${roomId}/location`, { cache: "no-store" });
  if (!cached.ok) throw new Error(`GET location ${cached.status}`);
  const body = await cached.json();
  if (Math.abs(body.lat - lastLat) > 0.0001) {
    throw new Error(`la copia HTTP no es la última ubicación (${body.lat} vs ${lastLat})`);
  }

  console.log(
    `OK ${Math.round((Date.now() - started) / 1000)}s, enviados ${sent}, recibidos ${received.length}, silencio máximo ${Math.round(gap / 1000)}s`
  );
  sharer.close();
  viewer.close();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  if (serverLog.trim()) console.error(serverLog.slice(-2000));
  process.exitCode = 1;
} finally {
  child.kill();
  await sleep(300);
  process.exit(process.exitCode ?? 0);
}
