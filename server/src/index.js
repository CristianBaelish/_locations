import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import http from "http";
import cors from "cors";
import { Server } from "socket.io";
import { nanoid } from "nanoid";
import { corsOrigin } from "./cors-origin.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3001;
const app = express();

/** `cors` invoca `origin` como (origin, callback) — hay que llamar a `callback`, si no la petición queda colgada. */
app.use(
  cors({
    origin: corsOrigin,
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
    origin: corsOrigin,
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
