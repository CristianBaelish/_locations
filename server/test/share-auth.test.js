import assert from "node:assert/strict";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { io as createClient } from "socket.io-client";

const PORT = 31_823;
const BASE_URL = `http://127.0.0.1:${PORT}`;

function waitForEvent(socket, event, timeoutMs = 1_000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off(event, onEvent);
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeoutMs);
    const onEvent = (payload) => {
      clearTimeout(timeout);
      resolve(payload);
    };
    socket.once(event, onEvent);
  });
}

async function waitForNoEvent(socket, event, timeoutMs = 200) {
  let received = false;
  const onEvent = () => {
    received = true;
  };
  socket.once(event, onEvent);
  await delay(timeoutMs);
  socket.off(event, onEvent);
  assert.equal(received, false, `${event} should not have been emitted`);
}

async function waitForHealth() {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/health`);
      if (res.ok) return;
    } catch {
      // Server is still starting.
    }
    await delay(50);
  }
  throw new Error("Server did not become healthy");
}

function connectSocket() {
  return createClient(BASE_URL, {
    transports: ["polling"],
    timeout: 2_000,
    forceNew: true,
  });
}

test("room writes require the private share token", async (t) => {
  const server = spawn(process.execPath, ["src/index.js"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "ignore", "pipe"],
  });
  t.after(async () => {
    server.kill();
    if (server.exitCode === null) {
      await once(server, "exit").catch(() => {});
    }
  });

  const stderr = [];
  server.stderr.on("data", (chunk) => stderr.push(chunk.toString()));
  await waitForHealth();

  const createRes = await fetch(`${BASE_URL}/api/rooms`, { method: "POST" });
  assert.equal(createRes.ok, true);
  const { roomId, shareToken } = await createRes.json();
  assert.equal(typeof roomId, "string");
  assert.equal(typeof shareToken, "string");

  const viewer = connectSocket();
  const attacker = connectSocket();
  const owner = connectSocket();
  t.after(() => {
    viewer.close();
    attacker.close();
    owner.close();
  });
  await Promise.all([once(viewer, "connect"), once(attacker, "connect"), once(owner, "connect")]);

  const joinAck = await new Promise((resolve) => viewer.emit("join", { roomId }, resolve));
  assert.deepEqual(joinAck, { ok: true, peers: 1, hasCached: false });

  attacker.emit("location", { roomId, lat: 10, lng: 20 });
  await waitForNoEvent(viewer, "location-update");

  owner.emit("location", { roomId, shareToken, lat: 30, lng: 40 });
  const update = await waitForEvent(viewer, "location-update");
  assert.equal(update.lat, 30);
  assert.equal(update.lng, 40);
  assert.equal(update.heading, null);
  assert.equal(update.courseDeg, null);
  assert.equal(typeof update.t, "number");

  attacker.emit("stop-sharing", { roomId });
  await waitForNoEvent(viewer, "sharing-ended");
  assert.deepEqual(await (await fetch(`${BASE_URL}/api/rooms/${roomId}`)).json(), { exists: true });

  owner.emit("stop-sharing", { roomId, shareToken });
  await waitForEvent(viewer, "sharing-ended");
  assert.deepEqual(await (await fetch(`${BASE_URL}/api/rooms/${roomId}`)).json(), { exists: false });
});
