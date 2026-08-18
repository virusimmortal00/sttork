import { describe, expect, it } from "vitest";

import { FakeClock } from "./fake-clock.js";

describe("FakeClock", () => {
  it("advances without wall-clock sleeps", () => {
    const clock = new FakeClock("2026-08-17T12:00:00.000Z");
    clock.advance(250);
    expect(clock.now()).toBe("2026-08-17T12:00:00.250Z");
  });

  it("does not move backwards", () => {
    const clock = new FakeClock();
    expect(() => clock.advance(-1)).toThrow(RangeError);
  });
});
