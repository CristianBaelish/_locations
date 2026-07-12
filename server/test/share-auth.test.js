import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { spawn } from "node:child_process";
import net from "node:net";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { io as createClient } from "socket.io-client";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, "..");

let child;
let baseUrl;
/** @type {import("socket.io-client").Socket[]} */
let sockets = [];

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert(address && typeof address === "object");
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

function waitForServer(proc) {
  let output = "";
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`server did not start:\n${output}`));
    }, 5_000);

    const onData = (chunk) => {
      output += chunk.toString();
      if (output.includes("Server http://")) {
        clearTimeout(timer);
        resolve();
      }
    };

    proc.stdout.on("data", onData);
    proc.stderr.on("data", onData);
    proc.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited with ${code}:\n${output}`));
    });
  });
}

async function requestJson(pathname, init) {
  const res = await fetch(`${baseUrl}${pathname}`, init);
  const text = await res.text();
  return {
    ok: res.ok,
    status: res.status,
    data: text ? JSON.parse(text) : null,
  };
}

async function createRoom() {
  const res = await requestJson("/api/rooms", { method: "POST" });
  assert.equal(res.ok, true);
  assert.equal(typeof res.data.roomId, "string");
  assert.equal(typeof res.data.shareToken, "string");
  return res.data;
}

async function connectSocket() {
  const socket = createClient(baseUrl, {
    path: "/socket.io",
    transports: ["polling"],
    timeout: 2_000,
    reconnection: false,
    forceNew: true,
  });
  sockets.push(socket);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("socket connect timeout")), 2_000);
    socket.once("connect", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once("connect_error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
  return socket;
}

function joinRoom(socket, roomId) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("join ack timeout")), 2_000);
    socket.emit("join", { roomId }, (ack) => {
      clearTimeout(timer);
      resolve(ack);
    });
  });
}

function onceEvent(socket, event) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} timeout`)), 2_000);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

before(async () => {
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ["src/index.js"], {
    cwd: serverRoot,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForServer(child);
});

afterEach(() => {
  for (const socket of sockets) {
    socket.close();
  }
  sockets = [];
});

after(async () => {
  if (!child || child.killed) return;
  child.kill();
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    delay(1_000),
  ]);
});

test("rejects location updates without the private share token", async () => {
  const { roomId, shareToken } = await createRoom();
  const viewer = await connectSocket();
  const attacker = await connectSocket();
  const sharer = await connectSocket();
  const received = [];

  assert.equal((await joinRoom(viewer, roomId)).ok, true);
  viewer.on("location-update", (payload) => received.push(payload));

  attacker.emit("location", { roomId, lat: 1, lng: 2 });
  await delay(150);
  assert.deepEqual(received, []);

  const validUpdate = onceEvent(viewer, "location-update");
  sharer.emit("location", { roomId, shareToken, lat: 3, lng: 4, heading: 90 });
  const payload = await validUpdate;

  assert.equal(payload.roomId, roomId);
  assert.equal(payload.lat, 3);
  assert.equal(payload.lng, 4);
  assert.equal(payload.heading, 90);
});

test("rejects stop-sharing without the private share token", async () => {
  const { roomId, shareToken } = await createRoom();
  const viewer = await connectSocket();
  const attacker = await connectSocket();
  const sharer = await connectSocket();
  let ended = false;

  assert.equal((await joinRoom(viewer, roomId)).ok, true);
  viewer.on("sharing-ended", () => {
    ended = true;
  });

  attacker.emit("stop-sharing", { roomId });
  await delay(150);
  assert.equal(ended, false);

  const validEnd = onceEvent(viewer, "sharing-ended");
  sharer.emit("stop-sharing", { roomId, shareToken });
  const payload = await validEnd;
  assert.equal(payload.roomId, roomId);

  const roomStatus = await requestJson(`/api/rooms/${roomId}`);
  assert.equal(roomStatus.ok, true);
  assert.deepEqual(roomStatus.data, { exists: false });
});
