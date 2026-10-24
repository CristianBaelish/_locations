/**
 * Viewer location ordering.
 *
 * Server timestamps are compared only with other server timestamps. Mixing in
 * the viewer's clock lets a slightly slow phone resurrect a stopped share, and
 * a fast phone drop the next fix. An empty cache (HTTP 204) after a fix means
 * the server no longer has a location — stop, expiry, or restart — so the pin
 * must come down. A later fix with a newer server time brings it back.
 */

/**
 * @typedef {{ lat: number, lng: number, heading?: number | null, courseDeg?: number | null, t?: number }} LiveFix
 * @typedef {{
 *   pos: { lat: number, lng: number } | null,
 *   heading: number | null,
 *   courseDeg: number | null,
 *   waiting: boolean,
 *   ended: boolean,
 *   receivedAt: number | null,
 *   lastServerT: number,
 *   seq: number,
 * }} ViewerLocationState
 */

/** @returns {ViewerLocationState} */
export function initialViewerLocationState() {
  return {
    pos: null,
    heading: null,
    courseDeg: null,
    waiting: true,
    ended: false,
    receivedAt: null,
    lastServerT: 0,
    seq: 0,
  };
}

/**
 * @param {unknown} value
 * @returns {value is number}
 */
function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * @param {ViewerLocationState} state
 * @param {LiveFix | null | undefined} fix
 * @param {number} now
 * @returns {ViewerLocationState}
 */
export function applyLiveFix(state, fix, now) {
  if (!fix || typeof fix !== "object") return state;
  if (!finiteNumber(fix.lat) || !finiteNumber(fix.lng)) return state;

  const stamp = finiteNumber(fix.t) ? fix.t : 0;
  if (state.ended && !(stamp > state.lastServerT)) return state;
  if (stamp > 0 && stamp <= state.lastServerT) return state;

  const heading = Object.prototype.hasOwnProperty.call(fix, "heading")
    ? finiteNumber(fix.heading)
      ? fix.heading
      : null
    : state.heading;
  const courseDeg = Object.prototype.hasOwnProperty.call(fix, "courseDeg")
    ? finiteNumber(fix.courseDeg)
      ? fix.courseDeg
      : null
    : state.courseDeg;

  return {
    pos: { lat: fix.lat, lng: fix.lng },
    heading,
    courseDeg,
    waiting: false,
    ended: false,
    receivedAt: stamp > 0 ? stamp : now,
    lastServerT: stamp > 0 ? stamp : state.lastServerT,
    seq: state.seq + 1,
  };
}

/**
 * @param {ViewerLocationState} state
 * @returns {ViewerLocationState}
 */
export function applySharingEnded(state) {
  if (state.ended && state.pos == null && state.receivedAt == null && !state.waiting) {
    return state;
  }
  return {
    ...state,
    pos: null,
    heading: null,
    courseDeg: null,
    waiting: false,
    ended: true,
    receivedAt: null,
    seq: state.seq + 1,
  };
}

/**
 * HTTP cache miss for a request that started when `seqAtStart` was current.
 * Ignores the miss if a newer fix arrived while the request was in flight.
 *
 * @param {ViewerLocationState} state
 * @param {number} seqAtStart
 * @returns {ViewerLocationState}
 */
export function applyLocationMiss(state, seqAtStart) {
  if (!(seqAtStart > 0 && state.seq === seqAtStart && !state.ended)) return state;
  return applySharingEnded(state);
}
