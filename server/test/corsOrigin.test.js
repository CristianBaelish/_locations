import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { Server } from "socket.io";
import { corsOrigin, originAllowed } from "../src/corsOrigin.js";

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function requestPollingHandshake(port) {
  return new Promise((resolve, reject) => {
    const req = http.get(
      {
        hostname: "127.0.0.1",
        port,
        path: "/socket.io/?EIO=4&transport=polling&t=cors-test",
        headers: {
          Origin: "https://locations.example",
        },
      },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res));
      }
    );

    req.setTimeout(1000, () => {
      req.destroy(new Error("Socket.IO polling handshake timed out"));
    });
    req.on("error", reject);
  });
}

test("originAllowed permits browser clients expected by the app", () => {
  assert.equal(originAllowed(undefined), true);
  assert.equal(originAllowed("https://locations.example"), true);
  assert.equal(originAllowed("http://localhost:5173"), true);
  assert.equal(originAllowed("http://127.0.0.1:5173"), true);
  assert.equal(originAllowed("http://192.168.1.20:5173"), true);
});

test("originAllowed blocks unexpected insecure origins", () => {
  assert.equal(originAllowed("http://evil.example"), false);
});

test("corsOrigin uses the callback signature required by cors and Engine.IO", () => {
  let calls = 0;

  corsOrigin("https://locations.example", (err, allowed) => {
    calls += 1;
    assert.equal(err, null);
    assert.equal(allowed, true);
  });

  corsOrigin("http://evil.example", (err, allowed) => {
    calls += 1;
    assert.equal(err, null);
    assert.equal(allowed, false);
  });

  assert.equal(calls, 2);
});

test("Socket.IO polling handshake completes for an allowed cross-origin client", async () => {
  const httpServer = http.createServer();
  const io = new Server(httpServer, {
    cors: {
      origin: corsOrigin,
      methods: ["GET", "POST"],
    },
  });

  await listen(httpServer);

  try {
    const { port } = httpServer.address();
    const res = await requestPollingHandshake(port);

    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["access-control-allow-origin"], "https://locations.example");
  } finally {
    io.close();
    await close(httpServer);
  }
});
