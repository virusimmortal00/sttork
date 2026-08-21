import { describe, expect, it } from "vitest";

import {
  DEFAULT_LIVE_SMOKE_MAX_REQUESTS,
  MAX_LIVE_SMOKE_MAX_REQUESTS,
  parseLiveSmokeMaxRequests,
} from "./live-smoke-request-limit.mjs";

describe("live smoke request limit", () => {
  it("keeps the conservative default when no override is configured", () => {
    expect(parseLiveSmokeMaxRequests(undefined)).toBe(
      DEFAULT_LIVE_SMOKE_MAX_REQUESTS,
    );
    expect(parseLiveSmokeMaxRequests("")).toBe(DEFAULT_LIVE_SMOKE_MAX_REQUESTS);
  });

  it("accepts an explicit high but finite developer allowance", () => {
    expect(parseLiveSmokeMaxRequests("10000")).toBe(10_000);
    expect(parseLiveSmokeMaxRequests(String(MAX_LIVE_SMOKE_MAX_REQUESTS))).toBe(
      MAX_LIVE_SMOKE_MAX_REQUESTS,
    );
  });

  it.each(["0", "-1", "1.5", "unlimited", "1000001"])(
    "rejects invalid override %s",
    (value) => {
      expect(() => parseLiveSmokeMaxRequests(value)).toThrow(RangeError);
    },
  );
});
