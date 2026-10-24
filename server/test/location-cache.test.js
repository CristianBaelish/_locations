import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { io } from "socket.io-client";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const port = 33111;
const base = `http://127.0.0.1:${port}`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitHealth() {
  for (let i = 0; i < 50; i += 1) {
    try {
      const res = await fetch(`${base}/health`);
      if (res.ok) return;
    } catch {
      /* the process is still binding the port */
    }
    await sleep(100);
  }
  throw new Error("el servidor no arrancó");
}

describe("cached room location", () => {
  /** @type {import("node:child_process").ChildProcess} */
  let child;

  it("removes the cached fix when sharing stops and rejects non-finite coordinates", async () => {
    child = spawn(process.execPath, ["server/src/index.js"], {
      cwd: root,
      env: { ...process.env, PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let log = "";
    child.stdout?.on("data", (chunk) => {
      log += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      log += chunk;
    });

    try {
      await waitHealth();
      const created = await fetch(`${base}/api/rooms`, { method: "POST" });
      assert.equal(created.ok, true);
      const { roomId } = await created.json();
      assert.equal(typeof roomId, "string");

      const sharer = io(base, { transports: ["polling"], reconnection: false });
      try {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("el sharer no conectó")), 5_000);
          sharer.on("connect", () => {
            clearTimeout(timer);
            resolve();
          });
        });

        const published = await new Promise((resolve) => {
          sharer.timeout(3_000).emit(
            "location",
            { roomId, lat: -34.6, lng: -58.38, heading: 12, courseDeg: 20 },
            (err, body) => resolve(err ? null : body)
          );
        });
        assert.equal(published?.ok, true);

        const cached = await fetch(`${base}/api/rooms/${roomId}/location`);
        assert.equal(cached.status, 200);
        const body = await cached.json();
        assert.equal(body.lat, -34.6);
        assert.equal(typeof body.t, "number");

        const rejected = await new Promise((resolve) => {
          sharer.timeout(3_000).emit(
            "location",
            { roomId, lat: Number.POSITIVE_INFINITY, lng: -58.38 },
            (err, ack) => resolve(err ? null : ack)
          );
        });
        assert.equal(rejected?.ok, false);
        const stillCached = await fetch(`${base}/api/rooms/${roomId}/location`);
        assert.equal((await stillCached.json()).lat, -34.6);

        sharer.emit("stop-sharing", { roomId });
        let afterStop = 0;
        for (let i = 0; i < 20; i += 1) {
          const res = await fetch(`${base}/api/rooms/${roomId}/location`);
          afterStop = res.status;
          if (afterStop === 204) break;
          await sleep(50);
        }
        assert.equal(afterStop, 204);
      } finally {
        sharer.close();
      }
    } catch (error) {
      if (log.trim()) console.error(log.slice(-2000));
      throw error;
    } finally {
      child.kill();
      await Promise.race([once(child, "exit"), sleep(1_000)]);
    }
  });
});
