import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import http from "http";
import cors from "cors";
import { Server } from "socket.io";
import { nanoid } from "nanoid";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3001;
const app = express();

/**
 * Orígenes: local + FRONTEND_URL + cualquier https (Vercel con dominio propio, previews, etc.)
 * En Render opcional: FRONTEND_URL=https://tu-app.vercel.app
 */
const extraOrigins = (process.env.FRONTEND_URL || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function originAllowed(origin) {
  if (!origin) return true;
  if (extraOrigins.includes(origin)) return true;
  if (origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:")) return true;
  if (/^http:\/\/192\.168\.\d+\.\d+:\d+$/.test(origin)) return true;
  if (origin.startsWith("https://")) return true;
  return false;
}

/** `cors` invoca `origin` como (origin, callback) — hay que llamar a `callback`, si no la petición queda colgada. */
app.use(
  cors({
    origin(origin, callback) {
      callback(null, originAllowed(origin));
    },
  })
);
app.use(express.json());

app.get("/health", (_req, res) => {
  res.type("text").send("ok");
});

/** @type {Set<string>} */
const rooms = new Set();

/** @type {Map<string, { lat: number, lng: number, heading: number | null, courseDeg: number | null, accuracy?: number, t: number }>} */
const lastLocationByRoom = new Map();

/** @type {Map<string, number>} */
const roomSeenAt = new Map();

const ROOM_TTL_MS = 12 * 60 * 60 * 1000;

function touchRoom(roomId) {
  rooms.add(roomId);
  roomSeenAt.set(roomId, Date.now());
}

function validLatLng(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

const ROOM_ID_RE = /^[A-Za-z0-9_-]{6,64}$/;

const roomSweep = setInterval(() => {
  const cutoff = Date.now() - ROOM_TTL_MS;
  for (const [id, seen] of roomSeenAt) {
    if (seen >= cutoff) continue;
    roomSeenAt.delete(id);
    rooms.delete(id);
    lastLocationByRoom.delete(id);
  }
}, 10 * 60 * 1000);
if (typeof roomSweep.unref === "function") roomSweep.unref();

app.post("/api/rooms", (_req, res) => {
  const roomId = nanoid(10);
  touchRoom(roomId);
  res.json({ roomId });
});

app.get("/api/rooms/:id", (req, res) => {
  res.json({ exists: rooms.has(req.params.id) });
});

/** Respaldo si el socket se corta: el visor puede seguir leyendo la última ubicación. */
app.get("/api/rooms/:id/location", (req, res) => {
  const id = req.params.id;
  if (!ROOM_ID_RE.test(id)) {
    res.status(400).json({ error: "Código inválido" });
    return;
  }
  res.set("Cache-Control", "no-store");
  const loc = lastLocationByRoom.get(id);
  if (!loc) {
    res.status(204).end();
    return;
  }
  res.json(loc);
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin(origin, callback) {
      callback(null, originAllowed(origin));
    },
    methods: ["GET", "POST"],
  },
  /** Móviles / pestaña en segundo plano: el default (20s) corta la sesión por “timeout” aunque el socket siga vivo. */
  pingTimeout: 120_000,
  pingInterval: 25_000,
});

io.on("connection", (socket) => {
  socket.on("join", async ({ roomId }, ack) => {
    if (typeof roomId !== "string" || !ROOM_ID_RE.test(roomId)) return;
    touchRoom(roomId);
    socket.join(roomId);
    const cached = lastLocationByRoom.get(roomId);
    if (cached) {
      socket.emit("location-update", cached);
    }
    const peers = (await io.in(roomId).fetchSockets()).length;
    io.to(roomId).emit("room-status", { peers });
    if (typeof ack === "function") {
      ack({ ok: true, peers, hasCached: !!cached });
    }
  });

  socket.on("location", (payload, ack) => {
    const { roomId, lat, lng, heading, accuracy, courseDeg } = payload ?? {};
    const reply = (body) => {
      if (typeof ack === "function") ack(body);
    };
    if (typeof roomId !== "string" || !ROOM_ID_RE.test(roomId) || !validLatLng(lat, lng)) {
      reply({ ok: false });
      return;
    }
    touchRoom(roomId);
    const update = {
      lat,
      lng,
      heading: typeof heading === "number" && Number.isFinite(heading) ? heading : null,
      courseDeg: typeof courseDeg === "number" && Number.isFinite(courseDeg) ? courseDeg : null,
      accuracy: typeof accuracy === "number" && Number.isFinite(accuracy) ? accuracy : undefined,
      t: Date.now(),
    };
    lastLocationByRoom.set(roomId, update);
    socket.to(roomId).emit("location-update", update);
    reply({ ok: true, t: update.t });
  });

  socket.on("stop-sharing", ({ roomId }) => {
    if (typeof roomId !== "string" || !ROOM_ID_RE.test(roomId)) return;
    lastLocationByRoom.delete(roomId);
    socket.leave(roomId);
    socket.to(roomId).emit("sharing-ended");
  });
});

/** Build del cliente (`npm run build` en la raíz del repo). Mismo host que la API → sin Vercel ni DNS a onrender aparte. */
const clientDist = path.join(__dirname, "..", "..", "client", "dist");
if (existsSync(clientDist)) {
  const spaIndex = path.join(clientDist, "index.html");
  app.use(express.static(clientDist, { index: false }));
  /** Solo rutas del SPA; nunca un catch-all que toque `/socket.io` (deja la petición colgada). */
  const sendSpa = (_req, res) => res.sendFile(spaIndex);
  app.get("/", sendSpa);
  app.get(/^\/(s|v)\/[^/]+$/, sendSpa);
}

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server http://0.0.0.0:${PORT}${existsSync(clientDist) ? " + SPA " + clientDist : ""}`);
});
