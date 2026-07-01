import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { io as createClient } from "socket.io-client";
import { io, server } from "../src/index.js";

let baseUrl;

function once(socket, event, timeoutMs = 1_000) {
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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function connectSocket() {
  const socket = createClient(baseUrl, {
    transports: ["polling"],
    timeout: 2_000,
  });
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error("Timed out waiting for socket connection"));
    }, 2_000);
    socket.once("connect", () => {
      clearTimeout(timeout);
      resolve(socket);
    });
    socket.once("connect_error", (err) => {
      clearTimeout(timeout);
      socket.close();
      reject(err);
    });
  });
}

async function createRoom() {
  const res = await fetch(`${baseUrl}/api/rooms`, { method: "POST" });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(typeof body.roomId, "string");
  assert.equal(typeof body.shareToken, "string");
  return body;
}

async function closeSocket(socket) {
  if (!socket) return;
  socket.close();
}

before(async () => {
  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert(address && typeof address === "object");
      baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
});

after(async () => {
  io.close();
  await new Promise((resolve) => server.close(resolve));
});

test("requires the private share token to publish room locations", async () => {
  const { roomId, shareToken } = await createRoom();
  const viewer = await connectSocket();
  const attacker = await connectSocket();
  const owner = await connectSocket();

  try {
    viewer.emit("join", { roomId });
    await delay(50);

    let unauthorizedUpdate = false;
    viewer.once("location-update", () => {
      unauthorizedUpdate = true;
    });
    attacker.emit("location", { roomId, lat: 10, lng: 20 });
    await delay(100);
    assert.equal(unauthorizedUpdate, false);

    const updatePromise = once(viewer, "location-update");
    owner.emit("location", { roomId, shareToken, lat: 11, lng: 21 });
    const update = await updatePromise;
    assert.equal(update.lat, 11);
    assert.equal(update.lng, 21);
  } finally {
    await closeSocket(viewer);
    await closeSocket(attacker);
    await closeSocket(owner);
  }
});

test("requires the private share token to stop a room", async () => {
  const { roomId, shareToken } = await createRoom();
  const viewer = await connectSocket();
  const attacker = await connectSocket();
  const owner = await connectSocket();

  try {
    viewer.emit("join", { roomId });
    await delay(50);

    let unauthorizedEnd = false;
    viewer.once("sharing-ended", () => {
      unauthorizedEnd = true;
    });
    attacker.emit("stop-sharing", { roomId });
    await delay(100);
    assert.equal(unauthorizedEnd, false);

    const endedPromise = once(viewer, "sharing-ended");
    owner.emit("stop-sharing", { roomId, shareToken });
    await endedPromise;

    const existsRes = await fetch(`${baseUrl}/api/rooms/${encodeURIComponent(roomId)}`);
    assert.deepEqual(await existsRes.json(), { exists: false });
  } finally {
    await closeSocket(viewer);
    await closeSocket(attacker);
    await closeSocket(owner);
  }
});

test("requires the private share token for the REST stop fallback", async () => {
  const { roomId, shareToken } = await createRoom();
  const viewer = await connectSocket();

  try {
    viewer.emit("join", { roomId });
    await delay(50);

    const unauthorized = await fetch(`${baseUrl}/api/rooms/${encodeURIComponent(roomId)}/stop`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shareToken: "wrong-token" }),
    });
    assert.equal(unauthorized.status, 403);

    const endedPromise = once(viewer, "sharing-ended");
    const authorized = await fetch(`${baseUrl}/api/rooms/${encodeURIComponent(roomId)}/stop`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shareToken }),
    });
    assert.equal(authorized.status, 200);
    await endedPromise;
  } finally {
    await closeSocket(viewer);
  }
});
