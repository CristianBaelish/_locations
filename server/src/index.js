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

function corsOriginCallback(origin, callback) {
  callback(null, originAllowed(origin));
}

/** `cors` invoca `origin` como (origin, callback) — hay que llamar a `callback`, si no la petición queda colgada. */
app.use(
  cors({
    origin: corsOriginCallback,
  })
);
app.use(express.json());

app.get("/health", (_req, res) => {
  res.type("text").send("ok");
});

/** @type {Set<string>} */
const rooms = new Set();

app.post("/api/rooms", (_req, res) => {
  const roomId = nanoid(10);
  rooms.add(roomId);
  res.json({ roomId });
});

app.get("/api/rooms/:id", (req, res) => {
  res.json({ exists: rooms.has(req.params.id) });
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: corsOriginCallback,
    methods: ["GET", "POST"],
  },
  /** Móviles / pestaña en segundo plano: el default (20s) corta la sesión por “timeout” aunque el socket siga vivo. */
  pingTimeout: 120_000,
  pingInterval: 25_000,
});

const ROOM_ID_RE = /^[A-Za-z0-9_-]{6,64}$/;

io.on("connection", (socket) => {
  socket.on("join", ({ roomId }) => {
    if (typeof roomId !== "string" || !ROOM_ID_RE.test(roomId)) return;
    rooms.add(roomId);
    socket.join(roomId);
  });

  socket.on("location", (payload) => {
    const { roomId, lat, lng, heading, accuracy, courseDeg } = payload ?? {};
    if (typeof roomId !== "string" || !ROOM_ID_RE.test(roomId)) return;
    if (typeof lat !== "number" || typeof lng !== "number") return;
    rooms.add(roomId);
    socket.to(roomId).emit("location-update", {
      lat,
      lng,
      heading: typeof heading === "number" && Number.isFinite(heading) ? heading : null,
      courseDeg: typeof courseDeg === "number" && Number.isFinite(courseDeg) ? courseDeg : null,
      accuracy: typeof accuracy === "number" ? accuracy : undefined,
      t: Date.now(),
    });
  });
});

/** Build del cliente (`npm run build` en la raíz del repo). Mismo host que la API → sin Vercel ni DNS a onrender aparte. */
const clientDist = path.join(__dirname, "..", "..", "client", "dist");
if (existsSync(clientDist)) {
  app.use(express.static(clientDist, { index: false }));
  app.get(/.*/, (req, res, next) => {
    if (req.method !== "GET") return next();
    if (req.path.startsWith("/socket.io")) return next();
    if (req.path.startsWith("/api")) return next();
    if (req.path === "/health") return next();
    res.sendFile(path.join(clientDist, "index.html"), (err) => next(err));
  });
}

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server http://0.0.0.0:${PORT}${existsSync(clientDist) ? " + SPA " + clientDist : ""}`);
});
