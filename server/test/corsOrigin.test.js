import test from "node:test";
import assert from "node:assert/strict";
import { corsOrigin, originAllowed } from "../src/corsOrigin.js";

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
