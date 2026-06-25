import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import { test } from "node:test";
import { io as connectSocket } from "socket.io-client";

async function getFreePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  assert(address && typeof address === "object");
  return address.port;
}

async function waitForHealth(baseUrl) {
  const deadline = Date.now() + 5_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok) return;
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
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => {
    child.kill();
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForHealth(baseUrl);
  return baseUrl;
}

async function createRoom(baseUrl) {
  const res = await fetch(`${baseUrl}/api/rooms`, { method: "POST" });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(typeof body.roomId, "string");
  assert.equal(typeof body.shareToken, "string");
  return body;
}

function openSocket(t, baseUrl) {
  const socket = connectSocket(baseUrl, {
    transports: ["polling"],
    timeout: 2_000,
    forceNew: true,
  });
  t.after(() => {
    socket.close();
  });
  return new Promise((resolve, reject) => {
    socket.once("connect", () => resolve(socket));
    socket.once("connect_error", reject);
  });
}

function joinRoom(socket, roomId) {
  return new Promise((resolve) => {
    socket.emit("join", { roomId }, resolve);
  });
}

function onceWithTimeout(socket, event, timeoutMs = 500) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, onEvent);
      reject(new Error(`timed out waiting for ${event}`));
    }, timeoutMs);
    const onEvent = (payload) => {
      clearTimeout(timer);
      resolve(payload);
    };
    socket.once(event, onEvent);
  });
}

test("public room ids cannot publish or stop a share", async (t) => {
  const baseUrl = await startServer(t);
  const { roomId, shareToken } = await createRoom(baseUrl);

  const viewer = await openSocket(t, baseUrl);
  await joinRoom(viewer, roomId);

  const sharer = await openSocket(t, baseUrl);
  const firstUpdate = onceWithTimeout(viewer, "location-update");
  sharer.emit("location", { roomId, shareToken, lat: 10, lng: 20, heading: null, courseDeg: null });
  assert.equal((await firstUpdate).lat, 10);

  const attacker = await openSocket(t, baseUrl);
  attacker.emit("location", { roomId, lat: 66, lng: 77, heading: null, courseDeg: null });
  attacker.emit("stop-sharing", { roomId });
  await new Promise((resolve) => setTimeout(resolve, 100));

  const lateViewer = await openSocket(t, baseUrl);
  const cachedUpdate = onceWithTimeout(lateViewer, "location-update");
  const ack = await joinRoom(lateViewer, roomId);
  assert.equal(ack.hasCached, true);
  assert.equal((await cachedUpdate).lat, 10);

  const ended = onceWithTimeout(viewer, "sharing-ended");
  sharer.emit("stop-sharing", { roomId, shareToken });
  await ended;
});
