import { describe, expect, it } from "vitest";

import { GuideDecisionValidationError } from "./decision-validator.js";
import { validateInitialGuideModelDecision } from "./initial-model-decision-validator.js";

describe("validateInitialGuideModelDecision", () => {
  it("accepts provider-only affordance metadata on an execute proposal", () => {
    expect(
      validateInitialGuideModelDecision({
        kind: "execute",
        command: "look",
        affordanceId: "grammar.look",
        intentSummary: "Observe the current location",
        confidence: 0.98,
      }),
    ).toEqual({
      kind: "execute",
      command: "look",
      affordanceId: "grammar.look",
      intentSummary: "Observe the current location",
      confidence: 0.98,
    });
  });

  it("retains legacy execute proposals without provider affordance metadata", () => {
    expect(
      validateInitialGuideModelDecision({
        kind: "execute",
        command: "north",
        intentSummary: "Move north",
        confidence: 0.98,
      }),
    ).toMatchObject({ kind: "execute", command: "north" });
  });

  it.each(["", "x".repeat(161), "grammar.look\nunsafe", undefined])(
    "rejects the invalid affordance identifier %#",
    (affordanceId) => {
      expect(() =>
        validateInitialGuideModelDecision({
          kind: "execute",
          command: "look",
          affordanceId,
          intentSummary: "Observe the current location",
          confidence: 0.98,
        }),
      ).toThrow(GuideDecisionValidationError);
    },
  );

  it("rejects affordance metadata on non-execute branches", () => {
    expect(() =>
      validateInitialGuideModelDecision({
        kind: "clarify",
        question: "Which way?",
        ambiguity: "No direction was given.",
        affordanceId: "grammar.look",
      }),
    ).toThrow(GuideDecisionValidationError);
  });
});
