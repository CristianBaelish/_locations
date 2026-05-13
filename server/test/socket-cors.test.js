import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { Server } from "socket.io";
import { corsOrigin } from "../src/cors-origin.js";

test("Socket.IO polling handshake completes for allowed browser origins", async (t) => {
  const httpServer = http.createServer();
  const io = new Server(httpServer, {
    cors: {
      origin: corsOrigin,
      methods: ["GET", "POST"],
    },
  });
  t.after(() => {
    io.close();
    httpServer.close();
  });

  await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const { port } = httpServer.address();
  const origin = "https://viewer.example";

  const response = await fetch(
    `http://127.0.0.1:${port}/socket.io/?EIO=4&transport=polling&t=cors-test`,
    {
      headers: { Origin: origin },
      signal: AbortSignal.timeout(1_000),
    }
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), origin);
  assert.match(await response.text(), /^0\{/);
});
