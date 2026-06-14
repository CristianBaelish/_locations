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

/** @type {Map<string, { shareToken: string, active: boolean }>} */
const rooms = new Map();

/** @type {Map<string, { lat: number, lng: number, heading: number | null, courseDeg: number | null, accuracy?: number, t: number }>} */
const lastLocationByRoom = new Map();

app.post("/api/rooms", (_req, res) => {
  const roomId = nanoid(10);
  const shareToken = nanoid(32);
  rooms.set(roomId, { shareToken, active: true });
  res.json({ roomId, shareToken });
});

app.get("/api/rooms/:id", (req, res) => {
  const room = rooms.get(req.params.id);
  res.json({ exists: !!room && room.active });
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

function objectPayload(payload) {
  return payload && typeof payload === "object" ? payload : {};
}

function isValidShareToken(roomId, shareToken) {
  const room = rooms.get(roomId);
  return !!room && room.active && typeof shareToken === "string" && room.shareToken === shareToken;
}

io.on("connection", (socket) => {
  socket.on("join", async (payload, ack) => {
    const { roomId } = objectPayload(payload);
    if (typeof roomId !== "string" || !ROOM_ID_RE.test(roomId)) return;
    const room = rooms.get(roomId);
    if (!room) return;
    socket.join(roomId);
    if (!room.active) {
      socket.emit("sharing-ended");
      if (typeof ack === "function") {
        ack({ ok: false, ended: true });
      }
      return;
    }
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
    const { roomId, shareToken, lat, lng, heading, accuracy, courseDeg } = objectPayload(payload);
    if (typeof roomId !== "string" || !ROOM_ID_RE.test(roomId)) return;
    if (!isValidShareToken(roomId, shareToken)) return;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
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
  });

  socket.on("stop-sharing", (payload) => {
    const { roomId, shareToken } = objectPayload(payload);
    if (typeof roomId !== "string" || !ROOM_ID_RE.test(roomId)) return;
    if (!isValidShareToken(roomId, shareToken)) return;
    const room = rooms.get(roomId);
    if (room) {
      room.active = false;
    }
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
