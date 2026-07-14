import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, afterEach, before, test } from "node:test";
import { io as createClient } from "socket.io-client";

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let child;
let baseUrl;
/** @type {import("socket.io-client").Socket[]} */
let sockets = [];

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

function waitForServer(proc) {
  let output = "";
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start:\n${output}`)), 5_000);
    const onData = (chunk) => {
      output += chunk.toString();
      if (output.includes("Server http://")) {
        clearTimeout(timer);
        resolve();
      }
    };
    proc.stdout.on("data", onData);
    proc.stderr.on("data", onData);
    proc.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited with ${code}:\n${output}`));
    });
  });
}

async function requestJson(pathname, init) {
  const res = await fetch(`${baseUrl}${pathname}`, init);
  const text = await res.text();
  return {
    ok: res.ok,
    status: res.status,
    data: text ? JSON.parse(text) : null,
  };
}

async function createRoom() {
  const res = await requestJson("/api/rooms", { method: "POST" });
  assert.equal(res.ok, true);
  assert.equal(typeof res.data.roomId, "string");
  assert.equal(typeof res.data.shareToken, "string");
  return res.data;
}

async function connectSocket() {
  const socket = createClient(baseUrl, {
    path: "/socket.io",
    transports: ["polling"],
    timeout: 2_000,
    reconnection: false,
    forceNew: true,
  });
  sockets.push(socket);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("socket connect timeout")), 2_000);
    socket.once("connect", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once("connect_error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  return socket;
}

function joinRoom(socket, roomId) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("join acknowledgement timeout")), 2_000);
    socket.emit("join", { roomId }, (ack) => {
      clearTimeout(timer);
      resolve(ack);
    });
  });
}

function onceEvent(socket, event) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} timeout`)), 2_000);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

before(async () => {
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ["src/index.js"], {
    cwd: serverRoot,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForServer(child);
});

afterEach(() => {
  for (const socket of sockets) socket.close();
  sockets = [];
});

after(async () => {
  if (!child || child.killed) return;
  child.kill();
  await Promise.race([new Promise((resolve) => child.once("exit", resolve)), delay(1_000)]);
});

test("only the private share token can publish locations", async () => {
  const { roomId, shareToken } = await createRoom();
  const viewer = await connectSocket();
  const attacker = await connectSocket();
  const sharer = await connectSocket();
  const updates = [];

  assert.equal((await joinRoom(viewer, roomId)).ok, true);
  viewer.on("location-update", (payload) => updates.push(payload));

  attacker.emit("location", { roomId, lat: 1, lng: 2 });
  attacker.emit("location", { roomId, shareToken: "wrong", lat: 1, lng: 2 });
  await delay(100);
  assert.deepEqual(updates, []);

  const validUpdate = onceEvent(viewer, "location-update");
  sharer.emit("location", { roomId, shareToken, lat: 3, lng: 4 });
  assert.deepEqual(await validUpdate, {
    roomId,
    lat: 3,
    lng: 4,
    heading: null,
    courseDeg: null,
    t: updates[0]?.t,
  });
});

test("only the private share token can end and invalidate a room", async () => {
  const { roomId, shareToken } = await createRoom();
  const viewer = await connectSocket();
  const attacker = await connectSocket();
  const sharer = await connectSocket();
  let ended = false;

  assert.equal((await joinRoom(viewer, roomId)).ok, true);
  viewer.on("sharing-ended", () => {
    ended = true;
  });

  attacker.emit("stop-sharing", { roomId });
  attacker.emit("stop-sharing", { roomId, shareToken: "wrong" });
  await delay(100);
  assert.equal(ended, false);

  const validEnd = onceEvent(viewer, "sharing-ended");
  sharer.emit("stop-sharing", { roomId, shareToken });
  assert.deepEqual(await validEnd, { roomId });

  assert.deepEqual((await requestJson(`/api/rooms/${roomId}`)).data, { exists: false });
  const lateViewer = await connectSocket();
  assert.deepEqual(await joinRoom(lateViewer, roomId), {
    ok: false,
    peers: 0,
    hasCached: false,
  });
});

test("REST stop fallback rejects viewers and works without a sharer socket", async () => {
  const { roomId, shareToken } = await createRoom();
  const viewer = await connectSocket();
  assert.equal((await joinRoom(viewer, roomId)).ok, true);

  const rejected = await requestJson(`/api/rooms/${roomId}/stop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ shareToken: "wrong" }),
  });
  assert.equal(rejected.status, 403);

  const validEnd = onceEvent(viewer, "sharing-ended");
  const accepted = await requestJson(`/api/rooms/${roomId}/stop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ shareToken }),
  });
  assert.deepEqual(accepted, { ok: true, status: 200, data: { ok: true } });
  assert.deepEqual(await validEnd, { roomId });
});
