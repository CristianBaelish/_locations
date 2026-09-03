import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import test from "node:test";
import { io as connectSocket } from "socket.io-client";

async function availablePort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const address = probe.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

async function waitForServer(origin) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/health`);
      if (response.ok) return;
    } catch {
      // The child may still be binding its port.
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("server did not start");
}

async function openSocket(origin) {
  const socket = connectSocket(origin, {
    transports: ["polling"],
    forceNew: true,
    reconnection: false,
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("socket connection timed out")), 2_000);
    socket.once("connect", () => {
      clearTimeout(timeout);
      resolve();
    });
    socket.once("connect_error", reject);
  });
  return socket;
}

function emitAck(socket, event, payload) {
  return new Promise((resolve, reject) => {
    socket.timeout(1_000).emit(event, payload, (error, response) => {
      if (error) reject(error);
      else resolve(response);
    });
  });
}

function nextEvent(socket, event) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off(event, onEvent);
      reject(new Error(`${event} timed out`));
    }, 1_000);
    const onEvent = (payload) => {
      clearTimeout(timeout);
      resolve(payload);
    };
    socket.once(event, onEvent);
  });
}

test("only the private share token can publish or stop a room", async (t) => {
  const port = await availablePort();
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(async () => {
    child.kill();
    await new Promise((resolve) => child.once("exit", resolve));
  });
  await waitForServer(origin);

  const createResponse = await fetch(`${origin}/api/rooms`, { method: "POST" });
  const { roomId, shareToken } = await createResponse.json();
  assert.equal(typeof shareToken, "string");

  const owner = await openSocket(origin);
  const viewer = await openSocket(origin);
  t.after(() => {
    owner.close();
    viewer.close();
  });
  assert.equal((await emitAck(owner, "join", { roomId })).ok, true);
  assert.equal((await emitAck(viewer, "join", { roomId })).ok, true);

  assert.deepEqual(
    await emitAck(viewer, "location", { roomId, lat: -34.6, lng: -58.4 }),
    { ok: false }
  );

  const firstUpdate = nextEvent(viewer, "location-update");
  assert.deepEqual(
    await emitAck(owner, "location", {
      roomId,
      shareToken,
      lat: 40.7,
      lng: -74,
    }),
    { ok: true }
  );
  assert.equal((await firstUpdate).lat, 40.7);

  assert.deepEqual(await emitAck(viewer, "stop-sharing", { roomId }), { ok: false });
  const secondUpdate = nextEvent(viewer, "location-update");
  await emitAck(owner, "location", {
    roomId,
    shareToken,
    lat: 40.8,
    lng: -74.1,
  });
  assert.equal((await secondUpdate).lat, 40.8);

  const ended = nextEvent(viewer, "sharing-ended");
  assert.deepEqual(await emitAck(owner, "stop-sharing", { roomId, shareToken }), { ok: true });
  await ended;
  const roomStatus = await fetch(`${origin}/api/rooms/${roomId}`).then((response) => response.json());
  assert.equal(roomStatus.exists, false);
});

test("the authenticated HTTP fallback ends sharing while sockets are unavailable", async (t) => {
  const port = await availablePort();
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(async () => {
    child.kill();
    await new Promise((resolve) => child.once("exit", resolve));
  });
  await waitForServer(origin);

  const { roomId, shareToken } = await fetch(`${origin}/api/rooms`, { method: "POST" }).then(
    (response) => response.json()
  );
  const viewer = await openSocket(origin);
  t.after(() => viewer.close());
  await emitAck(viewer, "join", { roomId });

  const forbidden = await fetch(`${origin}/api/rooms/${roomId}/stop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ shareToken: "viewer-does-not-have-this" }),
  });
  assert.equal(forbidden.status, 403);

  const ended = nextEvent(viewer, "sharing-ended");
  const stopped = await fetch(`${origin}/api/rooms/${roomId}/stop`, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: shareToken,
  });
  assert.equal(stopped.status, 204);
  await ended;
});

test("join does not mint a room that was never created", async (t) => {
  const port = await availablePort();
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(async () => {
    child.kill();
    await new Promise((resolve) => child.once("exit", resolve));
  });
  await waitForServer(origin);

  const spoofedId = "spoofedRoom";
  const viewer = await openSocket(origin);
  t.after(() => viewer.close());
  const join = await emitAck(viewer, "join", { roomId: spoofedId });
  assert.deepEqual(join, { ok: false, ended: true });
  const roomStatus = await fetch(`${origin}/api/rooms/${spoofedId}`).then((response) =>
    response.json()
  );
  assert.equal(roomStatus.exists, false);
});
