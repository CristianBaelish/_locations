import assert from "node:assert/strict";
import { test } from "node:test";
import { io as connectClient } from "socket.io-client";
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
    io.close();
    await new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  const socket = connectClient(`http://127.0.0.1:${port}`, {
    extraHeaders: {
      Origin: "https://example.vercel.app",
    },
    forceNew: true,
    timeout: 1_000,
    transports: ["polling"],
  });

  t.after(() => {
    socket.close();
  });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Socket.IO polling handshake timed out")), 1_500);
    socket.once("connect", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once("connect_error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });

  assert.equal(socket.connected, true);
});
