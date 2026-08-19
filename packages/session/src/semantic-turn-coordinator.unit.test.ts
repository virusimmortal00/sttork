import {
  canonicalizeCommand,
  type BootResult,
  type EngineCompatibility,
  type EnginePort,
  type EngineSnapshot,
  type ExecuteRequest,
  type ExecuteResult,
  type PublicEngineState,
  type RestoreResult,
} from "@zork-voice/contracts";
import { EventSequence } from "@zork-voice/events";
import { FakeGuideModel } from "@zork-voice/guide-core";
import { describe, expect, it } from "vitest";

import {
  SemanticTurnCapacityError,
  SemanticTurnConflictError,
  SemanticTurnCoordinator,
  type NarrationPort,
  type NarrationRequest,
} from "./semantic-turn-coordinator.js";

const compatibility: EngineCompatibility = {
  story: { id: "fixture", artifactSha256: "1".repeat(64) },
  runtime: { id: "fake", version: "1", artifactSha256: "2".repeat(64) },
  adapter: { id: "fake-adapter", version: "1" },
  snapshotSchemaVersion: 1,
};

class FakeEngine implements EnginePort {
  public revision = 0;
  public executeCalls: ExecuteRequest[] = [];
  public snapshotCalls = 0;
  public inspectFailure = false;
  public snapshotFailure = false;
  public uncertainOnce = false;
  public cancelBeforeSubmit = false;
  public inspectGate: Promise<void> | undefined;
  public onCommit: (() => void) | undefined;
  readonly #receipts = new Map<string, ExecuteResult>();

  public async boot(): Promise<BootResult> {
    return {
      revision: 0,
      output: "boot",
      turnComplete: true,
      boundary: "input-requested",
      compatibility,
    };
  }

  public async execute(input: ExecuteRequest): Promise<ExecuteResult> {
    this.executeCalls.push(input);
    if (this.cancelBeforeSubmit) {
      throw Object.assign(new Error("cancelled before worker submission"), {
        commitState: "not-submitted",
      });
    }
    const existing = this.#receipts.get(input.requestId);
    if (existing !== undefined) return existing;
    const result: ExecuteResult = {
      status: "committed",
      requestId: input.requestId,
      previousRevision: this.revision,
      revision: this.revision + 1,
      command: input.command,
      output: `exact:${input.command}`,
      turnComplete: true,
      boundary: "input-requested",
    };
    this.revision += 1;
    this.#receipts.set(input.requestId, result);
    this.onCommit?.();
    if (this.uncertainOnce) {
      this.uncertainOnce = false;
      throw new Error("synthetic response loss after commit");
    }
    return result;
  }

  public async snapshot(): Promise<EngineSnapshot> {
    this.snapshotCalls += 1;
    if (this.snapshotFailure) throw new Error("snapshot failed");
    return {
      bytes: new Uint8Array([this.revision]),
      sha256: "3".repeat(64),
      revision: this.revision,
      compatibility,
    };
  }

  public async restore(): Promise<RestoreResult> {
    throw new Error("not used");
  }

  public async inspectPublicState(): Promise<PublicEngineState> {
    await this.inspectGate;
    if (this.inspectFailure) throw new Error("inspect failed");
    return {
      revision: this.revision,
      lastOutput: this.revision === 0 ? "boot" : "committed",
      boundary: "input-requested",
    };
  }
}

class FakeNarrator implements NarrationPort {
  public readonly requests: NarrationRequest[] = [];
  public failure = false;

  public async prepare(input: NarrationRequest): Promise<void> {
    this.requests.push(input);
    if (this.failure) throw new Error("narration failed");
  }
}

function coordinator(
  engine: FakeEngine,
  narrator: FakeNarrator,
  guide = FakeGuideModel.returning({
    kind: "execute",
    command: "north",
    intentSummary: "Move north",
    confidence: 0.99,
  }),
  publish?: () => void,
  maxTurns?: number,
): SemanticTurnCoordinator {
  let eventId = 0;
  let requestId = 0;
  let narrationId = 0;
  return new SemanticTurnCoordinator({
    engine,
    narrator,
    guide,
    events: new EventSequence({
      sessionId: "session-1",
      now: () => "2026-08-18T18:00:00.000Z",
      nextId: () => `event-${++eventId}`,
    }),
    nextRequestId: () => `request-${++requestId}`,
    nextNarrationId: () => `narration-${++narrationId}`,
    ...(publish === undefined ? {} : { publish }),
    ...(maxTurns === undefined ? {} : { maxTurns }),
  });
}

const turn = {
  interactionId: "turn-1",
  transcript: "go north",
  transcriptConfidence: 0.99,
  observedObjects: ["token"],
} as const;

describe("SemanticTurnCoordinator", () => {
  it("orders one exact committed turn through checkpoint and narration", async () => {
    const engine = new FakeEngine();
    const narrator = new FakeNarrator();
    const result = await coordinator(engine, narrator).submitTurn(
      turn,
      new AbortController().signal,
    );

    expect(result.outcome).toBe("committed");
    expect(result.events.map((event) => event.type)).toEqual([
      "transcript.final",
      "guide.decision.proposed",
      "guide.decision.accepted",
      "engine.command.requested",
      "engine.command.committed",
      "engine.output",
      "save.checkpointed",
      "narration.requested",
      "narration.ready",
    ]);
    expect(result.events.map((event) => event.sequence)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
    expect(result.events.map((event) => event.causationId)).toEqual([
      undefined,
      "event-1",
      "event-2",
      "event-3",
      "event-4",
      "event-5",
      "event-6",
      "event-6",
      "event-8",
    ]);
    expect(engine.executeCalls).toEqual([
      {
        requestId: "request-1",
        expectedRevision: 0,
        command: canonicalizeCommand("north"),
      },
    ]);
    expect(narrator.requests).toHaveLength(1);
    expect(narrator.requests[0]).toMatchObject({
      role: "narrator",
      text: "exact:north",
      sourceEventId: "event-6",
    });
    expect(result.checkpoint?.revision).toBe(1);
  });

  it.each([
    {
      name: "clarification",
      guide: FakeGuideModel.returning({
        kind: "clarify",
        question: "Which direction?",
        ambiguity: "No direction was specified.",
      }),
      expected: "clarified",
      proseType: "guide.clarification",
    },
    {
      name: "deterministic explanation",
      guide: FakeGuideModel.returning({
        kind: "explain",
        response: "untrusted",
        basis: "command-help",
        sourceIds: ["grammar.look"],
      }),
      expected: "explained",
      proseType: "guide.explanation",
    },
    {
      name: "malformed provider output",
      guide: new FakeGuideModel(() => ({
        kind: "execute",
        command: "north",
        intentSummary: "Move",
        confidence: 0.99,
        extra: true,
      })),
      expected: "rejected",
      proseType: "guide.cannot_comply",
    },
    {
      name: "guide provider failure",
      guide: new FakeGuideModel(() => {
        throw new Error("provider offline");
      }),
      expected: "failed",
      proseType: "guide.cannot_comply",
    },
  ])("keeps $name non-mutating", async ({ guide, expected, proseType }) => {
    const engine = new FakeEngine();
    const narrator = new FakeNarrator();
    const result = await coordinator(engine, narrator, guide).submitTurn(
      {
        ...turn,
        transcript: expected === "explained" ? "what can I do?" : "help",
      },
      new AbortController().signal,
    );
    expect(result.outcome).toBe(expected);
    expect(result.events.map((event) => event.type)).toContain(proseType);
    expect(result.events.map((event) => event.type)).not.toContain(
      "engine.command.requested",
    );
    expect(narrator.requests).toHaveLength(1);
    expect(narrator.requests[0]?.role).toBe("guide");
    expect(engine.revision).toBe(0);
  });

  it("deduplicates concurrent and completed delivery and rejects conflicting reuse", async () => {
    const engine = new FakeEngine();
    const narrator = new FakeNarrator();
    const subject = coordinator(engine, narrator);
    const first = subject.submitTurn(turn, new AbortController().signal);
    const duplicate = subject.submitTurn(turn, new AbortController().signal);
    const [one, two] = await Promise.all([first, duplicate]);
    expect(two).toEqual(one);
    expect(engine.executeCalls).toHaveLength(1);
    await expect(
      subject.submitTurn(turn, new AbortController().signal),
    ).resolves.toEqual(one);
    expect(engine.executeCalls).toHaveLength(1);
    await expect(
      subject.submitTurn(
        { ...turn, transcript: "go south" },
        new AbortController().signal,
      ),
    ).rejects.toBeInstanceOf(SemanticTurnConflictError);
  });

  it("fails journal capacity before a second turn allocates work", async () => {
    const engine = new FakeEngine();
    const guide = FakeGuideModel.returning({
      kind: "execute",
      command: "north",
      intentSummary: "Move north",
      confidence: 0.99,
    });
    const subject = coordinator(
      engine,
      new FakeNarrator(),
      guide,
      undefined,
      1,
    );
    await subject.submitTurn(turn, new AbortController().signal);
    await expect(
      subject.submitTurn(
        { ...turn, interactionId: "turn-2" },
        new AbortController().signal,
      ),
    ).rejects.toBeInstanceOf(SemanticTurnCapacityError);
    expect(guide.calls).toBe(1);
    expect(engine.executeCalls).toHaveLength(1);
  });

  it("recovers an unknown commit only through the exact engine request", async () => {
    const engine = new FakeEngine();
    engine.uncertainOnce = true;
    const narrator = new FakeNarrator();
    const subject = coordinator(engine, narrator);
    const uncertain = await subject.submitTurn(
      turn,
      new AbortController().signal,
    );
    expect(uncertain.outcome).toBe("uncertain");
    expect(engine.revision).toBe(1);
    expect(uncertain.events.map((event) => event.type)).not.toContain(
      "engine.command.committed",
    );

    const recovered = await subject.submitTurn(
      turn,
      new AbortController().signal,
    );
    expect(recovered.outcome).toBe("committed");
    expect(engine.revision).toBe(1);
    expect(engine.executeCalls).toHaveLength(2);
    expect(engine.executeCalls[1]).toEqual(engine.executeCalls[0]);
    expect(
      recovered.events.filter(
        (event) => event.type === "engine.command.committed",
      ),
    ).toHaveLength(1);
    expect(recovered.events.map((event) => event.type)).toContain(
      "system.recovered",
    );
  });

  it("cancels during inspection before submitting any engine command", async () => {
    const engine = new FakeEngine();
    let release = (): void => undefined;
    engine.inspectGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const narrator = new FakeNarrator();
    const subject = coordinator(engine, narrator);
    const controller = new AbortController();
    const pending = subject.submitTurn(turn, controller.signal);
    await Promise.resolve();
    await Promise.resolve();
    controller.abort(new Error("player cancelled"));
    release();
    const result = await pending;
    expect(result.outcome).toBe("cancelled");
    expect(engine.executeCalls).toHaveLength(0);
    expect(result.events.map((event) => event.type)).not.toContain(
      "engine.command.requested",
    );
  });

  it("does not quarantine an engine rejection known to be pre-submission", async () => {
    const engine = new FakeEngine();
    engine.cancelBeforeSubmit = true;
    const subject = coordinator(engine, new FakeNarrator());
    const result = await subject.submitTurn(turn, new AbortController().signal);
    expect(result.outcome).toBe("cancelled");
    expect(result.events.at(-1)).toMatchObject({
      type: "system.error",
      payload: { engineCommitState: "not-submitted" },
    });
    engine.cancelBeforeSubmit = false;
    await expect(
      subject.submitTurn(turn, new AbortController().signal),
    ).resolves.toEqual(result);
    expect(engine.executeCalls).toHaveLength(1);
  });

  it("ignores a stale guide response after cancellation", async () => {
    let resolveGuide: (value: unknown) => void = () => undefined;
    let markStarted = (): void => undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const guide = new FakeGuideModel(
      () =>
        new Promise((resolve) => {
          resolveGuide = resolve;
          markStarted();
        }),
    );
    const engine = new FakeEngine();
    const narrator = new FakeNarrator();
    const subject = coordinator(engine, narrator, guide);
    const controller = new AbortController();
    const pending = subject.submitTurn(turn, controller.signal);
    await started;
    controller.abort(new Error("player cancelled"));
    const cancelled = await pending;
    expect(cancelled.outcome).toBe("cancelled");
    const eventCount = cancelled.events.length;

    resolveGuide({
      kind: "execute",
      command: "north",
      intentSummary: "Late move",
      confidence: 0.99,
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(engine.executeCalls).toHaveLength(0);
    expect(cancelled.events).toHaveLength(eventCount);
  });

  it("reports a confirmed commit without narration when cancellation arrives after submit", async () => {
    const engine = new FakeEngine();
    const narrator = new FakeNarrator();
    const controller = new AbortController();
    engine.onCommit = () => controller.abort(new Error("stop after commit"));
    const result = await coordinator(engine, narrator).submitTurn(
      turn,
      controller.signal,
    );
    expect(result.outcome).toBe("committed");
    expect(engine.revision).toBe(1);
    expect(result.events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "engine.command.committed",
        "engine.output",
        "save.checkpointed",
        "narration.cancelled",
      ]),
    );
    expect(narrator.requests).toHaveLength(0);
  });

  it("reports engine inspection failure before submission", async () => {
    const engine = new FakeEngine();
    engine.inspectFailure = true;
    const result = await coordinator(engine, new FakeNarrator()).submitTurn(
      turn,
      new AbortController().signal,
    );
    expect(result.outcome).toBe("failed");
    expect(engine.executeCalls).toHaveLength(0);
    expect(result.events.at(-1)).toMatchObject({
      type: "system.error",
      payload: {
        stage: "engine",
        code: "engine-inspection-failed",
        engineCommitState: "not-submitted",
      },
    });
  });

  it("does not let a failing projection subscriber alter a committed turn", async () => {
    const engine = new FakeEngine();
    const result = await coordinator(
      engine,
      new FakeNarrator(),
      undefined,
      () => {
        throw new Error("projection failed");
      },
    ).submitTurn(turn, new AbortController().signal);
    expect(result.outcome).toBe("committed");
    expect(engine.revision).toBe(1);
    expect(result.events).toHaveLength(9);
  });

  it("reports checkpoint and narration failures without losing a confirmed commit", async () => {
    const engine = new FakeEngine();
    engine.snapshotFailure = true;
    const narrator = new FakeNarrator();
    narrator.failure = true;
    const result = await coordinator(engine, narrator).submitTurn(
      turn,
      new AbortController().signal,
    );
    expect(result.outcome).toBe("committed");
    expect(engine.revision).toBe(1);
    expect(result.events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "engine.command.committed",
        "engine.output",
        "save.failed",
        "narration.failed",
        "system.error",
      ]),
    );
    const errors = result.events.filter(
      (event) => event.type === "system.error",
    );
    expect(errors).toHaveLength(2);
    expect(
      errors.every((event) => event.payload.engineCommitState === "confirmed"),
    ).toBe(true);
  });

  it("records a transcriber failure without consulting guide or engine", () => {
    const engine = new FakeEngine();
    const narrator = new FakeNarrator();
    const guide = FakeGuideModel.returning({
      kind: "execute",
      command: "north",
      intentSummary: "Move north",
      confidence: 0.99,
    });
    const result = coordinator(
      engine,
      narrator,
      guide,
    ).recordTranscriptionFailure({
      interactionId: "failed-transcript",
      code: "no-speech",
    });
    expect(result.outcome).toBe("failed");
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      type: "system.error",
      payload: { stage: "transcription", engineCommitState: "not-submitted" },
    });
    expect(guide.calls).toBe(0);
    expect(engine.revision).toBe(0);
  });

  it("records microphone denial without consulting guide or engine", () => {
    const engine = new FakeEngine();
    const guide = FakeGuideModel.returning({
      kind: "execute",
      command: "north",
      intentSummary: "Move north",
      confidence: 0.99,
    });
    const result = coordinator(
      engine,
      new FakeNarrator(),
      guide,
    ).recordAudioFailure({
      interactionId: "microphone-denial",
      code: "microphone-unavailable",
    });

    expect(result.outcome).toBe("failed");
    expect(result.events).toEqual([
      expect.objectContaining({
        type: "system.error",
        payload: expect.objectContaining({
          stage: "audio",
          code: "microphone-unavailable",
          engineCommitState: "not-submitted",
        }),
      }),
    ]);
    expect(guide.calls).toBe(0);
    expect(engine.revision).toBe(0);
  });

  it("rejects oversized semantic input before allocating an event or calling guide", async () => {
    const engine = new FakeEngine();
    const guide = FakeGuideModel.returning({
      kind: "execute",
      command: "north",
      intentSummary: "Move north",
      confidence: 0.99,
    });
    const subject = coordinator(engine, new FakeNarrator(), guide);
    await expect(
      subject.submitTurn(
        { ...turn, transcript: "x".repeat(2_001) },
        new AbortController().signal,
      ),
    ).rejects.toThrow("transcript must be a bounded");
    expect(guide.calls).toBe(0);
    expect(engine.executeCalls).toHaveLength(0);
  });
});
