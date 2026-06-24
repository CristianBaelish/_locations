import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import http from "http";
import cors from "cors";
import { Server } from "socket.io";
import { nanoid } from "nanoid";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configuredPort = process.env.PORT == null ? 3001 : Number(process.env.PORT);
const PORT = Number.isFinite(configuredPort) ? configuredPort : 3001;
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

/** @typedef {{ shareToken: string, active: boolean }} Room */

/** @type {Map<string, Room>} */
const rooms = new Map();

/** @type {Map<string, { lat: number, lng: number, heading: number | null, courseDeg: number | null, accuracy?: number, t: number }>} */
const lastLocationByRoom = new Map();

function createRoom() {
  const roomId = nanoid(10);
  const shareToken = nanoid(32);
  rooms.set(roomId, { shareToken, active: true });
  return { roomId, shareToken };
}

function getActiveRoom(roomId) {
  const room = rooms.get(roomId);
  return room?.active ? room : null;
}

function shareTokenMatches(roomId, shareToken) {
  const room = rooms.get(roomId);
  return !!room && room.shareToken === shareToken;
}

function canWriteRoom(roomId, shareToken) {
  const room = getActiveRoom(roomId);
  return !!room && room.shareToken === shareToken;
}

app.post("/api/rooms", (_req, res) => {
  res.json(createRoom());
});

app.get("/api/rooms/:id", (req, res) => {
  const room = getActiveRoom(req.params.id);
  res.json({ exists: !!room });
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

const ROOM_ID_RE = /^[A-Za-z0-9_-]{6,64}$/;

function endSharing(roomId) {
  const room = rooms.get(roomId);
  if (!room || !room.active) return false;
  room.active = false;
  lastLocationByRoom.delete(roomId);
  io.to(roomId).emit("sharing-ended");
  return true;
}

app.post("/api/rooms/:id/stop", (req, res) => {
  const roomId = req.params.id;
  const { shareToken } = req.body ?? {};
  if (typeof roomId !== "string" || !ROOM_ID_RE.test(roomId)) {
    res.status(400).json({ ok: false });
    return;
  }
  if (typeof shareToken !== "string" || !shareTokenMatches(roomId, shareToken)) {
    res.status(403).json({ ok: false });
    return;
  }
  endSharing(roomId);
  res.json({ ok: true });
});

io.on("connection", (socket) => {
  socket.on("join", async ({ roomId }, ack) => {
    if (typeof roomId !== "string" || !ROOM_ID_RE.test(roomId)) return;
    const room = getActiveRoom(roomId);
    if (!room) {
      socket.emit("sharing-ended");
      if (typeof ack === "function") {
        ack({ ok: false, ended: true });
      }
      return;
    }
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

  socket.on("location", (payload) => {
    const { roomId, shareToken, lat, lng, heading, accuracy, courseDeg } = payload ?? {};
    if (typeof roomId !== "string" || !ROOM_ID_RE.test(roomId)) return;
    if (typeof shareToken !== "string" || !canWriteRoom(roomId, shareToken)) return;
    if (typeof lat !== "number" || typeof lng !== "number") return;
    socket.join(roomId);
    const update = {
      lat,
      lng,
      heading: typeof heading === "number" && Number.isFinite(heading) ? heading : null,
      courseDeg: typeof courseDeg === "number" && Number.isFinite(courseDeg) ? courseDeg : null,
      accuracy: typeof accuracy === "number" ? accuracy : undefined,
      t: Date.now(),
    };
    lastLocationByRoom.set(roomId, update);
    socket.to(roomId).emit("location-update", update);
  });

  socket.on("stop-sharing", ({ roomId, shareToken }) => {
    if (typeof roomId !== "string" || !ROOM_ID_RE.test(roomId)) return;
    if (typeof shareToken !== "string" || !shareTokenMatches(roomId, shareToken)) return;
    endSharing(roomId);
    socket.leave(roomId);
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

export { app, server, io };

export function startServer(port = PORT) {
  return server.listen(port, "0.0.0.0", () => {
    const address = server.address();
    const actualPort = address && typeof address === "object" ? address.port : port;
    console.log(`Server http://0.0.0.0:${actualPort}${existsSync(clientDist) ? " + SPA " + clientDist : ""}`);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startServer();
}
