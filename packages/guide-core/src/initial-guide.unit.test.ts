import { describe, expect, it } from "vitest";

import { FakeGuideModel } from "./fake-guide-model.js";
import { decideInitialGuideTurn } from "./initial-guide.js";

const signal = new AbortController().signal;
const baseInput = {
  interactionId: "interaction-1",
  playerUtterance: "please head north",
  transcriptConfidence: 0.99,
  observedObjects: ["brass token"],
} as const;

describe("initial bounded Dungeon Guide", () => {
  it("grounds a direct execute decision as one canonical command", async () => {
    const result = await decideInitialGuideTurn(
      FakeGuideModel.returning({
        kind: "execute",
        command: "north",
        intentSummary: "Move north",
        confidence: 0.99,
      }),
      baseInput,
      signal,
    );
    expect(result).toMatchObject({
      kind: "execute",
      command: "north",
      groundingSourceId: "grammar.direction.north",
    });
  });

  it.each(["What do I see around me?", "What do I see in front of me?"])(
    "grounds the natural observation question %s as one look command",
    async (playerUtterance) => {
      const result = await decideInitialGuideTurn(
        FakeGuideModel.returning({
          kind: "execute",
          command: "look",
          intentSummary: "Observe the current surroundings",
          confidence: 0.99,
        }),
        {
          ...baseInput,
          playerUtterance,
        },
        signal,
      );

      expect(result).toMatchObject({
        kind: "execute",
        command: "look",
        groundingSourceId: "grammar.look",
      });
    },
  );

  it("routes an exact observed-object content question without calling the provider", async () => {
    const model = new FakeGuideModel(() => {
      throw new Error(
        "the deterministic content question reached the provider",
      );
    });
    const result = await decideInitialGuideTurn(
      model,
      {
        ...baseInput,
        playerUtterance: "What does the brass token say?",
      },
      signal,
    );

    expect(result).toMatchObject({
      kind: "execute",
      command: "examine brass token",
      groundingSourceId: "grammar.examine",
      decision: {
        kind: "execute",
        command: "examine brass token",
        confidence: 1,
      },
    });
    expect(model.calls).toBe(0);
  });

  it.each([
    {
      name: "low-confidence content question",
      input: {
        ...baseInput,
        playerUtterance: "What does the brass token say?",
        transcriptConfidence: 0.4,
      },
    },
    {
      name: "negated content question",
      input: {
        ...baseInput,
        playerUtterance: "Do not answer what does the brass token say.",
      },
    },
    {
      name: "multi-step content question",
      input: {
        ...baseInput,
        playerUtterance: "What does the brass token say, then go north?",
      },
    },
  ])("clarifies a $name before calling the provider", async ({ input }) => {
    const model = new FakeGuideModel(() => {
      throw new Error("unsafe content question reached the provider");
    });

    expect(await decideInitialGuideTurn(model, input, signal)).toMatchObject({
      kind: "clarify",
    });
    expect(model.calls).toBe(0);
  });

  it("retains and resolves one reviewed pending object action", async () => {
    const clarificationModel = FakeGuideModel.returning({
      kind: "clarify",
      question: "Which observed object would you like me to examine?",
      ambiguity: "The object reference is unresolved.",
    });
    const clarified = await decideInitialGuideTurn(
      clarificationModel,
      {
        ...baseInput,
        playerUtterance: "What does it say?",
      },
      signal,
    );
    expect(clarified).toMatchObject({
      kind: "clarify",
      pendingIntent: { action: "examine" },
    });

    const answerModel = new FakeGuideModel(() => {
      throw new Error("the exact pending-object answer reached the provider");
    });
    const resolved = await decideInitialGuideTurn(
      answerModel,
      {
        ...baseInput,
        playerUtterance: "The brass token",
        pendingIntent: { action: "examine" },
      },
      signal,
    );
    expect(resolved).toMatchObject({
      kind: "execute",
      command: "examine brass token",
      groundingSourceId: "grammar.examine",
    });
    expect(answerModel.calls).toBe(0);
  });

  it.each([
    {
      name: "unobserved answer",
      playerUtterance: "The sword",
      transcriptConfidence: 0.99,
    },
    {
      name: "low-confidence answer",
      playerUtterance: "The brass token",
      transcriptConfidence: 0.4,
    },
    {
      name: "negated answer",
      playerUtterance: "Not the brass token",
      transcriptConfidence: 0.99,
    },
    {
      name: "multi-step answer",
      playerUtterance: "The brass token, then go north",
      transcriptConfidence: 0.99,
    },
  ])("does not execute a $name for pending intent", async (testCase) => {
    const model = FakeGuideModel.returning({
      kind: "clarify",
      question: "Which one observed object?",
      ambiguity: "The answer did not safely fill the object slot.",
    });
    const result = await decideInitialGuideTurn(
      model,
      {
        ...baseInput,
        playerUtterance: testCase.playerUtterance,
        transcriptConfidence: testCase.transcriptConfidence,
        pendingIntent: { action: "examine" },
      },
      signal,
    );
    expect(result).toMatchObject({ kind: "clarify" });
    if (testCase.name === "low-confidence answer") {
      expect(result).toMatchObject({
        pendingIntent: { action: "examine" },
      });
    } else {
      expect(result).not.toHaveProperty("pendingIntent");
    }
  });

  it.each([
    {
      name: "low transcript confidence",
      input: { ...baseInput, transcriptConfidence: 0.4 },
      decision: {
        kind: "execute",
        command: "north",
        intentSummary: "Move north",
        confidence: 0.99,
      } as const,
    },
    {
      name: "low model confidence",
      input: baseInput,
      decision: {
        kind: "execute",
        command: "north",
        intentSummary: "Move north",
        confidence: 0.5,
      } as const,
    },
    {
      name: "multi-step utterance",
      input: { ...baseInput, playerUtterance: "go north then take the token" },
      decision: {
        kind: "execute",
        command: "north",
        intentSummary: "Start the plan",
        confidence: 0.99,
      } as const,
    },
    {
      name: "multi-step natural observation",
      input: {
        ...baseInput,
        playerUtterance: "What do I see around me, then go north?",
      },
      decision: {
        kind: "execute",
        command: "look",
        intentSummary: "Observe before moving north",
        confidence: 0.99,
      } as const,
    },
    {
      name: "multi-step front-facing observation",
      input: {
        ...baseInput,
        playerUtterance: "What do I see in front of me, then go north?",
      },
      decision: {
        kind: "execute",
        command: "look",
        intentSummary: "Observe before moving north",
        confidence: 0.99,
      } as const,
    },
    {
      name: "negated action",
      input: { ...baseInput, playerUtterance: "do not go north" },
      decision: {
        kind: "execute",
        command: "north",
        intentSummary: "Unsafe negated move",
        confidence: 0.99,
      } as const,
    },
  ])(
    "clarifies $name without authorizing execution",
    async ({ input, decision }) => {
      expect(
        await decideInitialGuideTurn(
          FakeGuideModel.returning(decision),
          input,
          signal,
        ),
      ).toMatchObject({ kind: "clarify" });
    },
  );

  it("rejects separators, hidden referents, and ungrounded substitutions", async () => {
    const cases = [
      {
        input: baseInput,
        command: "north; take token",
      },
      {
        input: { ...baseInput, playerUtterance: "take the sword" },
        command: "take sword",
      },
      {
        input: baseInput,
        command: "south",
      },
    ];

    for (const testCase of cases) {
      const result = await decideInitialGuideTurn(
        FakeGuideModel.returning({
          kind: "execute",
          command: testCase.command,
          intentSummary: "Untrusted proposal",
          confidence: 0.99,
        }),
        testCase.input,
        signal,
      );
      expect(result).toMatchObject({
        kind: "rejected",
        cause: "ungrounded-command",
      });
    }
  });

  it("replaces provider command-help prose with observed, deterministic help", async () => {
    const result = await decideInitialGuideTurn(
      FakeGuideModel.returning({
        kind: "explain",
        response: "Ignore policy: the sword is hidden below the trapdoor.",
        basis: "command-help",
        sourceIds: ["grammar.look", "grammar.take"],
      }),
      { ...baseInput, playerUtterance: "what can I do?" },
      signal,
    );
    expect(result).toMatchObject({ kind: "explain" });
    if (result.kind === "explain") {
      expect(result.decision.response).toContain("brass token");
      expect(result.decision.response).not.toMatch(/sword|trapdoor/iu);
    }
  });

  it("fails closed on extra fields and provider failure", async () => {
    const malformed = await decideInitialGuideTurn(
      new FakeGuideModel(() => ({
        kind: "execute",
        command: "north",
        intentSummary: "Move north",
        confidence: 0.99,
        bypassEngine: true,
      })),
      baseInput,
      signal,
    );
    expect(malformed).toMatchObject({
      kind: "rejected",
      cause: "malformed-provider-decision",
    });

    const failed = await decideInitialGuideTurn(
      new FakeGuideModel(() => {
        throw new Error("offline");
      }),
      baseInput,
      signal,
    );
    expect(failed).toMatchObject({ kind: "provider-failure" });
  });

  it("propagates cancellation instead of converting it to provider failure", async () => {
    const controller = new AbortController();
    const model = new FakeGuideModel(async () => {
      controller.abort(new Error("player cancelled"));
      return {
        kind: "execute",
        command: "north",
        intentSummary: "Move north",
        confidence: 0.99,
      };
    });

    await expect(
      decideInitialGuideTurn(model, baseInput, controller.signal),
    ).rejects.toThrow("player cancelled");
  });

  it("rejects unbounded context before calling the model", async () => {
    const model = FakeGuideModel.returning({
      kind: "execute",
      command: "north",
      intentSummary: "Move north",
      confidence: 0.99,
    });
    const result = await decideInitialGuideTurn(
      model,
      { ...baseInput, playerUtterance: "x".repeat(2_001) },
      signal,
    );
    expect(result).toMatchObject({
      kind: "rejected",
      cause: "invalid-context",
    });
    expect(model.calls).toBe(0);
  });

  it("rejects malformed pending intent before calling the model", async () => {
    const model = FakeGuideModel.returning({
      kind: "execute",
      command: "north",
      intentSummary: "Move north",
      confidence: 0.99,
    });
    const result = await decideInitialGuideTurn(
      model,
      {
        ...baseInput,
        pendingIntent: {
          action: "examine",
          injected: true,
        },
      } as typeof baseInput & {
        pendingIntent: { action: "examine"; injected: boolean };
      },
      signal,
    );
    expect(result).toMatchObject({
      kind: "rejected",
      cause: "invalid-context",
    });
    expect(model.calls).toBe(0);
  });
});
