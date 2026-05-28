import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";
import { io } from "socket.io-client";

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

async function waitForHealth(origin, child) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) {
      throw new Error(`server exited before health check passed (code ${child.exitCode})`);
    }
    try {
      const res = await fetch(`${origin}/health`);
      if (res.ok && (await res.text()) === "ok") return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("server did not pass health check");
}

function waitForConnect(socket) {
  if (socket.connected) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("socket connect timed out")), 2_000);
    socket.once("connect", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once("connect_error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function onceWithTimeout(socket, event, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} timed out`)), timeoutMs);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

test("replays the latest room location to viewers that join after it was sent", { timeout: 10_000 }, async (t) => {
  const port = await getFreePort();
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: serverRoot,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  t.after(() => {
    child.kill();
  });

  await waitForHealth(origin, child);

  const options = {
    path: "/socket.io",
    transports: ["websocket"],
    reconnection: false,
    timeout: 2_000,
  };
  const sharer = io(origin, options);
  const viewer = io(origin, options);
  t.after(() => {
    sharer.close();
    viewer.close();
  });

  const roomId = "lateViewer1";
  await waitForConnect(sharer);
  sharer.emit("join", { roomId });
  sharer.emit("location", {
    roomId,
    lat: 40.4168,
    lng: -3.7038,
    heading: null,
    courseDeg: null,
    accuracy: 8,
  });

  await new Promise((resolve) => setTimeout(resolve, 50));
  await waitForConnect(viewer);
  const replay = onceWithTimeout(viewer, "location-update", 2_000);
  viewer.emit("join", { roomId });

  const update = await replay;
  assert.equal(update.lat, 40.4168);
  assert.equal(update.lng, -3.7038);
  assert.equal(update.heading, null);
  assert.equal(update.courseDeg, null);
  assert.equal(update.accuracy, 8);
  assert.equal(typeof update.t, "number");

  assert.equal(stderr, "");
});
