import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import net from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { io as ioClient } from "socket.io-client";

async function getFreePort() {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  const { port } = address;
  server.close();
  await once(server, "close");
  return port;
}

async function waitForHealth(baseUrl, child, logs) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) {
      throw new Error(`server exited before health check:\n${logs.text}`);
    }
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok) return;
    } catch {
      // Server is still starting.
    }
    await delay(50);
  }
  throw new Error(`server did not become healthy:\n${logs.text}`);
}

async function startServer(t) {
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const serverDir = fileURLToPath(new URL("..", import.meta.url));
  const logs = { text: "" };
  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: serverDir,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk) => {
    logs.text += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    logs.text += chunk.toString();
  });

  t.after(() => {
    child.kill();
  });

  await waitForHealth(baseUrl, child, logs);
  return { baseUrl };
}

function connectSocket(baseUrl, t) {
  const socket = ioClient(baseUrl, {
    forceNew: true,
    path: "/socket.io",
    reconnection: false,
    timeout: 5000,
    transports: ["polling"],
  });
  t.after(() => socket.close());

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("socket connect timed out"));
    }, 5000);
    const onError = (err) => {
      clearTimeout(timer);
      socket.close();
      reject(err);
    };
    socket.once("connect_error", onError);
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.off("connect_error", onError);
      resolve(socket);
    });
  });
}

function joinRoom(socket, roomId) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("join timed out")), 1000);
    socket.emit("join", { roomId }, (ack) => {
      clearTimeout(timer);
      resolve(ack);
    });
  });
}

function waitForEvent(socket, event, timeoutMs = 1000) {
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

async function expectNoEvent(socket, event, timeoutMs = 250) {
  let received = false;
  const onEvent = () => {
    received = true;
  };
  socket.on(event, onEvent);
  await delay(timeoutMs);
  socket.off(event, onEvent);
  assert.equal(received, false, `${event} should not have been emitted`);
}

test("public room id cannot spoof or stop a sharing session", async (t) => {
  const { baseUrl } = await startServer(t);
  const createRes = await fetch(`${baseUrl}/api/rooms`, { method: "POST" });
  assert.equal(createRes.status, 200);
  const created = await createRes.json();
  assert.equal(typeof created.roomId, "string");
  assert.equal(typeof created.shareToken, "string");

  const sharer = await connectSocket(baseUrl, t);
  const observer = await connectSocket(baseUrl, t);
  const attacker = await connectSocket(baseUrl, t);
  await joinRoom(observer, created.roomId);
  await joinRoom(attacker, created.roomId);

  attacker.emit("location", { roomId: created.roomId, lat: 99, lng: 99 });
  await expectNoEvent(observer, "location-update");

  attacker.emit("stop-sharing", { roomId: created.roomId });
  await expectNoEvent(observer, "sharing-ended");

  const update = waitForEvent(observer, "location-update");
  sharer.emit("location", {
    roomId: created.roomId,
    shareToken: created.shareToken,
    lat: 1,
    lng: 2,
    heading: null,
    courseDeg: null,
  });
  const payload = await update;
  assert.equal(payload.lat, 1);
  assert.equal(payload.lng, 2);
  assert.equal(payload.heading, null);
  assert.equal(payload.courseDeg, null);
  assert.equal(typeof payload.t, "number");

  const ended = waitForEvent(observer, "sharing-ended");
  sharer.emit("stop-sharing", {
    roomId: created.roomId,
    shareToken: created.shareToken,
  });
  await ended;

  const existsAfterStop = await fetch(`${baseUrl}/api/rooms/${created.roomId}`);
  assert.deepEqual(await existsAfterStop.json(), { exists: false });

  sharer.emit("location", {
    roomId: created.roomId,
    shareToken: created.shareToken,
    lat: 3,
    lng: 4,
  });
  await expectNoEvent(observer, "location-update");
});
