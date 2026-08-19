import { describe, expect, it } from "vitest";

import { GuideDecisionValidationError } from "./decision-validator.js";
import { validateInitialGuideModelDecision } from "./initial-model-decision-validator.js";

describe("validateInitialGuideModelDecision", () => {
  it("accepts a provider-only semantic execute frame without a command", () => {
    expect(
      validateInitialGuideModelDecision({
        kind: "execute",
        affordanceId: "grammar.examine",
        slots: [{ slotId: "object", valueId: "mailbox" }],
        intentSummary: "Observe the mailbox more closely",
        confidence: 0.98,
      }),
    ).toEqual({
      kind: "execute",
      affordanceId: "grammar.examine",
      slots: [{ slotId: "object", valueId: "mailbox" }],
      intentSummary: "Observe the mailbox more closely",
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
          affordanceId,
          slots: [],
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

  it.each([
    {
      name: "provider command",
      extra: { command: "examine mailbox" },
    },
    {
      name: "extra decision field",
      extra: { bypassEngine: true },
    },
  ])("rejects a semantic execute frame with $name", ({ extra }) => {
    expect(() =>
      validateInitialGuideModelDecision({
        kind: "execute",
        affordanceId: "grammar.examine",
        slots: [{ slotId: "object", valueId: "mailbox" }],
        intentSummary: "Observe the mailbox",
        confidence: 0.98,
        ...extra,
      }),
    ).toThrow(GuideDecisionValidationError);
  });

  it.each([
    {
      name: "missing slots",
      slots: undefined,
    },
    {
      name: "duplicate slot IDs",
      slots: [
        { slotId: "object", valueId: "mailbox" },
        { slotId: "object", valueId: "door" },
      ],
    },
    {
      name: "extra slot field",
      slots: [{ slotId: "object", valueId: "mailbox", command: "open" }],
    },
    {
      name: "unbounded slot value",
      slots: [{ slotId: "object", valueId: "x".repeat(161) }],
    },
  ])("rejects $name", ({ slots }) => {
    const input = {
      kind: "execute",
      affordanceId: "grammar.examine",
      slots,
      intentSummary: "Observe the mailbox",
      confidence: 0.98,
    };
    if (slots === undefined) delete (input as { slots?: unknown }).slots;
    expect(() => validateInitialGuideModelDecision(input)).toThrow(
      GuideDecisionValidationError,
    );
  });
});
