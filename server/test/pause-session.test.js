import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  locationBlockedByPause,
  pauseSuperseded,
  readSession,
  shouldClearPause,
} from "../src/pauseSession.js";

const SESSION_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const SESSION_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

test("la misma sesión no publica mientras sigue en pausa", () => {
  const state = {
    pausedEpoch: 4,
    liveEpoch: 4,
    pausedSession: SESSION_A,
    epoch: 4,
    session: SESSION_A,
  };
  assert.equal(locationBlockedByPause(state), true);
  assert.equal(shouldClearPause(state), false);
});

test("un epoch mayor de la misma sesión levanta la pausa", () => {
  const state = {
    pausedEpoch: 4,
    liveEpoch: 4,
    pausedSession: SESSION_A,
    epoch: 5,
    session: SESSION_A,
  };
  assert.equal(locationBlockedByPause(state), false);
  assert.equal(shouldClearPause(state), true);
});

test("recargar empieza de nuevo en epoch 1 y no queda trabado", () => {
  const state = {
    pausedEpoch: 4,
    liveEpoch: 4,
    pausedSession: SESSION_A,
    epoch: 1,
    session: SESSION_B,
  };
  assert.equal(locationBlockedByPause(state), false);
  assert.equal(shouldClearPause(state), true);
});

test("sin id de sesión se mantiene la regla del epoch", () => {
  assert.equal(
    locationBlockedByPause({
      pausedEpoch: 4,
      liveEpoch: 4,
      pausedSession: null,
      epoch: 1,
      session: null,
    }),
    true
  );
  assert.equal(readSession("corto"), null);
  assert.equal(readSession(SESSION_A), SESSION_A);
});

test("una pausa del documento anterior no tapa al que ya publicó", () => {
  assert.equal(
    pauseSuperseded({
      epoch: 4,
      liveEpoch: 4,
      session: SESSION_A,
      activeSession: SESSION_B,
    }),
    true
  );
  assert.equal(
    pauseSuperseded({
      epoch: 3,
      liveEpoch: 4,
      session: SESSION_A,
      activeSession: SESSION_A,
    }),
    true
  );
  assert.equal(
    pauseSuperseded({
      epoch: 4,
      liveEpoch: 4,
      session: SESSION_A,
      activeSession: SESSION_A,
    }),
    false
  );
});

test("por HTTP, recargar publica y la pausa vieja no vuelve a ganar", async () => {
  const port = 22000 + Math.floor(Math.random() * 20000);
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const child = spawn(process.execPath, ["server/src/index.js"], {
    cwd: root,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (chunk) => {
    log += chunk;
  });
  child.stderr.on("data", (chunk) => {
    log += chunk;
  });
  const base = `http://127.0.0.1:${port}`;

  const stop = async () => {
    if (child.exitCode != null || child.signalCode != null) return;
    child.kill("SIGTERM");
    const timer = setTimeout(() => child.kill("SIGKILL"), 2000);
    await once(child, "exit").catch(() => {});
    clearTimeout(timer);
  };

  try {
    const started = Date.now();
    for (;;) {
      try {
        const health = await fetch(`${base}/health`);
        if (health.ok) break;
      } catch {
        /* todavía no escucha */
      }
      if (Date.now() - started > 8000) {
        throw new Error(`el servidor no arrancó\n${log}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    const created = await fetch(`${base}/api/rooms`, { method: "POST" });
    assert.equal(created.status, 200);
    const { roomId } = await created.json();
    const post = (pathName, body) =>
      fetch(`${base}${pathName}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

    const plainRoom = await fetch(`${base}/api/rooms`, { method: "POST" });
    const plain = await plainRoom.json();
    const legacy = await post(`/api/rooms/${plain.roomId}/location`, {
      lat: -34.6,
      lng: -58.38,
    });
    assert.equal(legacy.status, 200);
    assert.equal((await legacy.json()).ok, true);

    const first = await post(`/api/rooms/${roomId}/location`, {
      lat: -34.6,
      lng: -58.38,
      epoch: 1,
      session: SESSION_A,
    });
    assert.equal(first.status, 200);
    assert.equal((await first.json()).ok, true);

    const paused = await post(`/api/rooms/${roomId}/pause`, { epoch: 1, session: SESSION_A });
    assert.equal((await paused.json()).paused, true);

    const hidden = await post(`/api/rooms/${roomId}/location`, {
      lat: -34.61,
      lng: -58.39,
      epoch: 1,
      session: SESSION_A,
    });
    assert.deepEqual(await hidden.json(), { ok: true, paused: true });
    const whilePaused = await (await fetch(`${base}/api/rooms/${roomId}/location`)).json();
    assert.equal(whilePaused.lat, -34.6);
    assert.equal(whilePaused.paused, true);

    const reloaded = await post(`/api/rooms/${roomId}/location`, {
      lat: -34.62,
      lng: -58.4,
      epoch: 1,
      session: SESSION_B,
    });
    const reloadedBody = await reloaded.json();
    assert.equal(reloadedBody.ok, true);
    assert.equal(reloadedBody.paused, undefined);
    const afterReload = await (await fetch(`${base}/api/rooms/${roomId}/location`)).json();
    assert.equal(afterReload.lat, -34.62);
    assert.equal(afterReload.paused, false);

    const latePause = await post(`/api/rooms/${roomId}/pause`, { epoch: 1, session: SESSION_A });
    assert.deepEqual(await latePause.json(), { ok: true, paused: false });
    const stillLive = await (await fetch(`${base}/api/rooms/${roomId}/location`)).json();
    assert.equal(stillLive.lat, -34.62);
    assert.equal(stillLive.paused, false);
  } finally {
    await stop();
  }
});
