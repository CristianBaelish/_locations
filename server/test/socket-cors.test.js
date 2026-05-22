import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import net from "node:net";
import test from "node:test";

const serverDir = fileURLToPath(new URL("..", import.meta.url));

async function getFreePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object");
  await new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  return address.port;
}

async function startServer(t) {
  const port = await getFreePort();
  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: serverDir,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });

  t.after(() => {
    if (!child.killed) child.kill("SIGTERM");
  });

  let output = "";
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`server did not become ready:\n${output}`));
    }, 5_000);

    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
      if (output.includes("Server http://")) {
        clearTimeout(timer);
        resolve();
      }
    });

    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });

    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`server exited before ready (${code ?? signal}):\n${output}`));
    });
  });

  await ready;
  return { child, port };
}

test("Socket.IO accepts cross-origin polling handshakes", async (t) => {
  const { child, port } = await startServer(t);

  const response = await fetch(`http://127.0.0.1:${port}/socket.io/?EIO=4&transport=polling`, {
    headers: { Origin: "https://example.com" },
    signal: AbortSignal.timeout(2_000),
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), "https://example.com");
  assert.match(await response.text(), /^\d+\{/);

  child.kill("SIGTERM");
  await once(child, "exit");
});
