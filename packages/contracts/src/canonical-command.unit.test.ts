import { describe, expect, it } from "vitest";

import type { CanonicalCommandError } from "./canonical-command.js";
import {
  MAX_CANONICAL_COMMAND_LENGTH,
  canonicalizeCommand,
} from "./canonical-command.js";

describe("canonicalizeCommand", () => {
  it("normalizes only surrounding and repeated horizontal whitespace", () => {
    expect(canonicalizeCommand("  open   mailbox  ")).toBe("open mailbox");
  });

  it.each(["north\nsouth", "north;south", "north. south", "north then south"])(
    "rejects a command batch: %s",
    (command) => {
      expect(() => canonicalizeCommand(command)).toThrow(
        expect.objectContaining<Partial<CanonicalCommandError>>({
          code: expect.stringMatching(/control-character|command-separator/u),
        }),
      );
    },
  );

  it("rejects empty and oversized commands", () => {
    expect(() => canonicalizeCommand("  ")).toThrow(
      expect.objectContaining({ code: "empty" }),
    );
    expect(() =>
      canonicalizeCommand("x".repeat(MAX_CANONICAL_COMMAND_LENGTH + 1)),
    ).toThrow(expect.objectContaining({ code: "too-long" }));
  });
});
