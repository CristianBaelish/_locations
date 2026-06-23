import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import net from "node:net";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { io as createClient } from "socket.io-client";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, "..");

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert(address && typeof address === "object");
      server.close(() => resolve(address.port));
    });
  });
}

async function startServer() {
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: serverRoot,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });

  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) {
      throw new Error(`Server exited before health check passed:\n${output}`);
    }
    try {
      const response = await fetch(`${origin}/health`);
      if (response.ok) return { child, origin, output: () => output };
    } catch {
      // Retry until the child starts listening.
    }
    await delay(50);
  }
  child.kill("SIGKILL");
  throw new Error(`Timed out waiting for server health check:\n${output}`);
}

async function stopServer(child) {
  if (child.exitCode != null) return;
  child.kill();
  const exited = once(child, "exit");
  const timeout = delay(2_000).then(() => {
    if (child.exitCode == null) child.kill("SIGKILL");
  });
  await Promise.race([exited, timeout]);
}

function connectSocket(origin) {
  const socket = createClient(origin, {
    path: "/socket.io",
    transports: ["polling"],
    timeout: 2_000,
    reconnection: false,
    forceNew: true,
  });

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("Timed out connecting socket"));
    }, 3_000);
    socket.once("connect", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once("connect_error", (error) => {
      clearTimeout(timer);
      socket.close();
      reject(error);
    });
  });
}

function emitAck(socket, event, payload) {
  return new Promise((resolve, reject) => {
    socket.timeout(2_000).emit(event, payload, (error, response) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(response);
    });
  });
}

async function waitFor(predicate, message) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await delay(25);
  }
  assert.fail(message);
}

test("share token is required to publish locations or stop sharing", async (t) => {
  const { child, origin, output } = await startServer();
  t.after(() => stopServer(child));

  const createResponse = await fetch(`${origin}/api/rooms`, { method: "POST" });
  assert.equal(createResponse.ok, true);
  const created = await createResponse.json();
  assert.equal(typeof created.roomId, "string");
  assert.equal(typeof created.shareToken, "string");

  const [sharer, observer, attacker] = await Promise.all([
    connectSocket(origin),
    connectSocket(origin),
    connectSocket(origin),
  ]);
  t.after(() => {
    sharer.close();
    observer.close();
    attacker.close();
  });

  const missingJoin = await emitAck(attacker, "join", { roomId: "missing1" });
  assert.deepEqual(missingJoin, { ok: false, error: "not_found" });

  const observerJoin = await emitAck(observer, "join", { roomId: created.roomId });
  assert.equal(observerJoin.ok, true);
  const attackerJoin = await emitAck(attacker, "join", { roomId: created.roomId });
  assert.equal(attackerJoin.ok, true);

  const updates = [];
  let ended = false;
  observer.on("location-update", (payload) => updates.push(payload));
  observer.on("sharing-ended", () => {
    ended = true;
  });

  attacker.emit("location", { roomId: created.roomId, lat: 1, lng: 2 });
  await delay(200);
  assert.equal(updates.length, 0, `unauthorized location was broadcast:\n${output()}`);

  sharer.emit("location", {
    roomId: created.roomId,
    shareToken: created.shareToken,
    lat: 10,
    lng: 20,
  });
  await waitFor(() => updates.length === 1, `authorized location was not broadcast:\n${output()}`);
  assert.equal(updates[0].lat, 10);
  assert.equal(updates[0].lng, 20);

  attacker.emit("stop-sharing", { roomId: created.roomId });
  await delay(200);
  assert.equal(ended, false, `unauthorized stop-sharing was broadcast:\n${output()}`);

  const stopAck = await emitAck(sharer, "stop-sharing", {
    roomId: created.roomId,
    shareToken: created.shareToken,
  });
  assert.deepEqual(stopAck, { ok: true });
  await waitFor(() => ended, `authorized stop-sharing was not broadcast:\n${output()}`);

  sharer.emit("location", {
    roomId: created.roomId,
    shareToken: created.shareToken,
    lat: 30,
    lng: 40,
  });
  await delay(200);
  assert.equal(updates.length, 1, `stopped room accepted a stale share token:\n${output()}`);
});
