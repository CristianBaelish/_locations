import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.join(__dirname, "..");

test("Socket.IO polling handshake completes for cross-origin browsers", async () => {
  const port = await getFreePort();
  const server = spawn(process.execPath, ["src/index.js"], {
    cwd: serverRoot,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  server.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  server.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });

  try {
    await waitForHealth(port, server);

    const origin = "https://frontend.example";
    const response = await httpGet({
      port,
      path: "/socket.io/?EIO=4&transport=polling&t=cors-regression",
      headers: { Origin: origin },
      timeoutMs: 2_000,
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["access-control-allow-origin"], origin);
    assert.match(response.body, /^0\{/);
  } finally {
    await stopServer(server, output);
  }
});

async function getFreePort() {
  const server = http.createServer();
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

async function waitForHealth(port, server) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`server exited before becoming healthy with code ${server.exitCode}`);
    }
    try {
      const response = await httpGet({
        port,
        path: "/health",
        timeoutMs: 250,
      });
      if (response.statusCode === 200 && response.body === "ok") return;
    } catch {
      // The child process may still be binding the port.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("server did not become healthy");
}

async function httpGet({ port, path, headers = {}, timeoutMs }) {
  return await new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method: "GET",
        headers,
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          resolve({ statusCode: res.statusCode, headers: res.headers, body });
        });
      }
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`GET ${path} timed out after ${timeoutMs}ms`));
    });
    req.on("error", reject);
    req.end();
  });
}

async function stopServer(server, output) {
  if (server.exitCode !== null) return;
  server.kill();
  const timeout = new Promise((resolve) => setTimeout(resolve, 2_000, "timeout"));
  const result = await Promise.race([once(server, "exit"), timeout]);
  if (result === "timeout") {
    server.kill("SIGKILL");
    throw new Error(`server did not stop cleanly. Output:\n${output}`);
  }
}
