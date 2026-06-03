import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { io } from "socket.io-client";

const PORT = 43000 + (process.pid % 1000);
const SERVER_URL = `http://127.0.0.1:${PORT}`;
const SERVER_DIR = fileURLToPath(new URL("..", import.meta.url));

function waitForEvent(socket, event, timeoutMs = 1_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, onEvent);
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeoutMs);
    const onEvent = (payload) => {
      clearTimeout(timer);
      resolve(payload);
    };
    socket.once(event, onEvent);
  });
}

async function expectNoEvent(socket, event, timeoutMs = 250) {
  let received = false;
  const onEvent = () => {
    received = true;
  };
  socket.once(event, onEvent);
  await delay(timeoutMs);
  socket.off(event, onEvent);
  assert.equal(received, false);
}

async function waitForHealth() {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${SERVER_URL}/health`);
      if (res.ok && (await res.text()) === "ok") return;
    } catch {
      // Server is still starting.
    }
    await delay(100);
  }
  throw new Error("Server did not become healthy");
}

function connectSocket() {
  const socket = io(SERVER_URL, {
    path: "/socket.io",
    transports: ["polling"],
    timeout: 2_000,
    reconnection: false,
  });
  return waitForEvent(socket, "connect").then(() => socket);
}

function emitLocation(socket, roomId, lat, lng) {
  socket.emit("location", { roomId, lat, lng, heading: null, courseDeg: null });
}

test("joining a new room stops updates from the previous room", async (t) => {
  const server = spawn(process.execPath, ["src/index.js"], {
    cwd: SERVER_DIR,
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => {
    if (!server.killed) server.kill();
  });

  await waitForHealth();

  const viewer = await connectSocket();
  const sender = await connectSocket();
  t.after(() => {
    viewer.close();
    sender.close();
  });

  const roomA = "roomA1";
  const roomB = "roomB1";

  viewer.emit("join", { roomId: roomA });
  await delay(100);
  emitLocation(sender, roomA, 1, 2);
  assert.equal((await waitForEvent(viewer, "location-update")).lat, 1);

  viewer.emit("join", { roomId: roomB });
  await delay(100);
  emitLocation(sender, roomB, 3, 4);
  assert.equal((await waitForEvent(viewer, "location-update")).lat, 3);

  emitLocation(sender, roomA, 5, 6);
  await expectNoEvent(viewer, "location-update");

  viewer.emit("leave", { roomId: roomB });
  await delay(100);
  emitLocation(sender, roomB, 7, 8);
  await expectNoEvent(viewer, "location-update");

  viewer.emit("join");
  await delay(100);
  const health = await fetch(`${SERVER_URL}/health`);
  assert.equal(health.status, 200);
});
