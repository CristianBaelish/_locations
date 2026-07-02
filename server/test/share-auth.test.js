import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import net from "node:net";
import test from "node:test";
import { io } from "socket.io-client";

const serverRoot = fileURLToPath(new URL("..", import.meta.url));

async function getFreePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object");
  await new Promise((resolve) => server.close(resolve));
  return address.port;
}

async function waitForHealth(baseUrl, child) {
  let lastError;
  for (let i = 0; i < 60; i += 1) {
    if (child.exitCode !== null) {
      throw new Error(`server exited before health check: ${child.exitCode}`);
    }
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok) return;
    } catch (e) {
      lastError = e;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw lastError ?? new Error("server did not become healthy");
}

async function startServer(t) {
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: serverRoot,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = [];
  child.stdout.on("data", (chunk) => output.push(chunk.toString()));
  child.stderr.on("data", (chunk) => output.push(chunk.toString()));

  t.after(async () => {
    child.kill("SIGTERM");
    await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 1000))]);
    if (child.exitCode === null) {
      child.kill("SIGKILL");
    }
  });

  try {
    await waitForHealth(baseUrl, child);
  } catch (e) {
    throw new Error(`${e instanceof Error ? e.message : String(e)}\n${output.join("")}`);
  }
  return { baseUrl };
}

async function createRoom(baseUrl) {
  const res = await fetch(`${baseUrl}/api/rooms`, { method: "POST" });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(typeof data.roomId, "string");
  assert.equal(typeof data.shareToken, "string");
  return data;
}

async function connectSocket(t, baseUrl) {
  const socket = io(baseUrl, {
    path: "/socket.io",
    transports: ["polling"],
    timeout: 5_000,
    forceNew: true,
  });
  t.after(() => socket.close());
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("socket connect timed out")), 5_000);
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
  return new Promise((resolve) => {
    socket.emit("join", { roomId }, resolve);
  });
}

function nextEvent(socket, event, timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      socket.off(event, onEvent);
      resolve({ received: false });
    }, timeoutMs);
    const onEvent = (payload) => {
      clearTimeout(timer);
      resolve({ received: true, payload });
    };
    socket.once(event, onEvent);
  });
}

test("location updates require the private share token", async (t) => {
  const { baseUrl } = await startServer(t);
  const { roomId, shareToken } = await createRoom(baseUrl);
  const viewer = await connectSocket(t, baseUrl);
  const attacker = await connectSocket(t, baseUrl);

  assert.deepEqual(await joinRoom(viewer, roomId), { ok: true, peers: 1, hasCached: false });

  const spoofAttempt = nextEvent(viewer, "location-update", 250);
  attacker.emit("location", { roomId, lat: 1, lng: 2 });
  assert.deepEqual(await spoofAttempt, { received: false });

  const ownerUpdate = nextEvent(viewer, "location-update", 1_000);
  attacker.emit("location", { roomId, shareToken, lat: 10, lng: 20 });
  const received = await ownerUpdate;
  assert.equal(received.received, true);
  assert.equal(received.payload.roomId, roomId);
  assert.equal(received.payload.lat, 10);
  assert.equal(received.payload.lng, 20);
});

test("stop-sharing requires the private token and prevents resurrection", async (t) => {
  const { baseUrl } = await startServer(t);
  const { roomId, shareToken } = await createRoom(baseUrl);
  const viewer = await connectSocket(t, baseUrl);
  const attacker = await connectSocket(t, baseUrl);

  assert.deepEqual(await joinRoom(viewer, roomId), { ok: true, peers: 1, hasCached: false });

  const unauthenticatedStop = nextEvent(viewer, "sharing-ended", 250);
  attacker.emit("stop-sharing", { roomId });
  assert.deepEqual(await unauthenticatedStop, { received: false });

  const ownerStop = nextEvent(viewer, "sharing-ended", 1_000);
  attacker.emit("stop-sharing", { roomId, shareToken });
  const stopped = await ownerStop;
  assert.equal(stopped.received, true);
  assert.deepEqual(stopped.payload, { roomId });

  const postStopUpdate = nextEvent(viewer, "location-update", 250);
  attacker.emit("location", { roomId, shareToken, lat: 30, lng: 40 });
  assert.deepEqual(await postStopUpdate, { received: false });

  const lateViewer = await connectSocket(t, baseUrl);
  const lateEnd = nextEvent(lateViewer, "sharing-ended", 1_000);
  assert.deepEqual(await joinRoom(lateViewer, roomId), { ok: false, ended: true });
  assert.deepEqual(await lateEnd, { received: true, payload: { roomId } });
});
