import assert from "node:assert/strict";
import { once } from "node:events";
import { spawn } from "node:child_process";
import net from "node:net";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { io as connectSocket } from "socket.io-client";

const serverDir = fileURLToPath(new URL("..", import.meta.url));

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getFreePort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const address = probe.address();
  assert(address && typeof address === "object");
  const { port } = address;
  probe.close();
  await once(probe, "close");
  return port;
}

async function startServer(t) {
  const port = await getFreePort();
  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: serverDir,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = [];
  child.stdout.on("data", (chunk) => output.push(String(chunk)));
  child.stderr.on("data", (chunk) => output.push(String(chunk)));

  t.after(() => {
    if (child.exitCode == null) child.kill();
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i += 1) {
    if (child.exitCode != null) {
      throw new Error(`server exited early (${child.exitCode}): ${output.join("")}`);
    }
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok) return { baseUrl };
    } catch {
      // Keep polling until the child has bound its port.
    }
    await delay(50);
  }

  throw new Error(`server did not become ready: ${output.join("")}`);
}

async function openSocket(t, baseUrl) {
  const socket = connectSocket(baseUrl, {
    path: "/socket.io",
    transports: ["polling"],
    timeout: 5_000,
    forceNew: true,
  });
  t.after(() => socket.close());
  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
  return socket;
}

function emitWithAck(socket, event, payload) {
  return new Promise((resolve, reject) => {
    socket.timeout(2_000).emit(event, payload, (err, response) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(response);
    });
  });
}

function waitForEvent(socket, event, timeoutMs = 1_000) {
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

async function assertNoEvent(socket, event, action) {
  let received = false;
  const onEvent = () => {
    received = true;
  };
  socket.once(event, onEvent);
  action();
  await delay(250);
  socket.off(event, onEvent);
  assert.equal(received, false, `${event} should not be emitted`);
}

test("only the private share token can publish locations or end a room", async (t) => {
  const { baseUrl } = await startServer(t);

  const createRes = await fetch(`${baseUrl}/api/rooms`, { method: "POST" });
  assert.equal(createRes.status, 200);
  const { roomId, shareToken } = await createRes.json();
  assert.equal(typeof roomId, "string");
  assert.equal(typeof shareToken, "string");

  const viewer = await openSocket(t, baseUrl);
  const attacker = await openSocket(t, baseUrl);
  const sharer = await openSocket(t, baseUrl);

  assert.deepEqual(await emitWithAck(viewer, "join", { roomId }), {
    ok: true,
    peers: 1,
    hasCached: false,
  });

  await assertNoEvent(viewer, "location-update", () => {
    attacker.emit("location", { roomId, lat: 1, lng: 2 });
  });

  const updatePromise = waitForEvent(viewer, "location-update");
  sharer.emit("location", { roomId, shareToken, lat: 10, lng: 20 });
  const update = await updatePromise;
  assert.equal(update.lat, 10);
  assert.equal(update.lng, 20);

  await assertNoEvent(viewer, "sharing-ended", () => {
    attacker.emit("stop-sharing", { roomId });
  });

  const lateViewer = await openSocket(t, baseUrl);
  const cachedPromise = waitForEvent(lateViewer, "location-update");
  const lateJoinAck = await emitWithAck(lateViewer, "join", { roomId });
  assert.equal(lateJoinAck.ok, true);
  const cached = await cachedPromise;
  assert.equal(cached.lat, 10);
  assert.equal(cached.lng, 20);

  const endedPromise = waitForEvent(viewer, "sharing-ended");
  sharer.emit("stop-sharing", { roomId, shareToken });
  await endedPromise;

  const existsRes = await fetch(`${baseUrl}/api/rooms/${roomId}`);
  assert.deepEqual(await existsRes.json(), { exists: false });

  const afterStopViewer = await openSocket(t, baseUrl);
  assert.deepEqual(await emitWithAck(afterStopViewer, "join", { roomId }), {
    ok: false,
    error: "not-found",
  });
  await assertNoEvent(afterStopViewer, "location-update", () => {});
});
