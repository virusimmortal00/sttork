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

  it("grounds a natural observation question as one look command", async () => {
    const result = await decideInitialGuideTurn(
      FakeGuideModel.returning({
        kind: "execute",
        command: "look",
        intentSummary: "Observe the current surroundings",
        confidence: 0.99,
      }),
      {
        ...baseInput,
        playerUtterance: "What do I see around me?",
      },
      signal,
    );

    expect(result).toMatchObject({
      kind: "execute",
      command: "look",
      groundingSourceId: "grammar.look",
    });
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
});
