import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import test from "node:test";
import { io as createClient } from "socket.io-client";

const PORT = 31_000 + Math.floor(Math.random() * 1_000);
const BASE_URL = `http://127.0.0.1:${PORT}`;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth(child) {
  let lastError;
  for (let i = 0; i < 80; i += 1) {
    if (child.exitCode != null) {
      throw new Error(`server exited before health check with code ${child.exitCode}`);
    }
    try {
      const res = await fetch(`${BASE_URL}/health`);
      if (res.ok) return;
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw lastError ?? new Error("server did not become healthy");
}

async function startServer(t) {
  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });

  t.after(async () => {
    if (child.exitCode == null) {
      child.kill("SIGTERM");
      await Promise.race([once(child, "exit"), delay(1_000)]);
    }
  });

  try {
    await waitForHealth(child);
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${output}`);
  }
}

function connectClient(t) {
  const socket = createClient(BASE_URL, {
    path: "/socket.io",
    transports: ["polling"],
    timeout: 5_000,
    reconnection: false,
  });
  t.after(() => socket.close());
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("socket connect timeout")), 5_000);
    socket.once("connect", () => {
      clearTimeout(timeout);
      resolve(socket);
    });
    socket.once("connect_error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function waitForEvent(socket, event, timeoutMs = 1_000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off(event, onEvent);
      reject(new Error(`timed out waiting for ${event}`));
    }, timeoutMs);
    function onEvent(payload) {
      clearTimeout(timeout);
      resolve(payload);
    }
    socket.once(event, onEvent);
  });
}

async function assertNoEvent(socket, event, timeoutMs = 250) {
  let received = false;
  const onEvent = () => {
    received = true;
  };
  socket.once(event, onEvent);
  await delay(timeoutMs);
  socket.off(event, onEvent);
  assert.equal(received, false, `${event} should not be emitted`);
}

function emitWithAck(socket, event, payload) {
  return new Promise((resolve) => {
    socket.emit(event, payload, resolve);
  });
}

async function createRoom() {
  const res = await fetch(`${BASE_URL}/api/rooms`, { method: "POST" });
  assert.equal(res.ok, true);
  const data = await res.json();
  assert.equal(typeof data.roomId, "string");
  assert.equal(typeof data.shareToken, "string");
  return data;
}

test("room writes and stops require the private share token", async (t) => {
  await startServer(t);
  const { roomId, shareToken } = await createRoom();

  const sharer = await connectClient(t);
  const viewer = await connectClient(t);
  const attacker = await connectClient(t);

  await emitWithAck(viewer, "join", { roomId });
  await emitWithAck(sharer, "join", { roomId });

  const firstUpdate = waitForEvent(viewer, "location-update");
  assert.deepEqual(
    await emitWithAck(sharer, "location", {
      roomId,
      shareToken,
      lat: 10,
      lng: 20,
      heading: null,
      courseDeg: null,
    }),
    { ok: true }
  );
  assert.equal((await firstUpdate).lat, 10);

  assert.deepEqual(
    await emitWithAck(attacker, "location", {
      roomId,
      lat: 99,
      lng: 99,
      heading: null,
      courseDeg: null,
    }),
    { ok: false }
  );
  await assertNoEvent(viewer, "location-update");

  assert.deepEqual(await emitWithAck(attacker, "stop-sharing", { roomId }), { ok: false });
  await assertNoEvent(viewer, "sharing-ended");

  const lateViewer = await connectClient(t);
  const cachedUpdate = waitForEvent(lateViewer, "location-update");
  await emitWithAck(lateViewer, "join", { roomId });
  assert.equal((await cachedUpdate).lat, 10);

  const ended = waitForEvent(viewer, "sharing-ended");
  assert.deepEqual(await emitWithAck(sharer, "stop-sharing", { roomId, shareToken }), { ok: true });
  await ended;

  assert.deepEqual(
    await emitWithAck(sharer, "location", {
      roomId,
      shareToken,
      lat: 11,
      lng: 21,
      heading: null,
      courseDeg: null,
    }),
    { ok: false }
  );
  await assertNoEvent(viewer, "location-update");

  const endedLateViewer = await connectClient(t);
  const lateEnded = waitForEvent(endedLateViewer, "sharing-ended");
  await emitWithAck(endedLateViewer, "join", { roomId });
  await lateEnded;
  await assertNoEvent(endedLateViewer, "location-update");
});

test("REST stop fallback ends a room and rejects wrong tokens", async (t) => {
  await startServer(t);
  const { roomId, shareToken } = await createRoom();

  const sharer = await connectClient(t);
  const viewer = await connectClient(t);
  await emitWithAck(viewer, "join", { roomId });

  const firstUpdate = waitForEvent(viewer, "location-update");
  await emitWithAck(sharer, "location", {
    roomId,
    shareToken,
    lat: 30,
    lng: 40,
    heading: null,
    courseDeg: null,
  });
  await firstUpdate;

  const rejected = await fetch(`${BASE_URL}/api/rooms/${roomId}/stop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ shareToken: "wrong-token" }),
  });
  assert.equal(rejected.status, 403);
  await assertNoEvent(viewer, "sharing-ended");

  const ended = waitForEvent(viewer, "sharing-ended");
  const accepted = await fetch(`${BASE_URL}/api/rooms/${roomId}/stop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ shareToken }),
  });
  assert.equal(accepted.status, 204);
  await ended;

  const roomStatus = await fetch(`${BASE_URL}/api/rooms/${roomId}`);
  assert.deepEqual(await roomStatus.json(), { exists: false, ended: true });
});
