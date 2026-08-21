import { describe, expect, it } from "vitest";

import { deterministicOpeningPrefetchRequests } from "./deterministic-narration-prefetch.js";

describe("deterministic opening prefetch", () => {
  it("warms exactly the first two ordered opening segments", () => {
    expect(
      deterministicOpeningPrefetchRequests(
        "Title\nFirst sentence. Second sentence. Third sentence.",
      ).map(({ role, text }) => ({ role, text })),
    ).toEqual([
      { role: "narrator", text: "Title" },
      { role: "narrator", text: "First sentence." },
    ]);
  });
});
