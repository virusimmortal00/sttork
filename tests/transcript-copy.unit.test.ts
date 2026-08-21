import { describe, expect, it, vi } from "vitest";

import {
  copyTranscriptToClipboard,
  transcriptClipboardText,
} from "../apps/web/src/transcript-copy.js";

describe("transcript copy", () => {
  it("copies attributed transcript lines in their original order", async () => {
    const writeText = vi
      .fn<(text: string) => Promise<void>>()
      .mockResolvedValue();
    const items = [
      { role: "player", text: "examine the mailbox" },
      { role: "system", text: "examine mailbox" },
      { role: "game", text: "The small mailbox is closed." },
    ];

    expect(transcriptClipboardText(items)).toBe(
      "PLAYER: examine the mailbox\n\nSYSTEM: examine mailbox\n\nGAME: The small mailbox is closed.",
    );
    await expect(copyTranscriptToClipboard(items, { writeText })).resolves.toBe(
      true,
    );
    expect(writeText).toHaveBeenCalledWith(transcriptClipboardText(items));
  });

  it("does not write an empty transcript", async () => {
    const writeText = vi
      .fn<(text: string) => Promise<void>>()
      .mockResolvedValue();
    await expect(copyTranscriptToClipboard([], { writeText })).resolves.toBe(
      false,
    );
    expect(writeText).not.toHaveBeenCalled();
  });
});
