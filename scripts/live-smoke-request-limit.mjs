export const DEFAULT_LIVE_SMOKE_MAX_REQUESTS = 120;
export const MAX_LIVE_SMOKE_MAX_REQUESTS = 1_000_000;

export function parseLiveSmokeMaxRequests(value) {
  if (value === undefined || value === "") {
    return DEFAULT_LIVE_SMOKE_MAX_REQUESTS;
  }
  const parsed = Number(value);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < 1 ||
    parsed > MAX_LIVE_SMOKE_MAX_REQUESTS
  ) {
    throw new RangeError(
      `STTORK_LIVE_MAX_REQUESTS must be an integer from 1 through ${MAX_LIVE_SMOKE_MAX_REQUESTS}.`,
    );
  }
  return parsed;
}
