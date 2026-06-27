import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { after, before, test } from "node:test";
import { io as createClient } from "socket.io-client";

const PORT = 40_000 + Math.floor(Math.random() * 10_000);
const ORIGIN = `http://127.0.0.1:${PORT}`;

/** @type {import("node:child_process").ChildProcessWithoutNullStreams | undefined} */
let serverProcess;

async function waitForHealth() {
  const deadline = Date.now() + 10_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${ORIGIN}/health`);
      if (res.ok && (await res.text()) === "ok") return;
    } catch (e) {
      lastError = e;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw lastError ?? new Error("Timed out waiting for server health check");
}

function connectSocket() {
  const socket = createClient(ORIGIN, {
    path: "/socket.io",
    transports: ["polling"],
    timeout: 5_000,
    forceNew: true,
  });

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("Timed out connecting socket"));
    }, 5_000);
    socket.once("connect", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once("connect_error", (err) => {
      clearTimeout(timer);
      socket.close();
      reject(err);
    });
  });
}

function emitWithAck(socket, event, payload) {
  return new Promise((resolve) => {
    socket.timeout(2_000).emit(event, payload, (err, response) => {
      if (err) {
        resolve({ ok: false, error: "ack-timeout" });
        return;
      }
      resolve(response);
    });
  });
}

before(async () => {
  serverProcess = spawn(process.execPath, ["src/index.js"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForHealth();
});

after(() => {
  serverProcess?.kill();
});

test("requires private share token for live room writes", async () => {
  const createRes = await fetch(`${ORIGIN}/api/rooms`, { method: "POST" });
  assert.equal(createRes.status, 200);
  const created = await createRes.json();
  assert.equal(typeof created.roomId, "string");
  assert.equal(typeof created.shareToken, "string");

  const viewer = await connectSocket();
  const attacker = await connectSocket();
  const owner = await connectSocket();

  try {
    assert.deepEqual(await emitWithAck(viewer, "join", { roomId: created.roomId }), {
      ok: true,
      peers: 1,
      hasCached: false,
    });

    const spoofedUpdates = [];
    viewer.on("location-update", (update) => spoofedUpdates.push(update));

    assert.deepEqual(
      await emitWithAck(attacker, "location", {
        roomId: created.roomId,
        lat: 1,
        lng: 2,
      }),
      { ok: false, error: "unauthorized" }
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.deepEqual(spoofedUpdates, []);

    assert.deepEqual(await emitWithAck(attacker, "stop-sharing", { roomId: created.roomId }), {
      ok: false,
      error: "unauthorized",
    });
    const stillExists = await fetch(`${ORIGIN}/api/rooms/${created.roomId}`);
    assert.deepEqual(await stillExists.json(), { exists: true });

    assert.deepEqual(
      await emitWithAck(owner, "location", {
        roomId: created.roomId,
        shareToken: created.shareToken,
        lat: 10,
        lng: 20,
      }),
      { ok: true }
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(spoofedUpdates.length, 1);
    assert.equal(spoofedUpdates[0].lat, 10);
    assert.equal(spoofedUpdates[0].lng, 20);

    assert.deepEqual(
      await emitWithAck(owner, "stop-sharing", {
        roomId: created.roomId,
        shareToken: created.shareToken,
      }),
      { ok: true }
    );
    const ended = await fetch(`${ORIGIN}/api/rooms/${created.roomId}`);
    assert.deepEqual(await ended.json(), { exists: false });

    const lateViewer = await connectSocket();
    try {
      assert.deepEqual(await emitWithAck(lateViewer, "join", { roomId: created.roomId }), {
        ok: false,
        error: "room-not-found",
      });
    } finally {
      lateViewer.close();
    }
  } finally {
    viewer.close();
    attacker.close();
    owner.close();
  }
});
