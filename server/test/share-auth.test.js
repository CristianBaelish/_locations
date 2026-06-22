import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { io as createSocket } from "socket.io-client";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.join(__dirname, "..");

async function getFreePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object");
  const { port } = address;
  await new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  return port;
}

async function waitForHealth(origin) {
  const deadline = Date.now() + 5_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${origin}/health`);
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
    cwd: serverRoot,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  t.after(() => {
    child.kill();
  });

  const origin = `http://127.0.0.1:${port}`;
  try {
    await waitForHealth(origin);
  } catch (err) {
    child.kill();
    throw new Error(`server failed to start: ${stderr || String(err)}`);
  }
  return origin;
}

async function createRoom(origin) {
  const res = await fetch(`${origin}/api/rooms`, { method: "POST" });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(typeof body.roomId, "string");
  assert.equal(typeof body.shareToken, "string");
  return body;
}

async function connectSocket(t, origin) {
  const socket = createSocket(origin, {
    transports: ["polling"],
    timeout: 2_000,
    forceNew: true,
  });
  t.after(() => socket.close());
  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
  return socket;
}

function waitForEvent(socket, event, timeoutMs = 500) {
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

async function expectNoEvent(socket, event) {
  await assert.rejects(waitForEvent(socket, event, 150), /timed out/);
}

test("public room IDs cannot spoof locations or stop sharing", async (t) => {
  const origin = await startServer(t);
  const { roomId, shareToken } = await createRoom(origin);
  const viewer = await connectSocket(t, origin);
  const attacker = await connectSocket(t, origin);
  const sharer = await connectSocket(t, origin);

  const joinAck = await new Promise((resolve) => viewer.emit("join", { roomId }, resolve));
  assert.equal(joinAck.ok, true);

  attacker.emit("location", { roomId, lat: 1, lng: 2 });
  await expectNoEvent(viewer, "location-update");

  attacker.emit("stop-sharing", { roomId });
  await expectNoEvent(viewer, "sharing-ended");

  sharer.emit("location", { roomId, shareToken, lat: 12, lng: 34, heading: null, courseDeg: null });
  const update = await waitForEvent(viewer, "location-update");
  assert.deepEqual(
    { lat: update.lat, lng: update.lng, heading: update.heading, courseDeg: update.courseDeg },
    { lat: 12, lng: 34, heading: null, courseDeg: null }
  );

  const rejectedStop = await fetch(`${origin}/api/rooms/${roomId}/stop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ shareToken: "wrong-token" }),
  });
  assert.equal(rejectedStop.status, 403);

  sharer.emit("stop-sharing", { roomId, shareToken });
  await waitForEvent(viewer, "sharing-ended");
});
