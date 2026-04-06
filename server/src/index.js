import express from "express";
import http from "http";
import cors from "cors";
import { Server } from "socket.io";
import { nanoid } from "nanoid";

const PORT = Number(process.env.PORT) || 3001;
const app = express();

app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      /^http:\/\/192\.168\.\d+\.\d+:5173$/,
    ],
  })
);
app.use(express.json());

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
    origin: [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      /^http:\/\/192\.168\.\d+\.\d+:5173$/,
    ],
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

server.listen(PORT, () => {
  console.log(`Server http://localhost:${PORT}`);
});
