import { once } from "node:events";
import { spawn } from "node:child_process";
import net from "node:net";
import test from "node:test";
import assert from "node:assert/strict";

async function getFreePort() {
  const probe = net.createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const address = probe.address();
  await new Promise((resolve, reject) => {
    probe.close((err) => (err ? reject(err) : resolve()));
  });
  assert.equal(typeof address, "object");
  assert.notEqual(address, null);
  return address.port;
}

async function waitForHealth(baseUrl) {
  const deadline = Date.now() + 5000;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/health`, {
        signal: AbortSignal.timeout(500),
      });
      if (res.ok && (await res.text()) === "ok") return;
    } catch (e) {
      lastError = e;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw lastError ?? new Error("server did not become healthy");
}

test("Socket.IO polling handshake completes with cross-origin CORS", async (t) => {
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });

  t.after(() => {
    child.kill();
  });

  await waitForHealth(baseUrl);

  const res = await fetch(`${baseUrl}/socket.io/?EIO=4&transport=polling`, {
    headers: { Origin: "https://viewer.example" },
    signal: AbortSignal.timeout(2000),
  });

  assert.equal(res.status, 200, output);
  assert.equal(res.headers.get("access-control-allow-origin"), "https://viewer.example");
  assert.match(await res.text(), /^0\{/);
});
