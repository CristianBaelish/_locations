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

/** Private capability returned only to the device that creates a room. */
/** @type {Map<string, string>} */
const shareTokenByRoom = new Map();

/** @type {Map<string, { roomId: string, lat: number, lng: number, heading: number | null, courseDeg: number | null, accuracy?: number, t: number }>} */
const lastLocationByRoom = new Map();

app.post("/api/rooms", (_req, res) => {
  const roomId = nanoid(10);
  const shareToken = nanoid(32);
  rooms.add(roomId);
  shareTokenByRoom.set(roomId, shareToken);
  res.json({ roomId, shareToken });
});

app.get("/api/rooms/:id", (req, res) => {
  res.json({ exists: rooms.has(req.params.id) });
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

function shareTokenValid(roomId, shareToken) {
  return (
    typeof roomId === "string" &&
    ROOM_ID_RE.test(roomId) &&
    typeof shareToken === "string" &&
    shareTokenByRoom.get(roomId) === shareToken
  );
}

function endSharing(roomId) {
  lastLocationByRoom.delete(roomId);
  shareTokenByRoom.delete(roomId);
  rooms.delete(roomId);
}

app.post("/api/rooms/:id/stop", (req, res) => {
  const { id: roomId } = req.params;
  const { shareToken } = req.body ?? {};
  if (!shareTokenValid(roomId, shareToken)) {
    res.status(403).json({ ok: false });
    return;
  }
  endSharing(roomId);
  io.to(roomId).emit("sharing-ended", { roomId });
  res.json({ ok: true });
});

io.on("connection", (socket) => {
  socket.on("join", async (payload, ack) => {
    const { roomId } = payload ?? {};
    if (typeof roomId !== "string" || !ROOM_ID_RE.test(roomId)) return;
    if (!rooms.has(roomId)) {
      if (typeof ack === "function") {
        ack({ ok: false, peers: 0, hasCached: false });
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

  socket.on("leave", async (payload) => {
    const { roomId } = payload ?? {};
    if (typeof roomId !== "string" || !ROOM_ID_RE.test(roomId)) return;
    socket.leave(roomId);
    if (!rooms.has(roomId)) return;
    const peers = (await io.in(roomId).fetchSockets()).length;
    io.to(roomId).emit("room-status", { peers });
  });

  socket.on("location", (payload) => {
    const { roomId, shareToken, lat, lng, heading, accuracy, courseDeg } = payload ?? {};
    if (!shareTokenValid(roomId, shareToken)) return;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return;
    const update = {
      roomId,
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

  socket.on("stop-sharing", (payload) => {
    const { roomId, shareToken } = payload ?? {};
    if (!shareTokenValid(roomId, shareToken)) return;
    endSharing(roomId);
    socket.leave(roomId);
    socket.to(roomId).emit("sharing-ended", { roomId });
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
