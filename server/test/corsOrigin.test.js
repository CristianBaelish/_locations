import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import net from "node:net";
import test from "node:test";

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

async function waitForHealth(port) {
  const deadline = Date.now() + 5_000;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(500),
      });
      if (res.ok && (await res.text()) === "ok") return;
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw lastError ?? new Error("server did not become healthy");
}

async function startServer(t) {
  const port = await getFreePort();
  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  t.after(() => {
    child.kill();
  });

  await waitForHealth(port).catch((err) => {
    child.kill();
    throw new Error(`${err instanceof Error ? err.message : err}\n${stderr}`);
  });

  return { port };
}

test("Socket.IO polling handshake completes for allowed cross-origin clients", async (t) => {
  const { port } = await startServer(t);
  const origin = "https://viewer.example";

  const res = await fetch(`http://127.0.0.1:${port}/socket.io/?EIO=4&transport=polling&t=cors-test`, {
    headers: { Origin: origin },
    signal: AbortSignal.timeout(2_000),
  });

  assert.equal(res.status, 200);
  assert.equal(res.headers.get("access-control-allow-origin"), origin);
  assert.match(await res.text(), /^0/);
});
