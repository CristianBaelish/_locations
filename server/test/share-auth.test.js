import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { io as clientIo } from "socket.io-client";

function onceWithTimeout(socket, event, timeoutMs = 500) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeoutMs);

    const onEvent = (...args) => {
      cleanup();
      resolve(args);
    };

    const cleanup = () => {
      clearTimeout(timer);
      socket.off(event, onEvent);
    };

    socket.on(event, onEvent);
  });
}

async function assertNoEvent(socket, event) {
  await assert.rejects(onceWithTimeout(socket, event, 200), /Timed out/);
}

function connectSocket(baseUrl) {
  const socket = clientIo(baseUrl, {
    path: "/socket.io",
    transports: ["polling"],
    timeout: 5_000,
    reconnection: false,
  });
  return socket;
}

function emitJoin(socket, roomId) {
  return new Promise((resolve) => {
    socket.emit("join", { roomId }, resolve);
  });
}

async function startServer(t) {
  const port = 31_000 + Math.floor(Math.random() * 10_000);
  const server = spawn(process.execPath, ["src/index.js"], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  t.after(() => {
    server.kill();
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i += 1) {
    if (server.exitCode != null) {
      throw new Error(`Server exited early with ${server.exitCode}`);
    }
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok) return baseUrl;
    } catch {
      // Keep polling until the child process starts listening.
    }
    await delay(50);
  }

  throw new Error("Server did not start");
}

test("public room IDs cannot write or stop sharing without the private share token", async (t) => {
  const baseUrl = await startServer(t);

  const createRes = await fetch(`${baseUrl}/api/rooms`, { method: "POST" });
  assert.equal(createRes.status, 200);
  const { roomId, shareToken } = await createRes.json();
  assert.equal(typeof roomId, "string");
  assert.equal(typeof shareToken, "string");

  const viewer = connectSocket(baseUrl);
  const attacker = connectSocket(baseUrl);
  const sharer = connectSocket(baseUrl);
  t.after(() => {
    viewer.close();
    attacker.close();
    sharer.close();
  });

  await Promise.all([
    onceWithTimeout(viewer, "connect", 2_000),
    onceWithTimeout(attacker, "connect", 2_000),
    onceWithTimeout(sharer, "connect", 2_000),
  ]);
  await Promise.all([emitJoin(viewer, roomId), emitJoin(attacker, roomId), emitJoin(sharer, roomId)]);

  attacker.emit("location", { roomId, lat: 1, lng: 2 });
  await assertNoEvent(viewer, "location-update");

  attacker.emit("location", { roomId, shareToken: "wrong-token", lat: 3, lng: 4 });
  await assertNoEvent(viewer, "location-update");

  sharer.emit("location", { roomId, shareToken, lat: 5, lng: 6 });
  const [update] = await onceWithTimeout(viewer, "location-update", 1_000);
  assert.equal(update.lat, 5);
  assert.equal(update.lng, 6);

  attacker.emit("stop-sharing", { roomId });
  await assertNoEvent(viewer, "sharing-ended");

  const badStopRes = await fetch(`${baseUrl}/api/rooms/${roomId}/stop`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ shareToken: "wrong-token" }),
  });
  assert.equal(badStopRes.status, 403);
  await assertNoEvent(viewer, "sharing-ended");

  const stopRes = await fetch(`${baseUrl}/api/rooms/${roomId}/stop`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ shareToken }),
  });
  assert.equal(stopRes.status, 200);
  await onceWithTimeout(viewer, "sharing-ended", 1_000);
});
