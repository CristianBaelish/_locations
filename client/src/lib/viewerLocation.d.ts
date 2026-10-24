export type LiveFix = {
  lat: number;
  lng: number;
  heading?: number | null;
  courseDeg?: number | null;
  t?: number;
};

export type ViewerLocationState = {
  pos: { lat: number; lng: number } | null;
  heading: number | null;
  courseDeg: number | null;
  waiting: boolean;
  ended: boolean;
  receivedAt: number | null;
  lastServerT: number;
  seq: number;
};

export function initialViewerLocationState(): ViewerLocationState;

export function applyLiveFix(
  state: ViewerLocationState,
  fix: LiveFix | null | undefined,
  now: number
): ViewerLocationState;

export function applySharingEnded(state: ViewerLocationState): ViewerLocationState;

export function applyLocationMiss(
  state: ViewerLocationState,
  seqAtStart: number
): ViewerLocationState;
