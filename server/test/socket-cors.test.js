import assert from "node:assert/strict";
import { test } from "node:test";
import { io, server } from "../src/index.js";

function listenOnEphemeralPort() {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      assert(address && typeof address === "object");
      resolve(address.port);
    });
  });
}

test("Socket.IO polling accepts allowed cross-origin handshakes", async (t) => {
  const port = await listenOnEphemeralPort();

  t.after(async () => {
    await new Promise((resolve) => io.close(resolve));
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1_500);

  const response = await fetch(`http://127.0.0.1:${port}/socket.io/?EIO=4&transport=polling&t=test`, {
    headers: {
      Origin: "https://example.vercel.app",
    },
    signal: controller.signal,
  });
  clearTimeout(timer);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), "https://example.vercel.app");
});
