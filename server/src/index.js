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

/** Salas cerradas con «Dejar de compartir». Un POST tardío no las revive. */
const stoppedRooms = new Set();

/** Última generación que quien comparte mandó en primer plano. */
const liveEpochByRoom = new Map();

/** Generación con la que la pantalla pasó a segundo plano. */
const pausedEpochByRoom = new Map();

const ROOM_TTL_MS = 12 * 60 * 60 * 1000;

function touchRoom(roomId) {
  rooms.add(roomId);
  roomSeenAt.set(roomId, Date.now());
}

function validLatLng(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

const ROOM_ID_RE = /^[A-Za-z0-9_-]{6,64}$/;

function readEpoch(value) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 1_000_000) return null;
  return value;
}

function liveEpoch(roomId) {
  return liveEpochByRoom.get(roomId) ?? 0;
}

function saveLocation(roomId, payload) {
  const { lat, lng, heading, accuracy, courseDeg } = payload ?? {};
  if (typeof roomId !== "string" || !ROOM_ID_RE.test(roomId) || stoppedRooms.has(roomId) || !validLatLng(lat, lng)) {
    return null;
  }
  const epoch = readEpoch(payload?.epoch);
  const pausedEpoch = pausedEpochByRoom.get(roomId);
  const paused = pausedEpoch != null && pausedEpoch >= liveEpoch(roomId);
  if (paused && (epoch == null || epoch <= pausedEpoch)) {
    return { ignored: true };
  }
  touchRoom(roomId);
  if (epoch != null) {
    liveEpochByRoom.set(roomId, Math.max(liveEpoch(roomId), epoch));
    if (pausedEpoch == null || epoch > pausedEpoch) pausedEpochByRoom.delete(roomId);
  }
  const update = {
    lat,
    lng,
    heading: typeof heading === "number" && Number.isFinite(heading) ? heading : null,
    courseDeg: typeof courseDeg === "number" && Number.isFinite(courseDeg) ? courseDeg : null,
    accuracy: typeof accuracy === "number" && Number.isFinite(accuracy) ? accuracy : undefined,
    t: Date.now(),
    paused: false,
  };
  lastLocationByRoom.set(roomId, update);
  return update;
}

const roomSweep = setInterval(() => {
  const cutoff = Date.now() - ROOM_TTL_MS;
  for (const [id, seen] of roomSeenAt) {
    if (seen >= cutoff) continue;
    roomSeenAt.delete(id);
    rooms.delete(id);
    lastLocationByRoom.delete(id);
    liveEpochByRoom.delete(id);
    pausedEpochByRoom.delete(id);
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
  if (stoppedRooms.has(id)) {
    res.json({ ended: true });
    return;
  }
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

function endRoom(roomId) {
  if (typeof roomId !== "string" || !ROOM_ID_RE.test(roomId)) return false;
  if (stoppedRooms.has(roomId)) return false;
  stoppedRooms.add(roomId);
  lastLocationByRoom.delete(roomId);
  liveEpochByRoom.delete(roomId);
  pausedEpochByRoom.delete(roomId);
  rooms.delete(roomId);
  roomSeenAt.delete(roomId);
  io.to(roomId).emit("sharing-ended");
  io.to(roomId).emit("room-status", { watchers: 0, peers: 1 });
  return true;
}

function watcherTotal(list, exceptId) {
  const ids = new Set();
  for (const peer of list) {
    if (exceptId && peer.id === exceptId) continue;
    if (peer.data?.role !== "viewer") continue;
    const id =
      typeof peer.data.clientId === "string" && peer.data.clientId.length > 0
        ? peer.data.clientId
        : peer.id;
    ids.add(id);
  }
  return ids.size;
}

function publishWatcherCount(roomId, list) {
  const watchers = watcherTotal(list);
  io.to(roomId).emit("room-status", { watchers, peers: watchers + 1 });
  return watchers;
}

function emitWatcherCount(roomId, exceptId) {
  void io
    .in(roomId)
    .fetchSockets()
    .then((list) => {
      const watchers = watcherTotal(list, exceptId);
      io.to(roomId).emit("room-status", { watchers, peers: watchers + 1 });
    })
    .catch(() => {
      /* la cuenta de quien mira es accesoria */
    });
}

/** Respaldo del socket: si el polling se corta, el visor igual lee esta posición por HTTP. */
app.post("/api/rooms/:id/location", (req, res) => {
  res.set("Cache-Control", "no-store");
  const id = req.params.id;
  if (typeof id !== "string" || !ROOM_ID_RE.test(id)) {
    res.status(400).json({ error: "Código inválido" });
    return;
  }
  if (stoppedRooms.has(id)) {
    res.status(409).json({ ended: true });
    return;
  }
  const update = saveLocation(id, req.body);
  if (update?.ignored) {
    res.json({ ok: true, paused: true });
    return;
  }
  if (!update) {
    res.status(400).json({ error: "Ubicación inválida" });
    return;
  }
  io.to(id).emit("location-update", update);
  res.json({ ok: true, t: update.t });
});

app.post("/api/rooms/:id/pause", (req, res) => {
  res.set("Cache-Control", "no-store");
  const id = req.params.id;
  if (typeof id !== "string" || !ROOM_ID_RE.test(id)) {
    res.status(400).json({ error: "Código inválido" });
    return;
  }
  if (stoppedRooms.has(id)) {
    res.status(409).json({ ended: true });
    return;
  }
  const epoch = readEpoch(req.body?.epoch);
  if (epoch == null) {
    res.status(400).json({ error: "Generación inválida" });
    return;
  }
  if (epoch < liveEpoch(id)) {
    res.json({ ok: true, paused: false });
    return;
  }
  touchRoom(id);
  pausedEpochByRoom.set(id, epoch);
  const loc = lastLocationByRoom.get(id);
  const notice = loc ? { ...loc, paused: true } : { paused: true };
  if (loc) lastLocationByRoom.set(id, notice);
  io.to(id).emit("sharing-paused", notice);
  res.json({ ok: true, paused: true });
});

app.post("/api/rooms/:id/stop", (req, res) => {
  res.set("Cache-Control", "no-store");
  const id = req.params.id;
  if (typeof id !== "string" || !ROOM_ID_RE.test(id)) {
    res.status(400).json({ error: "Código inválido" });
    return;
  }
  endRoom(id);
  res.json({ ok: true, ended: true });
});

io.on("connection", (socket) => {
  socket.on("join", async ({ roomId, role, clientId }, ack) => {
    if (typeof roomId !== "string" || !ROOM_ID_RE.test(roomId)) return;
    if (stoppedRooms.has(roomId)) {
      socket.emit("sharing-ended");
      if (typeof ack === "function") ack({ ok: false, ended: true });
      return;
    }
    touchRoom(roomId);
    socket.data.role = role === "sharer" || role === "viewer" ? role : null;
    socket.data.clientId =
      typeof clientId === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(clientId) ? clientId : socket.id;
    socket.join(roomId);
    const cached = lastLocationByRoom.get(roomId);
    if (cached) {
      socket.emit("location-update", cached);
    }
    const list = await io.in(roomId).fetchSockets();
    const watchers = publishWatcherCount(roomId, list);
    if (typeof ack === "function") {
      ack({ ok: true, peers: watchers + 1, watchers, hasCached: !!cached });
    }
  });

  socket.on("location", (payload, ack) => {
    const reply = (body) => {
      if (typeof ack === "function") ack(body);
    };
    const roomId = payload?.roomId;
    const update = saveLocation(roomId, payload);
    if (update?.ignored) {
      reply({ ok: true, paused: true });
      return;
    }
    if (!update) {
      reply({ ok: false });
      return;
    }
    socket.to(roomId).emit("location-update", update);
    reply({ ok: true, t: update.t });
  });

  socket.on("stop-sharing", ({ roomId }) => {
    if (typeof roomId !== "string" || !ROOM_ID_RE.test(roomId)) return;
    endRoom(roomId);
    socket.leave(roomId);
  });

  socket.on("disconnecting", () => {
    for (const roomId of socket.rooms) {
      if (roomId === socket.id || !ROOM_ID_RE.test(roomId) || stoppedRooms.has(roomId)) continue;
      emitWatcherCount(roomId, socket.id);
    }
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
