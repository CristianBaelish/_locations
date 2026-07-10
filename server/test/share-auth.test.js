import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { io as createClient } from "socket.io-client";

process.env.PORT = "0";

const { io, server } = await import("../src/index.js");

if (!server.listening) {
  await once(server, "listening");
}

const address = server.address();
assert.ok(address && typeof address === "object");
const baseUrl = `http://127.0.0.1:${address.port}`;

/** @type {Set<import("socket.io-client").Socket>} */
const clients = new Set();

test.afterEach(() => {
  for (const client of clients) {
    client.close();
  }
  clients.clear();
});

test.after(async () => {
  await new Promise((resolve) => io.close(resolve));
  if (server.listening) {
    await new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
});

function connectClient() {
  const client = createClient(baseUrl, {
    forceNew: true,
    timeout: 2_000,
    transports: ["polling"],
  });
  clients.add(client);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("socket connect timed out")), 3_000);
    client.once("connect", () => {
      clearTimeout(timer);
      resolve(client);
    });
    client.once("connect_error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function emitWithAck(client, event, payload) {
  return new Promise((resolve, reject) => {
    client.timeout(1_000).emit(event, payload, (err, response) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(response);
    });
  });
}

function waitForEvent(client, event) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.off(event, listener);
      reject(new Error(`timed out waiting for ${event}`));
    }, 1_000);
    const listener = (payload) => {
      clearTimeout(timer);
      resolve(payload);
    };
    client.once(event, listener);
  });
}

async function assertNoEvent(client, event, action) {
  let received = false;
  const listener = () => {
    received = true;
  };
  client.on(event, listener);
  action();
  await new Promise((resolve) => setTimeout(resolve, 150));
  client.off(event, listener);
  assert.equal(received, false, `${event} should not have been emitted`);
}

test("public room ids cannot publish locations or stop sharing", async () => {
  const createRes = await fetch(`${baseUrl}/api/rooms`, { method: "POST" });
  assert.equal(createRes.status, 200);
  const { roomId, shareToken } = await createRes.json();
  assert.equal(typeof roomId, "string");
  assert.equal(typeof shareToken, "string");

  const viewer = await connectClient();
  const attacker = await connectClient();
  const sharer = await connectClient();

  assert.deepEqual(await emitWithAck(viewer, "join", { roomId }), {
    ok: true,
    peers: 1,
    hasCached: false,
  });

  await assertNoEvent(viewer, "location-update", () => {
    attacker.emit("location", { roomId, lat: 10, lng: 20 });
  });
  await assertNoEvent(viewer, "location-update", () => {
    attacker.emit("location", { roomId, shareToken: "wrong", lat: 10, lng: 20 });
  });

  const updatePromise = waitForEvent(viewer, "location-update");
  sharer.emit("location", { roomId, shareToken, lat: 10, lng: 20, heading: 90 });
  const update = await updatePromise;
  assert.equal(update.roomId, roomId);
  assert.equal(update.lat, 10);
  assert.equal(update.lng, 20);
  assert.equal(update.heading, 90);
  assert.equal(update.courseDeg, null);
  assert.equal(Number.isFinite(update.t), true);

  await assertNoEvent(viewer, "sharing-ended", () => {
    attacker.emit("stop-sharing", { roomId });
  });
  await assertNoEvent(viewer, "sharing-ended", () => {
    attacker.emit("stop-sharing", { roomId, shareToken: "wrong" });
  });

  const endedPromise = waitForEvent(viewer, "sharing-ended");
  sharer.emit("stop-sharing", { roomId, shareToken });
  assert.deepEqual(await endedPromise, { roomId });

  await assertNoEvent(viewer, "location-update", () => {
    sharer.emit("location", { roomId, shareToken, lat: 30, lng: 40 });
  });
});
