import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { io as createSocket } from "socket.io-client";

async function freePort() {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  const { port } = address;
  server.close();
  await once(server, "close");
  return port;
}

async function waitForHealth(baseUrl) {
  const deadline = Date.now() + 10_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok) return;
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw lastError ?? new Error("server did not become healthy");
}

async function startServer(t) {
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });
  t.after(() => {
    child.kill();
  });

  try {
    await waitForHealth(baseUrl);
  } catch (error) {
    child.kill();
    throw new Error(`server failed to start: ${output}\n${error}`);
  }

  return { baseUrl };
}

function connectSocket(t, baseUrl) {
  const socket = createSocket(baseUrl, {
    transports: ["polling"],
    timeout: 5_000,
    forceNew: true,
  });
  t.after(() => {
    socket.close();
  });
  return socket;
}

async function connectAndJoin(t, baseUrl, roomId) {
  const socket = connectSocket(t, baseUrl);
  await once(socket, "connect");
  const ack = await socket.timeout(1_000).emitWithAck("join", { roomId });
  assert.equal(ack.ok, true);
  return socket;
}

function waitForSocketEvent(socket, event, timeoutMs = 1_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, onEvent);
      reject(new Error(`timed out waiting for ${event}`));
    }, timeoutMs);

    function onEvent(payload) {
      clearTimeout(timer);
      resolve(payload);
    }

    socket.once(event, onEvent);
  });
}

async function createRoom(baseUrl) {
  const res = await fetch(`${baseUrl}/api/rooms`, { method: "POST" });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(typeof body.roomId, "string");
  assert.equal(typeof body.shareToken, "string");
  return body;
}

test("public room id cannot publish locations or stop sharing", async (t) => {
  const { baseUrl } = await startServer(t);
  const { roomId, shareToken } = await createRoom(baseUrl);
  const viewer = await connectAndJoin(t, baseUrl, roomId);
  const attacker = connectSocket(t, baseUrl);
  await once(attacker, "connect");

  attacker.emit("location", { roomId, lat: 99, lng: 99 });
  await delay(100);

  const lateViewer = connectSocket(t, baseUrl);
  await once(lateViewer, "connect");
  const emptyAck = await lateViewer.timeout(1_000).emitWithAck("join", { roomId });
  assert.equal(emptyAck.hasCached, false);

  const sharer = connectSocket(t, baseUrl);
  await once(sharer, "connect");
  const updatePromise = waitForSocketEvent(viewer, "location-update");
  sharer.emit("location", { roomId, shareToken, lat: 1, lng: 2, heading: null, courseDeg: null });
  const update = await updatePromise;
  assert.equal(update.lat, 1);
  assert.equal(update.lng, 2);

  let ended = false;
  viewer.once("sharing-ended", () => {
    ended = true;
  });
  attacker.emit("stop-sharing", { roomId });
  await delay(100);
  assert.equal(ended, false);

  const cachedViewer = connectSocket(t, baseUrl);
  await once(cachedViewer, "connect");
  const cachedUpdatePromise = waitForSocketEvent(cachedViewer, "location-update");
  const cachedAck = await cachedViewer.timeout(1_000).emitWithAck("join", { roomId });
  assert.equal(cachedAck.hasCached, true);
  const cachedUpdate = await cachedUpdatePromise;
  assert.equal(cachedUpdate.lat, 1);
  assert.equal(cachedUpdate.lng, 2);

  const endedPromise = waitForSocketEvent(viewer, "sharing-ended");
  sharer.emit("stop-sharing", { roomId, shareToken });
  await endedPromise;
});

test("REST stop endpoint requires the creator share token", async (t) => {
  const { baseUrl } = await startServer(t);
  const { roomId, shareToken } = await createRoom(baseUrl);
  const viewer = await connectAndJoin(t, baseUrl, roomId);
  const sharer = connectSocket(t, baseUrl);
  await once(sharer, "connect");

  const updatePromise = waitForSocketEvent(viewer, "location-update");
  sharer.emit("location", { roomId, shareToken, lat: 3, lng: 4, heading: null, courseDeg: null });
  await updatePromise;

  const forbidden = await fetch(`${baseUrl}/api/rooms/${roomId}/stop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ shareToken: "wrong-token" }),
  });
  assert.equal(forbidden.status, 403);

  let ended = false;
  viewer.once("sharing-ended", () => {
    ended = true;
  });
  await delay(100);
  assert.equal(ended, false);

  const endedPromise = waitForSocketEvent(viewer, "sharing-ended");
  const stopped = await fetch(`${baseUrl}/api/rooms/${roomId}/stop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ shareToken }),
  });
  assert.equal(stopped.status, 200);
  await endedPromise;
});
