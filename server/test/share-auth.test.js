import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { io as connectSocket } from "socket.io-client";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.join(__dirname, "..");

function once(socket, event, timeoutMs = 2_000) {
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

function noEvent(socket, event, timeoutMs = 300) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, onEvent);
      resolve();
    }, timeoutMs);
    const onEvent = () => {
      clearTimeout(timer);
      reject(new Error(`Unexpected ${event}`));
    };
    socket.once(event, onEvent);
  });
}

async function waitForHealth(origin, getExitCode) {
  const deadline = Date.now() + 5_000;
  let lastError;
  while (Date.now() < deadline) {
    const exitCode = getExitCode();
    if (exitCode !== null) {
      throw new Error(`Server exited before health check with code ${exitCode}`);
    }
    try {
      const res = await fetch(`${origin}/health`);
      if (res.ok && (await res.text()) === "ok") return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw lastError ?? new Error("Timed out waiting for server health check");
}

async function withServer(t) {
  const port = 31_000 + Math.floor(Math.random() * 1_000);
  const origin = `http://127.0.0.1:${port}`;
  let exitCode = null;
  let output = "";
  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: serverRoot,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });
  child.on("exit", (code) => {
    exitCode = code;
  });
  t.after(() => {
    child.kill();
  });
  await waitForHealth(origin, () => exitCode);
  return { origin, output: () => output };
}

function socketFor(t, origin) {
  const socket = connectSocket(origin, {
    path: "/socket.io",
    transports: ["polling"],
    forceNew: true,
  });
  t.after(() => {
    socket.close();
  });
  return socket;
}

async function createRoom(origin) {
  const res = await fetch(`${origin}/api/rooms`, { method: "POST" });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(typeof body.roomId, "string");
  assert.equal(typeof body.shareToken, "string");
  return body;
}

test("rooms require a share token to publish or stop sharing", async (t) => {
  const { origin } = await withServer(t);
  const { roomId, shareToken } = await createRoom(origin);

  const viewer = socketFor(t, origin);
  await once(viewer, "connect");
  const joinAck = await new Promise((resolve) => viewer.emit("join", { roomId }, resolve));
  assert.equal(joinAck.ok, true);

  const attacker = socketFor(t, origin);
  await once(attacker, "connect");
  attacker.emit("location", { roomId, lat: 1, lng: 2 });
  await noEvent(viewer, "location-update");

  attacker.emit("location", { roomId, shareToken: "wrong", lat: 3, lng: 4 });
  await noEvent(viewer, "location-update");

  const sharer = socketFor(t, origin);
  await once(sharer, "connect");
  const updatePromise = once(viewer, "location-update");
  sharer.emit("location", { roomId, shareToken, lat: 10, lng: 20 });
  const update = await updatePromise;
  assert.equal(update.lat, 10);
  assert.equal(update.lng, 20);
  assert.equal(update.heading, null);
  assert.equal(update.courseDeg, null);
  assert.equal(typeof update.t, "number");

  attacker.emit("stop-sharing", { roomId });
  await noEvent(viewer, "sharing-ended");

  const endedPromise = once(viewer, "sharing-ended");
  const stopRes = await fetch(`${origin}/api/rooms/${encodeURIComponent(roomId)}/stop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ shareToken }),
  });
  assert.equal(stopRes.status, 200);
  await endedPromise;

  const lateViewer = socketFor(t, origin);
  await once(lateViewer, "connect");
  const lateJoinAck = await new Promise((resolve) => lateViewer.emit("join", { roomId }, resolve));
  assert.deepEqual(lateJoinAck, { ok: false, exists: false });

  sharer.emit("location", { roomId, shareToken, lat: 30, lng: 40 });
  await noEvent(lateViewer, "location-update");
});
