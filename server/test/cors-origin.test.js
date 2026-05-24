import assert from "node:assert/strict";
import { after, test } from "node:test";
import { corsOrigin, io, server, socketCors } from "../src/index.js";

after(() => {
  io.close();
  if (server.listening) server.close();
});

test("Socket.IO CORS uses the callback-based origin adapter", () => {
  assert.equal(socketCors.origin, corsOrigin);

  let called = false;
  corsOrigin("https://locationspov.vercel.app", (err, allowed) => {
    called = true;
    assert.equal(err, null);
    assert.equal(allowed, true);
  });

  assert.equal(called, true);
});

test("CORS origin adapter rejects disallowed origins through the callback", () => {
  corsOrigin("http://example.com", (err, allowed) => {
    assert.equal(err, null);
    assert.equal(allowed, false);
  });
});
