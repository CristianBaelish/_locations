import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { io as Client } from "socket.io-client";
import { io, server } from "../src/index.js";

let baseUrl;

before(async () => {
  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert(address && typeof address === "object");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise((resolve) => io.close(resolve));
  if (server.listening) {
    await new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
});

async function createRoom() {
  const res = await fetch(`${baseUrl}/api/rooms`, { method: "POST" });
  assert.equal(res.ok, true);
  const data = await res.json();
  assert.equal(typeof data.roomId, "string");
  assert.equal(typeof data.shareToken, "string");
  return data;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function connectSocket() {
  const socket = Client(baseUrl, {
    path: "/socket.io",
    transports: ["polling"],
    reconnection: false,
    timeout: 5_000,
  });
  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
  return socket;
}

function join(socket, roomId) {
  return new Promise((resolve) => {
    socket.emit("join", { roomId }, resolve);
  });
}

function onceSocket(socket, event, timeoutMs = 1_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, onEvent);
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeoutMs);
    function onEvent(payload) {
      clearTimeout(timer);
      resolve(payload);
    }
    socket.once(event, onEvent);
  });
}

async function assertNoEvent(socket, event, action, waitMs = 150) {
  let seen = false;
  const onEvent = () => {
    seen = true;
  };
  socket.once(event, onEvent);
  action();
  await wait(waitMs);
  socket.off(event, onEvent);
  assert.equal(seen, false, `${event} should not have been emitted`);
}

test("location updates require the private share token", async () => {
  const { roomId, shareToken } = await createRoom();
  const viewer = await connectSocket();
  const sender = await connectSocket();

  try {
    assert.deepEqual(await join(viewer, roomId), { ok: true, peers: 1, hasCached: false });

    await assertNoEvent(viewer, "location-update", () => {
      sender.emit("location", { roomId, lat: 1, lng: 2 });
    });

    const update = onceSocket(viewer, "location-update");
    sender.emit("location", { roomId, shareToken, lat: 3, lng: 4 });
    const payload = await update;
    assert.equal(payload.lat, 3);
    assert.equal(payload.lng, 4);
    assert.equal(payload.heading, null);
    assert.equal(payload.courseDeg, null);
    assert.equal(typeof payload.t, "number");
  } finally {
    viewer.close();
    sender.close();
  }
});

test("only the private share token can stop and clear a room", async () => {
  const { roomId, shareToken } = await createRoom();
  const viewer = await connectSocket();
  const sharer = await connectSocket();
  const lateViewer = await connectSocket();

  try {
    assert.equal((await join(viewer, roomId)).ok, true);

    const firstUpdate = onceSocket(viewer, "location-update");
    sharer.emit("location", { roomId, shareToken, lat: 10, lng: 20 });
    await firstUpdate;

    await assertNoEvent(viewer, "sharing-ended", () => {
      viewer.emit("stop-sharing", { roomId });
    });

    const cachedUpdate = onceSocket(lateViewer, "location-update");
    assert.equal((await join(lateViewer, roomId)).ok, true);
    assert.equal((await cachedUpdate).lat, 10);

    const forbidden = await fetch(`${baseUrl}/api/rooms/${roomId}/stop`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shareToken: "wrong-token" }),
    });
    assert.equal(forbidden.status, 403);

    const ended = onceSocket(viewer, "sharing-ended");
    const stopped = await fetch(`${baseUrl}/api/rooms/${roomId}/stop`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shareToken }),
    });
    assert.equal(stopped.ok, true);
    await ended;

    sharer.emit("location", { roomId, shareToken, lat: 30, lng: 40 });

    const afterStopViewer = await connectSocket();
    try {
      assert.deepEqual(await join(afterStopViewer, roomId), { ok: false });
      await assertNoEvent(afterStopViewer, "location-update", () => {});
    } finally {
      afterStopViewer.close();
    }
  } finally {
    viewer.close();
    sharer.close();
    lateViewer.close();
  }
});

test("joining a second room leaves the previous room on the same socket", async () => {
  const roomA = await createRoom();
  const roomB = await createRoom();
  const viewer = await connectSocket();
  const sharer = await connectSocket();

  try {
    assert.equal((await join(viewer, roomA.roomId)).ok, true);
    assert.equal((await join(viewer, roomB.roomId)).ok, true);

    await assertNoEvent(viewer, "location-update", () => {
      sharer.emit("location", {
        roomId: roomA.roomId,
        shareToken: roomA.shareToken,
        lat: 1,
        lng: 1,
      });
    });

    const roomBUpdate = onceSocket(viewer, "location-update");
    sharer.emit("location", {
      roomId: roomB.roomId,
      shareToken: roomB.shareToken,
      lat: 2,
      lng: 2,
    });
    assert.equal((await roomBUpdate).lat, 2);
  } finally {
    viewer.close();
    sharer.close();
  }
});
