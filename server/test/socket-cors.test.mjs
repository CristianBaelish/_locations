import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import net from "node:net";
import path from "node:path";
import test from "node:test";

const serverDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

async function getFreePort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const address = probe.address();
  assert(address && typeof address === "object");
  await new Promise((resolve, reject) => {
    probe.close((err) => (err ? reject(err) : resolve()));
  });
  return address.port;
}

async function waitForHealth(port, processExited, logs) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (processExited()) {
      assert.fail(`server exited before becoming healthy\n${logs()}`);
    }
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail(`server did not become healthy\n${logs()}`);
}

test("Socket.IO polling handshake completes for an allowed browser origin", async (t) => {
  const port = await getFreePort();
  let logs = "";
  let exited = false;
  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: serverDir,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk) => {
    logs += chunk;
  });
  child.stderr.on("data", (chunk) => {
    logs += chunk;
  });
  child.on("exit", () => {
    exited = true;
  });
  t.after(() => {
    child.kill("SIGTERM");
  });

  await waitForHealth(port, () => exited, () => logs);

  const allowedOrigin = "https://example.vercel.app";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1_500);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/socket.io/?EIO=4&transport=polling&t=test`, {
      headers: { Origin: allowedOrigin },
      signal: controller.signal,
    });
    const body = await res.text();

    assert.equal(res.status, 200);
    assert.equal(res.headers.get("access-control-allow-origin"), allowedOrigin);
    assert.match(body, /^0\{"sid":/);
  } finally {
    clearTimeout(timeout);
  }
});
