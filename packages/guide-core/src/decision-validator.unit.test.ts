import { describe, expect, it } from "vitest";

import {
  GuideDecisionValidationError,
  validateGuideDecision,
} from "./decision-validator.js";

describe("validateGuideDecision", () => {
  it("accepts each canonical branch with exact fields", () => {
    expect(
      validateGuideDecision({
        kind: "execute",
        command: "north",
        intentSummary: "Move north",
        confidence: 0.98,
      }),
    ).toMatchObject({ kind: "execute", command: "north" });
    expect(
      validateGuideDecision({
        kind: "clarify",
        question: "Which one?",
        choices: ["mailbox", "door"],
        ambiguity: "Two objects were mentioned.",
      }),
    ).toMatchObject({ kind: "clarify" });
    expect(
      validateGuideDecision({
        kind: "explain",
        response: "You can look.",
        basis: "command-help",
        sourceIds: ["grammar.look"],
      }),
    ).toMatchObject({ kind: "explain" });
    expect(
      validateGuideDecision({
        kind: "request_hint",
        puzzleContext: "the mailbox",
        requestedLevel: 1,
      }),
    ).toMatchObject({ kind: "request_hint" });
    expect(
      validateGuideDecision({
        kind: "session_control",
        control: "repeat-last",
      }),
    ).toMatchObject({ kind: "session_control" });
    expect(
      validateGuideDecision({
        kind: "cannot_comply",
        response: "I have not observed that.",
        reason: "not-observed",
      }),
    ).toMatchObject({ kind: "cannot_comply" });
  });

  it.each([
    null,
    { kind: "execute", command: "north", intentSummary: "north" },
    {
      kind: "execute",
      command: "north",
      intentSummary: "north",
      confidence: 0.9,
      injected: true,
    },
    { kind: "session_control", control: "delete-save" },
    { kind: "request_hint", puzzleContext: "mailbox", requestedLevel: 5 },
    { kind: "invent-world", room: "secret" },
  ])("rejects malformed or expanded provider output %#", (decision) => {
    expect(() => validateGuideDecision(decision)).toThrow(
      GuideDecisionValidationError,
    );
  });
});
