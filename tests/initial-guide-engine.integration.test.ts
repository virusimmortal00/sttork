import { readFile } from "node:fs/promises";

import {
  FakeGuideModel,
  decideInitialGuideTurn,
} from "../packages/guide-core/src/index.js";
import {
  DorkCandidateSession,
  type DorkCandidateTurn,
} from "../spikes/dork-worker/dork-candidate-session.js";
import { describe, expect, it } from "vitest";

const storyUrl = new URL(
  "../fixtures/stories/minimal/artifact/minimal.z3",
  import.meta.url,
);

async function createSession(): Promise<DorkCandidateSession> {
  const session = new DorkCandidateSession(
    new Uint8Array(await readFile(storyUrl)),
    { seed: 71 },
  );
  await session.boot();
  return session;
}

async function applyIfExecutable(
  session: DorkCandidateSession,
  model: FakeGuideModel,
  playerUtterance: string,
): Promise<DorkCandidateTurn | undefined> {
  const result = await decideInitialGuideTurn(
    model,
    {
      interactionId: "integration-turn",
      playerUtterance,
      transcriptConfidence: 0.99,
      observedObjects: ["token"],
    },
    new AbortController().signal,
  );
  return result.kind === "execute"
    ? await session.execute(result.command)
    : undefined;
}

describe("initial guide to authoritative engine boundary", () => {
  it("executes representative direct and paraphrased intents once", async () => {
    const direct = await createSession();
    const north = await applyIfExecutable(
      direct,
      FakeGuideModel.returning({
        kind: "execute",
        command: "north",
        intentSummary: "Move north",
        confidence: 0.99,
      }),
      "go north",
    );
    expect(north?.output).toBe(
      "North Room\nA quiet room with an exit south.\n\n> ",
    );
    expect(direct.inspectPublicState().revision).toBe(1);

    const paraphrased = await createSession();
    const take = await applyIfExecutable(
      paraphrased,
      FakeGuideModel.returning({
        kind: "execute",
        command: "get token",
        intentSummary: "Pick up the observed token",
        confidence: 0.99,
      }),
      "pick up the token",
    );
    expect(take?.output).toContain("Taken");
    expect(paraphrased.inspectPublicState().revision).toBe(1);

    const observing = await createSession();
    const look = await applyIfExecutable(
      observing,
      FakeGuideModel.returning({
        kind: "execute",
        affordanceId: "grammar.look",
        slots: [],
        intentSummary: "Observe the current surroundings",
        confidence: 0.99,
      }),
      "Tell me where I am.",
    );
    expect(look?.output).toBe(
      "South Room\nA plain room with an exit north.\nA brass token rests on the floor.\n\n> ",
    );
    expect(observing.inspectPublicState().revision).toBe(1);
  });

  it.each([
    {
      name: "clarification",
      utterance: "open it",
      model: FakeGuideModel.returning({
        kind: "clarify",
        question: "What should I open?",
        ambiguity: "No unique referent.",
      }),
    },
    {
      name: "parser explanation",
      utterance: "what can I do?",
      model: FakeGuideModel.returning({
        kind: "explain",
        response: "untrusted prose",
        basis: "command-help",
        sourceIds: ["grammar.look"],
      }),
    },
    {
      name: "rejected hidden command",
      utterance: "take the sword",
      model: FakeGuideModel.returning({
        kind: "execute",
        command: "take sword",
        intentSummary: "Take an unobserved object",
        confidence: 0.99,
      }),
    },
    {
      name: "wrong command for a front-facing observation",
      utterance: "What do I see in front of me?",
      model: FakeGuideModel.returning({
        kind: "execute",
        command: "north",
        intentSummary: "Move north",
        confidence: 0.99,
      }),
    },
    {
      name: "provider failure",
      utterance: "go north",
      model: new FakeGuideModel(() => {
        throw new Error("provider unavailable");
      }),
    },
  ])("keeps the engine unchanged for $name", async ({ utterance, model }) => {
    const session = await createSession();
    const before = session.inspectPublicState();
    expect(await applyIfExecutable(session, model, utterance)).toBeUndefined();
    expect(session.inspectPublicState()).toEqual(before);
  });
});
