import { spawn } from "node:child_process";
import { once } from "node:events";
import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = 37000 + Math.floor(Math.random() * 2000);
const base = `http://127.0.0.1:${port}`;

const child = spawn(process.execPath, ["src/index.js"], {
  cwd: serverDir,
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});

let serverLog = "";
child.stdout.on("data", (chunk) => {
  serverLog += chunk.toString();
});
child.stderr.on("data", (chunk) => {
  serverLog += chunk.toString();
});

async function stopServer() {
  if (child.exitCode != null || child.signalCode != null) return;
  child.kill("SIGTERM");
  const exited = once(child, "exit");
  const timer = setTimeout(() => child.kill("SIGKILL"), 2000);
  await exited;
  clearTimeout(timer);
}

test.after(stopServer);

async function waitUntilReady() {
  const deadline = Date.now() + 8000;
  let lastError = "";
  while (Date.now() < deadline) {
    if (child.exitCode != null) {
      throw new Error(`el servidor salió con ${child.exitCode}: ${serverLog}`);
    }
    try {
      const res = await fetch(`${base}/health`);
      if (res.ok) return;
      lastError = `health ${res.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`el servidor no respondió: ${lastError}\n${serverLog}`);
}

async function createRoom() {
  const res = await fetch(`${base}/api/rooms`, { method: "POST" });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(typeof body.roomId, "string");
  return body.roomId;
}

async function postLocation(roomId, payload) {
  const res = await fetch(`${base}/api/rooms/${roomId}/location`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function getLocation(roomId) {
  const res = await fetch(`${base}/api/rooms/${roomId}/location`, { cache: "no-store" });
  assert.equal(res.status, 200);
  return res.json();
}

test("un POST viejo no pisa una ubicación más nueva ni le refresca la hora", async () => {
  await waitUntilReady();
  const roomId = await createRoom();

  const first = await postLocation(roomId, { lat: 10, lng: 20, epoch: 1, seq: 1 });
  assert.equal(first.status, 200);
  assert.equal(first.body.ok, true);

  const newer = await postLocation(roomId, { lat: 11, lng: 21, epoch: 1, seq: 2 });
  assert.equal(newer.status, 200);
  assert.equal(newer.body.ok, true);
  assert.equal(newer.body.stale, undefined);

  const beforeStale = await getLocation(roomId);
  assert.equal(beforeStale.lat, 11);
  assert.equal(beforeStale.lng, 21);
  assert.equal(beforeStale.paused, false);

  const stale = await postLocation(roomId, { lat: -10, lng: -20, epoch: 1, seq: 1 });
  assert.equal(stale.status, 200);
  assert.equal(stale.body.ok, true);
  assert.equal(stale.body.stale, true);

  const afterStale = await getLocation(roomId);
  assert.equal(afterStale.lat, 11);
  assert.equal(afterStale.lng, 21);
  assert.equal(afterStale.t, beforeStale.t);
  assert.equal(afterStale.paused, false);
});

test("el mismo seq repetido no vuelve a publicar", async () => {
  await waitUntilReady();
  const roomId = await createRoom();
  const saved = await postLocation(roomId, { lat: 5, lng: 6, epoch: 1, seq: 4 });
  assert.equal(saved.body.ok, true);
  const cached = await getLocation(roomId);

  const duplicate = await postLocation(roomId, { lat: 7, lng: 8, epoch: 1, seq: 4 });
  assert.equal(duplicate.body.stale, true);
  const after = await getLocation(roomId);
  assert.equal(after.lat, 5);
  assert.equal(after.t, cached.t);
});

test("una ubicación en pausa sigue ignorada y una generación nueva la levanta", async () => {
  await waitUntilReady();
  const roomId = await createRoom();
  const saved = await postLocation(roomId, { lat: 10, lng: 10, epoch: 1, seq: 1 });
  assert.equal(saved.body.ok, true);

  const pause = await fetch(`${base}/api/rooms/${roomId}/pause`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ epoch: 1 }),
  });
  assert.equal(pause.status, 200);
  const pauseBody = await pause.json();
  assert.equal(pauseBody.paused, true);

  const hidden = await postLocation(roomId, { lat: 12, lng: 12, epoch: 1, seq: 2 });
  assert.equal(hidden.body.paused, true);
  const whilePaused = await getLocation(roomId);
  assert.equal(whilePaused.lat, 10);
  assert.equal(whilePaused.paused, true);

  const resumed = await postLocation(roomId, { lat: 13, lng: 13, epoch: 2, seq: 3 });
  assert.equal(resumed.body.ok, true);
  assert.equal(resumed.body.paused, undefined);
  const after = await getLocation(roomId);
  assert.equal(after.lat, 13);
  assert.equal(after.lng, 13);
  assert.equal(after.paused, false);
});
