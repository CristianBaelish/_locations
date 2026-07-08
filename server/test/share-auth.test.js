import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { io as Client } from "socket.io-client";
import { server } from "../src/index.js";

let baseUrl;
const clients = new Set();

function listen(serverInstance) {
  return new Promise((resolve, reject) => {
    serverInstance.once("error", reject);
    serverInstance.listen(0, "127.0.0.1", () => {
      serverInstance.off("error", reject);
      const address = serverInstance.address();
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function closeServer(serverInstance) {
  return new Promise((resolve, reject) => {
    serverInstance.close((err) => (err ? reject(err) : resolve()));
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForSocket(socket) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("socket connect timeout")), 2_000);
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

async function connectClient() {
  const socket = Client(baseUrl, {
    transports: ["polling"],
    reconnection: false,
    timeout: 2_000,
  });
  clients.add(socket);
  await waitForSocket(socket);
  return socket;
}

function emitWithAck(socket, event, payload) {
  return new Promise((resolve) => {
    socket.emit(event, payload, resolve);
  });
}

async function createRoom() {
  const res = await fetch(`${baseUrl}/api/rooms`, { method: "POST" });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(typeof data.roomId, "string");
  assert.equal(typeof data.shareToken, "string");
  return data;
}

function waitForEvent(socket, event) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), 1_000);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

before(async () => {
  baseUrl = await listen(server);
});

after(async () => {
  for (const socket of clients) {
    socket.close();
  }
  await closeServer(server);
});

test("public room ids cannot inject location updates", async () => {
  const { roomId, shareToken } = await createRoom();
  const viewer = await connectClient();
  const attacker = await connectClient();
  const sharer = await connectClient();

  const joinAck = await emitWithAck(viewer, "join", { roomId });
  assert.deepEqual(joinAck.ok, true);

  const updates = [];
  viewer.on("location-update", (payload) => updates.push(payload));

  attacker.emit("location", { roomId, lat: 1, lng: 2 });
  await delay(100);
  assert.equal(updates.length, 0);

  sharer.emit("location", { roomId, shareToken, lat: 3, lng: 4 });
  const update = await waitForEvent(viewer, "location-update");
  assert.equal(update.roomId, roomId);
  assert.equal(update.lat, 3);
  assert.equal(update.lng, 4);
});

test("public room ids cannot stop active sharing", async () => {
  const { roomId, shareToken } = await createRoom();
  const viewer = await connectClient();
  const attacker = await connectClient();
  const sharer = await connectClient();

  const joinAck = await emitWithAck(viewer, "join", { roomId });
  assert.deepEqual(joinAck.ok, true);

  let ended = false;
  viewer.on("sharing-ended", () => {
    ended = true;
  });

  attacker.emit("stop-sharing", { roomId });
  await delay(100);
  assert.equal(ended, false);

  const existsAfterAttack = await fetch(`${baseUrl}/api/rooms/${roomId}`);
  assert.deepEqual(await existsAfterAttack.json(), { exists: true });

  sharer.emit("stop-sharing", { roomId, shareToken });
  const endedPayload = await waitForEvent(viewer, "sharing-ended");
  assert.equal(endedPayload.roomId, roomId);

  const existsAfterStop = await fetch(`${baseUrl}/api/rooms/${roomId}`);
  assert.deepEqual(await existsAfterStop.json(), { exists: false });

  const lateViewer = await connectClient();
  const lateJoinAck = await emitWithAck(lateViewer, "join", { roomId });
  assert.deepEqual(lateJoinAck, { ok: false, error: "not-found" });
});
