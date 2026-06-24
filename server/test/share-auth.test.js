import assert from "node:assert/strict";
import test from "node:test";
import { io as Client } from "socket.io-client";
import { io, server } from "../src/index.js";

let baseUrl;

test.before(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.after(async () => {
  await new Promise((resolve) => io.close(resolve));
});

function connectSocket() {
  const socket = Client(baseUrl, {
    forceNew: true,
    transports: ["polling"],
    timeout: 2_000,
  });
  return new Promise((resolve, reject) => {
    socket.once("connect", () => resolve(socket));
    socket.once("connect_error", reject);
  });
}

async function postJson(path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  return { res, json };
}

function joinRoom(socket, roomId) {
  return new Promise((resolve) => {
    socket.emit("join", { roomId }, resolve);
  });
}

function waitForEvent(socket, event) {
  return new Promise((resolve) => {
    socket.once(event, resolve);
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("room writes require the private share token", async () => {
  const created = await postJson("/api/rooms");
  assert.equal(created.res.status, 200);
  const { roomId, shareToken } = created.json;
  assert.equal(typeof roomId, "string");
  assert.equal(typeof shareToken, "string");

  const viewer = await connectSocket();
  const owner = await connectSocket();
  const attacker = await connectSocket();

  try {
    const joinAck = await joinRoom(viewer, roomId);
    assert.equal(joinAck.ok, true);

    let ended = false;
    const updates = [];
    viewer.on("sharing-ended", () => {
      ended = true;
    });
    viewer.on("location-update", (payload) => {
      updates.push(payload);
    });

    attacker.emit("location", { roomId, lat: 1, lng: 2 });
    attacker.emit("location", { roomId, shareToken: "wrong", lat: 3, lng: 4 });
    attacker.emit("stop-sharing", { roomId });
    const forbiddenStop = await postJson(`/api/rooms/${roomId}/stop`, { shareToken: "wrong" });
    assert.equal(forbiddenStop.res.status, 403);

    await delay(50);
    assert.equal(ended, false);
    assert.equal(updates.length, 0);

    const updateSeen = waitForEvent(viewer, "location-update");
    owner.emit("location", { roomId, shareToken, lat: 10, lng: 20, heading: null });
    const update = await updateSeen;
    assert.equal(update.lat, 10);
    assert.equal(update.lng, 20);
    assert.equal(updates.length, 1);

    const endedSeen = waitForEvent(viewer, "sharing-ended");
    owner.emit("stop-sharing", { roomId, shareToken });
    await endedSeen;
    assert.equal(ended, true);

    owner.emit("location", { roomId, shareToken, lat: 30, lng: 40 });
    await delay(50);
    assert.equal(updates.length, 1);

    const roomState = await fetch(`${baseUrl}/api/rooms/${roomId}`).then((res) => res.json());
    assert.deepEqual(roomState, { exists: false });
  } finally {
    viewer.disconnect();
    owner.disconnect();
    attacker.disconnect();
  }
});
