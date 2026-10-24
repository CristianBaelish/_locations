import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyLiveFix,
  applyLocationMiss,
  applySharingEnded,
  initialViewerLocationState,
} from "./viewerLocation.js";

const fix = (t, lat = -34.6) => ({ lat, lng: -58.38, heading: 90, courseDeg: 80, t });

describe("viewer location ordering", () => {
  it("ignores an older fix and a duplicate of the current one", () => {
    let state = applyLiveFix(initialViewerLocationState(), fix(1_000), 5_000);
    assert.equal(state.pos?.lat, -34.6);
    assert.equal(state.ended, false);

    const older = applyLiveFix(state, fix(900, -34.7), 6_000);
    assert.equal(older.pos?.lat, -34.6);
    assert.equal(older.seq, state.seq);

    const duplicate = applyLiveFix(state, fix(1_000, -34.7), 6_000);
    assert.equal(duplicate, state);
  });

  it("does not let the last fix undo an explicit stop", () => {
    const live = applyLiveFix(initialViewerLocationState(), fix(1_000), 5_000);
    const ended = applySharingEnded(live);
    assert.equal(ended.ended, true);
    assert.equal(ended.pos, null);

    const resurrected = applyLiveFix(ended, fix(1_000), 9_000);
    assert.equal(resurrected, ended);

    const resumed = applyLiveFix(ended, fix(2_000, -34.61), 9_000);
    assert.equal(resumed.ended, false);
    assert.equal(resumed.pos?.lat, -34.61);
  });

  it("treats an empty cache after a fix as the end of the share", () => {
    const waiting = initialViewerLocationState();
    assert.equal(applyLocationMiss(waiting, 0), waiting);

    const live = applyLiveFix(waiting, fix(1_000), 5_000);
    const seqAtStart = live.seq;
    const ended = applyLocationMiss(live, seqAtStart);
    assert.equal(ended.ended, true);
    assert.equal(ended.pos, null);

    const newer = applyLiveFix(live, fix(1_500), 6_000);
    assert.equal(applyLocationMiss(newer, seqAtStart), newer);
  });

  it("drops non-finite coordinates instead of storing them", () => {
    const live = applyLiveFix(initialViewerLocationState(), fix(1_000), 5_000);
    for (const lat of [Number.NaN, Number.POSITIVE_INFINITY, null]) {
      const next = applyLiveFix(live, { lat, lng: 10, t: 2_000 }, 6_000);
      assert.equal(next, live);
    }
    assert.equal(applyLiveFix(live, null, 6_000), live);
  });
});
