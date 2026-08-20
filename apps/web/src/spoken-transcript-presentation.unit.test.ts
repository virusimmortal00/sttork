import { describe, expect, it } from "vitest";

import {
  spokenNarrationLines,
  spokenWordIntervalMs,
} from "./spoken-transcript-presentation.js";

describe("spoken transcript presentation", () => {
  it("preserves narration line boundaries while normalizing visual spacing", () => {
    expect(
      spokenNarrationLines(
        "ZORK I: The Great Underground Empire\n\n West   of House \nYou are here.",
      ),
    ).toEqual([
      "ZORK I: The Great Underground Empire",
      "West of House",
      "You are here.",
    ]);
  });

  it("reveals faster and slower voices at a bounded rate-aware cadence", () => {
    expect(spokenWordIntervalMs(0.75)).toBeGreaterThan(spokenWordIntervalMs(1));
    expect(spokenWordIntervalMs(1)).toBeGreaterThan(spokenWordIntervalMs(1.25));
    expect(spokenWordIntervalMs(Number.NaN)).toBe(spokenWordIntervalMs(1));
  });
});
