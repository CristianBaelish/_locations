import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { io as connectSocket } from "socket.io-client";

async function startServer() {
  const port = 35_000 + Math.floor(Math.random() * 10_000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });

  for (let i = 0; i < 50; i += 1) {
    if (child.exitCode != null) {
      throw new Error(`Server exited before readiness:\n${output}`);
    }
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok) {
        return {
          baseUrl,
          async stop() {
            child.kill();
            await delay(50);
          },
        };
      }
    } catch {
      // Keep polling until the child has bound the port.
    }
    await delay(100);
  }

  child.kill();
  throw new Error(`Server did not become ready:\n${output}`);
}

async function createRoom(baseUrl) {
  const res = await fetch(`${baseUrl}/api/rooms`, { method: "POST" });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(typeof body.roomId, "string");
  assert.equal(typeof body.shareToken, "string");
  return body;
}

async function connect(baseUrl) {
  const socket = connectSocket(baseUrl, {
    transports: ["polling"],
    timeout: 5_000,
    forceNew: true,
  });
  await waitFor(socket, "connect", 5_000);
  return socket;
}

function waitFor(socket, event, timeoutMs = 1_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, onEvent);
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeoutMs);
    const onEvent = (...args) => {
      clearTimeout(timer);
      resolve(args);
    };
    socket.once(event, onEvent);
  });
}

async function expectNoEvent(socket, event, action) {
  let fired = false;
  const onEvent = () => {
    fired = true;
  };
  socket.once(event, onEvent);
  action();
  await delay(250);
  socket.off(event, onEvent);
  assert.equal(fired, false, `${event} should not have fired`);
}

test("only the private share token can publish or end a room", async (t) => {
  const server = await startServer();
  t.after(server.stop);

  const { roomId, shareToken } = await createRoom(server.baseUrl);
  const viewer = await connect(server.baseUrl);
  const attacker = await connect(server.baseUrl);
  const sharer = await connect(server.baseUrl);
  t.after(() => {
    viewer.close();
    attacker.close();
    sharer.close();
  });

  const joinAck = await new Promise((resolve) => {
    viewer.emit("join", { roomId }, resolve);
  });
  assert.equal(joinAck.ok, true);

  attacker.emit("join", null);
  attacker.emit("stop-sharing", null);
  assert.equal(attacker.connected, true);

  await expectNoEvent(viewer, "location-update", () => {
    attacker.emit("location", { roomId, lat: 1, lng: 2 });
  });
  await expectNoEvent(viewer, "sharing-ended", () => {
    attacker.emit("stop-sharing", { roomId });
  });

  sharer.emit("location", { roomId, shareToken, lat: 3, lng: 4, heading: 90 });
  const [update] = await waitFor(viewer, "location-update");
  assert.equal(update.lat, 3);
  assert.equal(update.lng, 4);
  assert.equal(update.heading, 90);

  await expectNoEvent(viewer, "sharing-ended", () => {
    attacker.emit("stop-sharing", { roomId, shareToken: "wrong" });
  });

  sharer.emit("stop-sharing", { roomId, shareToken });
  await waitFor(viewer, "sharing-ended");
});
