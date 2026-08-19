import type { BootResult } from "../../contracts/src/index.js";

const ZORK_I_RELEASE_119_STORY_ID = "zork1-release-119";
const ZORK_I_RELEASE_119_ARTIFACT_SHA256 =
  "37084966477dff679282de42974b2077156b1bd68fad92a65d4ea94d8eb64d79";
const ZORK_I_RELEASE_119_OPENING =
  "ZORK I: The Great Underground Empire\nInfocom interactive fiction - a fantasy story\nCopyright (c) 1981, 1982, 1983, 1984, 1985, 1986 Infocom, Inc. All rights reserved.\nZORK is a registered trademark of Infocom, Inc.\nRelease 119 / Serial number 880429\n\nWest of House\nYou are standing in an open field west of a white house, with a boarded front door.\nThere is a small mailbox here.\n\n>";
const ZORK_I_RELEASE_119_SPOKEN_OPENING =
  "ZORK I: The Great Underground Empire\n\nWest of House\nYou are standing in an open field west of a white house, with a boarded front door.\nThere is a small mailbox here.";

/**
 * Selects a reviewed spoken rendering without changing canonical engine output.
 * Unknown stories and even near-matching openings fail closed to exact output.
 */
export function selectOpeningNarrationText(boot: BootResult): string {
  return boot.compatibility.story.id === ZORK_I_RELEASE_119_STORY_ID &&
    boot.compatibility.story.artifactSha256 ===
      ZORK_I_RELEASE_119_ARTIFACT_SHA256 &&
    boot.output === ZORK_I_RELEASE_119_OPENING
    ? ZORK_I_RELEASE_119_SPOKEN_OPENING
    : boot.output;
}
