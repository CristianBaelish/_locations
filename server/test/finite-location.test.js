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

function emitAck(socket, event, payload) {
  return new Promise((resolve, reject) => {
    socket.timeout(1_000).emit(event, payload, (error, response) => {
      if (error) reject(error);
      else resolve(response);
    });
  });
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

/** Engine.IO polling body that JSON.parse turns into Infinity on the server. */
async function postRawLocation(origin, roomId, latLiteral) {
  const openRes = await fetch(`${origin}/socket.io/?EIO=4&transport=polling`);
  const openText = await openRes.text();
  const sid = JSON.parse(openText.slice(1)).sid;
  const post = (body) =>
    fetch(`${origin}/socket.io/?EIO=4&transport=polling&sid=${sid}`, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body,
    });
  const connected = await post("40");
  assert.equal(connected.status, 200);
  const polled = await fetch(`${origin}/socket.io/?EIO=4&transport=polling&sid=${sid}`);
  assert.equal(polled.status, 200);
  await polled.text();
  const sent = await post(`42["location",{"roomId":"${roomId}","lat":${latLiteral},"lng":10}]`);
  assert.equal(sent.status, 200);
  await sent.text();
}

test("non-finite coordinates are not stored or broadcast", async (t) => {
  const port = await availablePort();
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  t.after(async () => {
    child.kill();
    await new Promise((resolve) => child.once("exit", resolve));
  });
  await waitForServer(origin);

  const roomId = "abcdefghij";
  const viewer = await openSocket(origin);
  t.after(() => viewer.close());
  await emitAck(viewer, "join", { roomId });

  let updates = [];
  viewer.on("location-update", (payload) => updates.push(payload));

  await postRawLocation(origin, roomId, "1e309");
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.deepEqual(updates, []);

  const lateViewer = await openSocket(origin);
  t.after(() => lateViewer.close());
  const cachedOnJoin = new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(null), 400);
    lateViewer.once("location-update", (payload) => {
      clearTimeout(timeout);
      resolve(payload);
    });
  });
  await emitAck(lateViewer, "join", { roomId });
  assert.equal(await cachedOnJoin, null);

  const received = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("finite update timed out")), 1_000);
    viewer.once("location-update", (payload) => {
      clearTimeout(timeout);
      resolve(payload);
    });
  });
  const sharer = await openSocket(origin);
  t.after(() => sharer.close());
  sharer.emit("location", { roomId, lat: 40.4, lng: -3.7 });
  const update = await received;
  assert.equal(update.lat, 40.4);
  assert.equal(update.lng, -3.7);
  assert.equal(child.exitCode, null);
  assert.equal(stderr.includes("TypeError"), false);
});
