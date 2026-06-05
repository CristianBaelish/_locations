import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import net from "node:net";
import test from "node:test";

const ORIGIN = "https://example.vercel.app";
const SERVER_DIR = fileURLToPath(new URL("..", import.meta.url));

async function getFreePort() {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  const { port } = address;
  server.close();
  await once(server, "close");
  return port;
}

async function waitForServer(child, port) {
  let output = "";

  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });

  const started = new Promise((resolve) => {
    const onData = () => {
      if (output.includes(`Server http://0.0.0.0:${port}`)) resolve();
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
  });

  const exited = once(child, "exit").then(([code, signal]) => {
    throw new Error(`server exited before listening: code=${code} signal=${signal}\n${output}`);
  });

  await Promise.race([started, exited]);
}

async function fetchWithAbort(url, init, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

test("Socket.IO polling handshake responds for allowed HTTPS origins", async (t) => {
  const port = await getFreePort();
  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: SERVER_DIR,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });

  t.after(() => {
    if (!child.killed && child.exitCode == null) {
      child.kill();
    }
  });

  await waitForServer(child, port);

  const response = await fetchWithAbort(
    `http://127.0.0.1:${port}/socket.io/?EIO=4&transport=polling&t=cors-test`,
    { headers: { Origin: ORIGIN } },
    2_000
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), ORIGIN);
  assert.match(await response.text(), /^0\{/);
});
