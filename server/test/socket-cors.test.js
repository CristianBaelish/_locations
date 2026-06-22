import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import { afterEach, test } from "node:test";
import { io } from "socket.io-client";

const startedServers = new Set();

afterEach(async () => {
  await Promise.all(
    Array.from(startedServers, (child) => {
      startedServers.delete(child);
      return stopServer(child);
    })
  );
});

test("allows cross-origin polling Socket.IO handshakes", async () => {
  const port = await getFreePort();
  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  startedServers.add(child);

  await waitForHealth(port);

  const socket = io(`http://127.0.0.1:${port}`, {
    transports: ["polling"],
    timeout: 2_000,
    extraHeaders: {
      Origin: "https://example.com",
    },
    reconnection: false,
  });

  try {
    await waitForConnect(socket);
  } finally {
    socket.close();
  }
});

function waitForConnect(socket) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("socket did not connect before timeout"));
    }, 3_000);

    function cleanup() {
      clearTimeout(timeout);
      socket.off("connect", onConnect);
      socket.off("connect_error", onError);
    }

    function onConnect() {
      cleanup();
      resolve();
    }

    function onError(error) {
      cleanup();
      reject(error);
    }

    socket.on("connect", onConnect);
    socket.on("connect_error", onError);
  });
}

async function waitForHealth(port) {
  const deadline = Date.now() + 5_000;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }

    await delay(50);
  }

  assert.fail(`server did not become healthy: ${lastError?.message ?? "unknown error"}`);
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === "object") {
          resolve(address.port);
        } else {
          reject(new Error("could not allocate a local port"));
        }
      });
    });
    server.on("error", reject);
  });
}

function stopServer(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 2_000);

    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });

    child.kill("SIGTERM");
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
