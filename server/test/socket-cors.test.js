import assert from "node:assert/strict";
import { once } from "node:events";
import net from "node:net";
import { spawn } from "node:child_process";
import test from "node:test";

async function getPort() {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const port = address.port;
  await new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  return port;
}

async function waitForHealth(baseUrl) {
  const deadline = Date.now() + 5_000;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/health`, {
        signal: AbortSignal.timeout(500),
      });
      if (res.ok) return;
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw lastError ?? new Error("server did not become healthy");
}

test("Socket.IO polling CORS origin callback completes the handshake", async (t) => {
  const port = await getPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: String(port) },
    stdio: "ignore",
  });

  t.after(() => {
    child.kill();
  });

  await waitForHealth(baseUrl);

  const origin = "https://locationspov.vercel.app";
  const res = await fetch(`${baseUrl}/socket.io/?EIO=4&transport=polling`, {
    headers: { Origin: origin },
    signal: AbortSignal.timeout(2_000),
  });

  assert.equal(res.status, 200);
  assert.equal(res.headers.get("access-control-allow-origin"), origin);
  assert.match(await res.text(), /^\d+\{/);
});
