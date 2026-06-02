import { once } from "node:events";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import net from "node:net";
import test from "node:test";
import assert from "node:assert/strict";

async function getAvailablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert(address && typeof address === "object");
  const { port } = address;
  await new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  return port;
}

async function waitForHealth(port, signal) {
  const url = `http://127.0.0.1:${port}/health`;
  let lastError;
  while (!signal.aborted) {
    try {
      const res = await fetch(url, { signal });
      if (res.ok && (await res.text()) === "ok") return;
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw lastError ?? new Error("Timed out waiting for server health");
}

async function stopServer(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  const timeout = setTimeout(() => child.kill("SIGKILL"), 2_000);
  try {
    await once(child, "exit");
  } finally {
    clearTimeout(timeout);
  }
}

test("Socket.IO polling handshake completes for allowed cross-origin browsers", async (t) => {
  const port = await getAvailablePort();
  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: { ...process.env, PORT: String(port), FRONTEND_URL: "https://app.example.com" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => stopServer(child));

  const startupAbort = AbortSignal.timeout(5_000);
  await waitForHealth(port, startupAbort);
  assert.equal(child.exitCode, null);

  const origin = "https://app.example.com";
  const handshakeAbort = AbortSignal.timeout(1_000);
  const res = await fetch(`http://127.0.0.1:${port}/socket.io/?EIO=4&transport=polling`, {
    headers: { Origin: origin },
    signal: handshakeAbort,
  });

  assert.equal(res.status, 200);
  assert.equal(res.headers.get("access-control-allow-origin"), origin);
  assert.match(await res.text(), /^0\{/);
});
