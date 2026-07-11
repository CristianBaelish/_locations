import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import net from "node:net";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { io as Client } from "socket.io-client";

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** @type {import("node:child_process").ChildProcess | null} */
let serverProcess = null;
let baseUrl = "";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function availablePort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const address = probe.address();
  assert(address && typeof address === "object");
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.close(resolve);
  });
  return address.port;
}

async function waitForServer() {
  const deadline = Date.now() + 10_000;
  let stderr = "";
  serverProcess?.stderr?.setEncoding("utf8");
  serverProcess?.stderr?.on("data", (chunk) => {
    stderr += chunk;
  });

  while (Date.now() < deadline) {
    if (serverProcess?.exitCode != null) {
      throw new Error(`server exited before becoming ready: ${stderr}`);
    }
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {
      // The process may still be binding its port.
    }
    await delay(50);
  }
  throw new Error(`server did not become ready: ${stderr}`);
}

async function createRoom() {
  const response = await fetch(`${baseUrl}/api/rooms`, { method: "POST" });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(typeof body.roomId, "string");
  assert.equal(typeof body.shareToken, "string");
  return body;
}

async function connectSocket() {
  const socket = Client(baseUrl, {
    transports: ["polling"],
    reconnection: false,
    timeout: 5_000,
    forceNew: true,
  });

  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("socket connect timed out"));
    }, 5_000);
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

async function waitForEvent(socket, eventName, timeoutMs = 1_000) {
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(eventName, onEvent);
      reject(new Error(`timed out waiting for ${eventName}`));
    }, timeoutMs);
    const onEvent = (...args) => {
      clearTimeout(timer);
      resolve(args);
    };
    socket.once(eventName, onEvent);
  });
}

async function expectNoEvent(socket, eventName, timeoutMs = 150) {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(eventName, onEvent);
      resolve();
    }, timeoutMs);
    const onEvent = (...args) => {
      clearTimeout(timer);
      reject(new Error(`unexpected ${eventName}: ${JSON.stringify(args)}`));
    };
    socket.once(eventName, onEvent);
  });
}

before(async () => {
  const port = await availablePort();
  baseUrl = `http://127.0.0.1:${port}`;
  serverProcess = spawn(process.execPath, ["src/index.js"], {
    cwd: serverDir,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "ignore", "pipe"],
  });
  await waitForServer();
});

after(async () => {
  if (!serverProcess || serverProcess.exitCode != null) return;
  serverProcess.kill();
  await Promise.race([once(serverProcess, "exit"), delay(2_000)]);
});

test("viewers cannot spoof locations or end a room without the share token", async () => {
  const { roomId, shareToken } = await createRoom();
  const watcher = await connectSocket();
  const attacker = await connectSocket();

  try {
    const joinAck = await watcher.timeout(1_000).emitWithAck("join", { roomId });
    assert.equal(joinAck.ok, true);

    attacker.emit("location", { roomId, lat: 10, lng: 20 });
    await expectNoEvent(watcher, "location-update");

    attacker.emit("location", { roomId, shareToken: "wrong-token", lat: 10, lng: 20 });
    await expectNoEvent(watcher, "location-update");

    attacker.emit("stop-sharing", { roomId });
    await expectNoEvent(watcher, "sharing-ended");

    attacker.emit("stop-sharing", { roomId, shareToken: "wrong-token" });
    await expectNoEvent(watcher, "sharing-ended");

    attacker.emit("location", { roomId, shareToken, lat: 30, lng: 40, heading: 90 });
    const [update] = await waitForEvent(watcher, "location-update");
    assert.equal(update.lat, 30);
    assert.equal(update.lng, 40);
    assert.equal(update.heading, 90);

    attacker.emit("stop-sharing", { roomId, shareToken });
    await waitForEvent(watcher, "sharing-ended");
  } finally {
    watcher.close();
    attacker.close();
  }
});

test("socket events cannot create arbitrary rooms", async () => {
  const roomId = "unknownRoom";
  const socket = await connectSocket();

  try {
    const joinAck = await socket.timeout(1_000).emitWithAck("join", { roomId });
    assert.deepEqual(joinAck, { ok: false, reason: "not-found" });

    socket.emit("location", { roomId, shareToken: "anything", lat: 10, lng: 20 });
    socket.emit("stop-sharing", { roomId, shareToken: "anything" });
    await delay(50);

    const response = await fetch(`${baseUrl}/api/rooms/${roomId}`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { exists: false });
  } finally {
    socket.close();
  }
});
