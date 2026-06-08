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

/** @type {Map<string, { shareToken?: string, ended: boolean }>} */
const rooms = new Map();

/** @type {Map<string, { lat: number, lng: number, heading: number | null, courseDeg: number | null, accuracy?: number, t: number }>} */
const lastLocationByRoom = new Map();

function validRoomId(roomId) {
  return typeof roomId === "string" && ROOM_ID_RE.test(roomId);
}

function validShareToken(shareToken) {
  return typeof shareToken === "string" && /^[A-Za-z0-9_-]{16,128}$/.test(shareToken);
}

function activeRoomForToken(roomId, shareToken) {
  if (!validRoomId(roomId) || !validShareToken(shareToken)) return null;
  const room = rooms.get(roomId);
  if (!room || room.ended || room.shareToken !== shareToken) return null;
  return room;
}

app.post("/api/rooms", (_req, res) => {
  const roomId = nanoid(10);
  const shareToken = nanoid(32);
  rooms.set(roomId, { shareToken, ended: false });
  res.json({ roomId, shareToken });
});

app.get("/api/rooms/:id", (req, res) => {
  const room = rooms.get(req.params.id);
  res.json({ exists: !!room && !room.ended, ended: !!room?.ended });
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

function endSharing(roomId, shareToken) {
  const room = activeRoomForToken(roomId, shareToken);
  if (!room) return false;
  room.ended = true;
  delete room.shareToken;
  lastLocationByRoom.delete(roomId);
  io.to(roomId).emit("sharing-ended");
  return true;
}

app.post("/api/rooms/:id/stop", (req, res) => {
  if (!validRoomId(req.params.id)) {
    res.status(400).json({ ok: false });
    return;
  }
  const ok = endSharing(req.params.id, req.body?.shareToken);
  res.status(ok ? 204 : 403).end();
});

io.on("connection", (socket) => {
  socket.on("join", async ({ roomId }, ack) => {
    if (!validRoomId(roomId)) return;
    socket.join(roomId);
    const room = rooms.get(roomId);
    const cached = room && !room.ended ? lastLocationByRoom.get(roomId) : undefined;
    if (room?.ended) {
      socket.emit("sharing-ended");
    } else if (cached) {
      socket.emit("location-update", cached);
    }
    const peers = (await io.in(roomId).fetchSockets()).length;
    io.to(roomId).emit("room-status", { peers });
    if (typeof ack === "function") {
      ack({ ok: true, peers, exists: !!room, ended: !!room?.ended, hasCached: !!cached });
    }
  });

  socket.on("location", (payload, ack) => {
    const { roomId, shareToken, lat, lng, heading, accuracy, courseDeg } = payload ?? {};
    const room = activeRoomForToken(roomId, shareToken);
    if (!room) {
      if (typeof ack === "function") ack({ ok: false });
      return;
    }
    if (typeof lat !== "number" || typeof lng !== "number") {
      if (typeof ack === "function") ack({ ok: false });
      return;
    }
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
    if (typeof ack === "function") ack({ ok: true });
  });

  socket.on("stop-sharing", ({ roomId, shareToken }, ack) => {
    const ok = endSharing(roomId, shareToken);
    if (validRoomId(roomId)) {
      socket.leave(roomId);
    }
    if (typeof ack === "function") ack({ ok });
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
