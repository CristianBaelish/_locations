import express from "express";
import http from "http";
import cors from "cors";
import { Server } from "socket.io";
import { nanoid } from "nanoid";

const PORT = Number(process.env.PORT) || 3001;
const app = express();

/**
 * Orígenes permitidos: dev local + URLs en FRONTEND_URL (coma-separadas) + subdominios vercel.app
 * En Render: FRONTEND_URL=https://tu-app.vercel.app
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
  if (origin.startsWith("https://") && origin.includes(".vercel.app")) return true;
  return false;
}

app.use(
  cors({
    origin: originAllowed,
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
    origin: originAllowed,
    methods: ["GET", "POST"],
  },
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
      heading: typeof heading === "number" ? heading : undefined,
      courseDeg: typeof courseDeg === "number" ? courseDeg : undefined,
      accuracy: typeof accuracy === "number" ? accuracy : undefined,
      t: Date.now(),
    });
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server http://0.0.0.0:${PORT}`);
});
