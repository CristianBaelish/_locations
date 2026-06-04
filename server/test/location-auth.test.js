import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import net from "node:net";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { io } from "socket.io-client";

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverRoot = join(__dirname, "..");

async function getFreePort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const address = probe.address();
  assert(address && typeof address === "object");
  const { port } = address;
  await new Promise((resolve, reject) => {
    probe.close((err) => (err ? reject(err) : resolve()));
  });
  return port;
}

function request(method, url) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        text += chunk;
      });
      res.on("end", () => {
        resolve({ statusCode: res.statusCode, text });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

async function waitForHealth(baseUrl, child, stderr) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) {
      throw new Error(`server exited early with ${child.exitCode}: ${stderr()}`);
    }
    try {
      const res = await request("GET", `${baseUrl}/health`);
      if (res.statusCode === 200 && res.text === "ok") return;
    } catch {
      // Retry until the server has bound the test port.
    }
    await delay(50);
  }
  throw new Error(`server did not become healthy: ${stderr()}`);
}

function connectSocket(baseUrl) {
  const socket = io(baseUrl, {
    path: "/socket.io",
    transports: ["polling", "websocket"],
    timeout: 5_000,
    reconnection: false,
    forceNew: true,
  });

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      socket.close();
      reject(new Error("timed out connecting socket"));
    }, 5_000);

    function cleanup() {
      clearTimeout(timer);
      socket.off("connect", onConnect);
      socket.off("connect_error", onError);
    }

    function onConnect() {
      cleanup();
      resolve(socket);
    }

    function onError(err) {
      cleanup();
      socket.close();
      reject(err);
    }

    socket.once("connect", onConnect);
    socket.once("connect_error", onError);
  });
}

function waitForLocation(socket, timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      socket.off("location-update", onUpdate);
      resolve(null);
    }, timeoutMs);

    function onUpdate(payload) {
      clearTimeout(timer);
      resolve(payload);
    }

    socket.once("location-update", onUpdate);
  });
}

test("location updates require the room share token", async (t) => {
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  let stderr = "";
  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: serverRoot,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "ignore", "pipe"],
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  t.after(() => {
    child.kill();
  });

  await waitForHealth(baseUrl, child, () => stderr);

  const createRes = await request("POST", `${baseUrl}/api/rooms`);
  assert.equal(createRes.statusCode, 200);
  const created = JSON.parse(createRes.text);
  assert.equal(typeof created.roomId, "string");
  assert.equal(typeof created.shareToken, "string");

  const viewer = await connectSocket(baseUrl);
  const attacker = await connectSocket(baseUrl);
  const sharer = await connectSocket(baseUrl);
  t.after(() => {
    viewer.close();
    attacker.close();
    sharer.close();
  });

  viewer.emit("join", { roomId: created.roomId });
  await delay(100);

  attacker.emit("location", {
    roomId: created.roomId,
    lat: 10,
    lng: 20,
  });
  assert.equal(await waitForLocation(viewer, 300), null);

  attacker.emit("location", {
    roomId: created.roomId,
    shareToken: "wrong-token",
    lat: 11,
    lng: 21,
  });
  assert.equal(await waitForLocation(viewer, 300), null);

  sharer.emit("location", {
    roomId: created.roomId,
    shareToken: created.shareToken,
    lat: 12.34,
    lng: 56.78,
    heading: 90,
  });
  const update = await waitForLocation(viewer, 1_000);
  assert.deepEqual(
    { lat: update?.lat, lng: update?.lng, heading: update?.heading },
    { lat: 12.34, lng: 56.78, heading: 90 }
  );
});
