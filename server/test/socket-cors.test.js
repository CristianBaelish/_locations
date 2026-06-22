import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import net from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { io as createSocket } from "socket.io-client";
import test from "node:test";

async function getFreePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object");
  const { port } = address;
  await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  return port;
}

async function waitForServer(port, child, stderr) {
  const deadline = Date.now() + 5_000;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`server exited early (${child.exitCode}): ${stderr.text}`);
    }

    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok && (await res.text()) === "ok") return;
    } catch {
      // Server is still starting.
    }

    await delay(50);
  }

  throw new Error(`server did not become ready: ${stderr.text}`);
}

test("accepts cross-origin Socket.IO polling handshakes", async (t) => {
  const port = await getFreePort();
  const stderr = { text: "" };
  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      PORT: String(port),
      FRONTEND_URL: "https://locationspov.example",
    },
    stdio: ["ignore", "ignore", "pipe"],
  });

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr.text += chunk;
  });

  t.after(async () => {
    if (child.exitCode === null) {
      child.kill();
      await Promise.race([once(child, "exit"), delay(1_000)]);
    }
  });

  await waitForServer(port, child, stderr);

  const socket = createSocket(`http://127.0.0.1:${port}`, {
    path: "/socket.io",
    transports: ["polling"],
    timeout: 1_000,
    reconnection: false,
    extraHeaders: {
      Origin: "https://locationspov.example",
    },
  });

  t.after(() => socket.close());

  await Promise.race([
    once(socket, "connect"),
    once(socket, "connect_error").then(([err]) => {
      throw err;
    }),
    delay(1_500).then(() => {
      throw new Error("Socket.IO polling handshake timed out");
    }),
  ]);
});
