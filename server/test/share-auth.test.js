import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { io as createClient } from "socket.io-client";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.join(__dirname, "..");

async function getFreePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  const { port } = address;
  server.close();
  await once(server, "close");
  return port;
}

async function waitForHealth(origin) {
  const deadline = Date.now() + 5000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${origin}/health`);
      if (res.ok && (await res.text()) === "ok") return;
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw lastError ?? new Error("server did not become healthy");
}

async function startServer(t) {
  const port = await getFreePort();
  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: serverRoot,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => {
    child.kill();
  });
  const origin = `http://127.0.0.1:${port}`;
  await waitForHealth(origin);
  return origin;
}

async function connectSocket(t, origin) {
  const socket = createClient(origin, {
    path: "/socket.io",
    transports: ["polling"],
    timeout: 2000,
    forceNew: true,
  });
  t.after(() => {
    socket.close();
  });
  await once(socket, "connect");
  return socket;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function onceSocket(socket, event) {
  return new Promise((resolve) => {
    socket.once(event, resolve);
  });
}

test("room writes require the private share token", async (t) => {
  const origin = await startServer(t);
  const createRes = await fetch(`${origin}/api/rooms`, { method: "POST" });
  assert.equal(createRes.status, 200);
  const { roomId, shareToken } = await createRes.json();
  assert.equal(typeof roomId, "string");
  assert.equal(typeof shareToken, "string");

  const viewer = await connectSocket(t, origin);
  const sharer = await connectSocket(t, origin);

  await new Promise((resolve) => {
    viewer.emit("join", { roomId }, resolve);
  });
  await new Promise((resolve) => {
    sharer.emit("join", { roomId }, resolve);
  });

  let spoofed = false;
  const onSpoofed = () => {
    spoofed = true;
  };
  viewer.on("location-update", onSpoofed);
  viewer.emit("location", { roomId, lat: 1, lng: 2 });
  await wait(200);
  viewer.off("location-update", onSpoofed);
  assert.equal(spoofed, false);

  const validUpdate = onceSocket(viewer, "location-update");
  sharer.emit("location", { roomId, shareToken, lat: 10, lng: 20, heading: null });
  const update = await validUpdate;
  assert.equal(update.lat, 10);
  assert.equal(update.lng, 20);
  assert.equal(update.heading, null);
  assert.equal(update.courseDeg, null);
  assert.equal(typeof update.t, "number");

  let stoppedByViewer = false;
  const onStoppedByViewer = () => {
    stoppedByViewer = true;
  };
  viewer.on("sharing-ended", onStoppedByViewer);
  viewer.emit("stop-sharing", { roomId });
  await wait(200);
  viewer.off("sharing-ended", onStoppedByViewer);
  assert.equal(stoppedByViewer, false);

  const existsAfterUnauthorizedStop = await fetch(`${origin}/api/rooms/${roomId}`);
  assert.deepEqual(await existsAfterUnauthorizedStop.json(), { exists: true });

  const ended = onceSocket(viewer, "sharing-ended");
  sharer.emit("stop-sharing", { roomId, shareToken });
  await ended;

  const existsAfterAuthorizedStop = await fetch(`${origin}/api/rooms/${roomId}`);
  assert.deepEqual(await existsAfterAuthorizedStop.json(), { exists: false });
});
