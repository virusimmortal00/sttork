import type { BootResult } from "@sttork/contracts";
import { describe, expect, it } from "vitest";

import { selectOpeningNarrationText } from "./opening-narration.js";

const exactOpening =
  "ZORK I: The Great Underground Empire\nInfocom interactive fiction - a fantasy story\nCopyright (c) 1981, 1982, 1983, 1984, 1985, 1986 Infocom, Inc. All rights reserved.\nZORK is a registered trademark of Infocom, Inc.\nRelease 119 / Serial number 880429\n\nWest of House\nYou are standing in an open field west of a white house, with a boarded front door.\nThere is a small mailbox here.\n\n>";
const reviewedSpokenOpening =
  "ZORK I: The Great Underground Empire\n\nWest of House\nYou are standing in an open field west of a white house, with a boarded front door.\nThere is a small mailbox here.";

function boot(
  overrides: Partial<Pick<BootResult, "output">> & {
    readonly storyId?: string;
    readonly artifactSha256?: string;
  } = {},
): BootResult {
  return {
    revision: 0,
    output: overrides.output ?? exactOpening,
    turnComplete: true,
    boundary: "input-requested",
    compatibility: {
      story: {
        id: overrides.storyId ?? "zork1-release-119",
        artifactSha256:
          overrides.artifactSha256 ??
          "37084966477dff679282de42974b2077156b1bd68fad92a65d4ea94d8eb64d79",
      },
      runtime: {
        id: "fixture-runtime",
        version: "1",
        artifactSha256: "2".repeat(64),
      },
      adapter: { id: "fixture-adapter", version: "1" },
      snapshotSchemaVersion: 1,
    },
  };
}

describe("selectOpeningNarrationText", () => {
  it("selects the reviewed exact-line excerpt for authenticated Release 119", () => {
    expect(selectOpeningNarrationText(boot())).toBe(reviewedSpokenOpening);
  });

  it.each([
    { storyId: "another-story" },
    { artifactSha256: "f".repeat(64) },
    { output: `${exactOpening} ` },
    { output: exactOpening.replaceAll("\n", "\r\n") },
    { output: exactOpening.replace("ZORK I", "Zork I") },
  ])("fails closed to exact output for a nonmatching profile", (override) => {
    const input = boot(override);
    expect(selectOpeningNarrationText(input)).toBe(input.output);
  });
});
