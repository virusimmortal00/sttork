import type { SemanticTurnResult } from "@zork-voice/session";
import type { NarrationRequest } from "@zork-voice/session";
import { describe, expect, it } from "vitest";

import {
  playbackFailureCode,
  playbackFailureCodes,
  type PlaybackFailureCode,
  type PlaybackLifecycle,
} from "./contracts.js";
import {
  ScriptedCapturePort,
  ScriptedNarrationPort,
  ScriptedPlaybackPort,
  ScriptedTranscriber,
  VirtualAudioClock,
  type ScriptedClip,
} from "./scripted-audio.js";
import {
  VoiceAudioController,
  VoiceAudioStateError,
  type VoiceAudioState,
  type VoiceTurnPort,
} from "./voice-audio-controller.js";

class StubTurns implements VoiceTurnPort {
  public readonly lifecycle: string[] = [];
  public readonly playbackEndings: Array<{
    readonly outcome: "complete" | "interrupted" | "failed";
    readonly failureCode?: PlaybackFailureCode;
  }> = [];
  public readonly submitted: string[] = [];
  public readonly transcriptConfidences: Array<number | undefined> = [];
  public submitGate: Promise<void> | undefined;
  public onSubmit: (() => void) | undefined;
  public constructor(
    private readonly narration: ScriptedNarrationPort,
    private readonly narrationCount = 1,
  ) {}

  public async submitTurn(input: {
    readonly interactionId: string;
    readonly transcript: string;
    readonly transcriptConfidence?: number;
  }): Promise<SemanticTurnResult> {
    this.submitted.push(input.transcript);
    this.transcriptConfidences.push(input.transcriptConfidence);
    this.onSubmit?.();
    await this.submitGate;
    for (let index = 0; index < this.narrationCount; index += 1) {
      await this.narration.prepare(
        {
          narrationId: `narration-${input.interactionId}-${index}`,
          role: "narrator",
          text: `exact:${input.transcript}:${index}`,
          sourceEventId: `output-${input.interactionId}-${index}`,
          correlationId: input.interactionId,
        },
        new AbortController().signal,
      );
    }
    return {
      interactionId: input.interactionId,
      outcome: "committed",
      events: [],
    };
  }

  public recordTranscriptionFailure(input: {
    readonly interactionId: string;
    readonly code: string;
  }): SemanticTurnResult {
    this.lifecycle.push(`transcription:${input.code}`);
    return {
      interactionId: input.interactionId,
      outcome: "failed",
      events: [],
    };
  }

  public recordAudioFailure(input: {
    readonly code: string;
  }): SemanticTurnResult {
    this.lifecycle.push(`audio:${input.code}`);
    return {
      interactionId: "audio-failure",
      outcome: "failed",
      events: [],
    };
  }

  public recordCaptureStarted(): void {
    this.lifecycle.push("capture-started");
  }
  public recordCaptureEnded(input: { readonly outcome: string }): void {
    this.lifecycle.push(`capture-ended:${input.outcome}`);
  }
  public recordPlaybackStarted(input: { readonly role: string }): void {
    this.lifecycle.push(`playback-started:${input.role}`);
  }
  public recordPlaybackEnded(input: {
    readonly outcome: "complete" | "interrupted" | "failed";
    readonly failureCode?: PlaybackFailureCode;
  }): void {
    this.lifecycle.push(`playback-ended:${input.outcome}`);
    this.playbackEndings.push({
      outcome: input.outcome,
      ...(input.failureCode === undefined
        ? {}
        : { failureCode: input.failureCode }),
    });
  }
  public recordPaused(): void {
    this.lifecycle.push("paused");
  }
  public recordResumed(): void {
    this.lifecycle.push("resumed");
  }
}

function fixture(clips: readonly ScriptedClip[], narrationCount = 1) {
  const narration = new ScriptedNarrationPort();
  const turns = new StubTurns(narration, narrationCount);
  const clock = new VirtualAudioClock();
  const playback = new ScriptedPlaybackPort(clock);
  const states: VoiceAudioState[] = [];
  let interaction = 0;
  let capture = 0;
  const controller = new VoiceAudioController({
    turns,
    capture: new ScriptedCapturePort(clips),
    transcriber: new ScriptedTranscriber(clips),
    narration,
    playback,
    nextInteractionId: () => `interaction-${++interaction}`,
    nextCaptureId: () => `capture-${++capture}`,
    observedObjects: () => ["token"],
    onState: (state) => states.push(state),
  });
  return { controller, turns, playback, states };
}

describe("VoiceAudioController", () => {
  it("synchronously delegates playback activation when the port supports it", () => {
    const narration = new ScriptedNarrationPort();
    const turns = new StubTurns(narration);
    let activations = 0;
    const controller = new VoiceAudioController({
      turns,
      capture: new ScriptedCapturePort([]),
      transcriber: new ScriptedTranscriber([]),
      narration,
      playback: {
        activateFromUserGesture: () => {
          activations += 1;
        },
        play: async () => undefined,
        stop: async () => undefined,
      },
      nextInteractionId: () => "unused-interaction",
      nextCaptureId: () => "unused-capture",
      observedObjects: () => [],
    });

    controller.activatePlaybackFromUserGesture();

    expect(activations).toBe(1);
    expect(controller.state).toBe("ready");
    expect(() =>
      fixture([]).controller.activatePlaybackFromUserGesture(),
    ).not.toThrow();
  });

  it.each(playbackFailureCodes)(
    "accepts the player-safe playback failure code %s",
    (code) => {
      expect(playbackFailureCode({ code })).toBe(code);
    },
  );

  it("rejects arbitrary or throwing playback failure codes", () => {
    expect(playbackFailureCode({ code: "sk-sensitive-value" })).toBeUndefined();
    expect(
      playbackFailureCode({
        get code(): never {
          throw new Error("unsafe getter");
        },
      }),
    ).toBeUndefined();
  });

  it.each([
    {
      failure: { code: "budget-exhausted" },
      expectedCode: "budget-exhausted" as const,
    },
    {
      failure: { code: "vendor-secret-code" },
      expectedCode: "playback-failed" as const,
    },
  ])(
    "records a safe playback failure for $expectedCode",
    async ({ failure, expectedCode }) => {
      const narration = new ScriptedNarrationPort();
      const turns = new StubTurns(narration);
      const controller = new VoiceAudioController({
        turns,
        capture: new ScriptedCapturePort([]),
        transcriber: new ScriptedTranscriber([]),
        narration,
        playback: {
          play: async () => {
            throw failure;
          },
          stop: async () => undefined,
        },
        nextInteractionId: () => "playback-failure",
        nextCaptureId: () => "unused-capture",
        observedObjects: () => [],
      });

      await controller.submitText("look");

      expect(controller.state).toBe("recoverable-error");
      expect(turns.playbackEndings).toEqual([
        { outcome: "failed", failureCode: expectedCode },
      ]);
      expect(turns.lifecycle).not.toContain("playback-started:narrator");
    },
  );

  it("plays a prepared story opening once and retains it for repeat", async () => {
    const subject = fixture([]);
    expect(subject.controller.hasRepeatablePlayback).toBe(false);
    await expect(
      subject.controller.playPrepared("story-opening"),
    ).resolves.toBe("not-prepared");
    expect(subject.playback.records).toHaveLength(0);
    expect(subject.controller.state).toBe("ready");
    expect(subject.states).toEqual([]);

    const narration = new ScriptedNarrationPort();
    const turns = new StubTurns(narration);
    const clock = new VirtualAudioClock();
    const playback = new ScriptedPlaybackPort(clock);
    const states: VoiceAudioState[] = [];
    const controller = new VoiceAudioController({
      turns,
      capture: new ScriptedCapturePort([]),
      transcriber: new ScriptedTranscriber([]),
      narration,
      playback,
      nextInteractionId: () => "unused-interaction",
      nextCaptureId: () => "unused-capture",
      observedObjects: () => [],
      onState: (state) => states.push(state),
    });
    await narration.prepare(
      {
        narrationId: "opening-narration",
        role: "narrator",
        text: "The exact opening",
        sourceEventId: "opening-output",
        correlationId: "story-opening",
      },
      new AbortController().signal,
    );

    await expect(controller.playPrepared("story-opening")).resolves.toBe(
      "complete",
    );
    await expect(controller.playPrepared("story-opening")).resolves.toBe(
      "not-prepared",
    );
    expect(playback.records).toEqual([
      expect.objectContaining({
        narrationId: "opening-narration",
        role: "narrator",
        text: "The exact opening",
      }),
    ]);
    expect(turns.lifecycle).toEqual([
      "playback-started:narrator",
      "playback-ended:complete",
    ]);
    expect(states).toEqual(["processing", "narrator-speaking", "ready"]);
    expect(controller.hasRepeatablePlayback).toBe(true);

    await controller.repeat();
    expect(playback.records).toHaveLength(2);
  });

  it("returns to ready when a text turn prepares no narration", async () => {
    const subject = fixture([], 0);

    const result = await subject.controller.submitText("look");

    expect(result.outcome).toBe("committed");
    expect(subject.turns.submitted).toEqual(["look"]);
    expect(subject.playback.records).toHaveLength(0);
    expect(subject.controller.state).toBe("ready");
    expect(subject.states).toEqual(["processing", "ready"]);
  });

  it("returns to ready when a captured turn prepares no narration", async () => {
    const subject = fixture(
      [
        {
          clipId: "silent-narration",
          durationMs: 500,
          transcript: { text: "look", confidence: 0.99 },
        },
      ],
      0,
    );

    await subject.controller.startCapture();
    const result = await subject.controller.finishCapture();

    expect(result.outcome).toBe("committed");
    expect(subject.turns.submitted).toEqual(["look"]);
    expect(subject.playback.records).toHaveLength(0);
    expect(subject.controller.state).toBe("ready");
    expect(subject.states).toEqual([
      "requesting-microphone",
      "listening",
      "processing",
      "ready",
    ]);
  });

  it("preserves prepared narration when playback is requested while listening", async () => {
    const narration = new ScriptedNarrationPort();
    const turns = new StubTurns(narration);
    const playback = new ScriptedPlaybackPort(new VirtualAudioClock());
    const clips: ScriptedClip[] = [
      {
        clipId: "queued-while-listening",
        durationMs: 500,
        transcript: { text: "look", confidence: 0.99 },
      },
    ];
    const controller = new VoiceAudioController({
      turns,
      capture: new ScriptedCapturePort(clips),
      transcriber: new ScriptedTranscriber(clips),
      narration,
      playback,
      nextInteractionId: () => "capture-turn",
      nextCaptureId: () => "capture-id",
      observedObjects: () => [],
    });
    await narration.prepare(
      {
        narrationId: "queued-narration",
        role: "narrator",
        text: "Retained narration",
        sourceEventId: "queued-output",
        correlationId: "queued-interaction",
      },
      new AbortController().signal,
    );

    await controller.startCapture();
    await expect(
      controller.playPrepared("queued-interaction"),
    ).rejects.toBeInstanceOf(VoiceAudioStateError);
    await controller.stop();
    await expect(controller.playPrepared("queued-interaction")).resolves.toBe(
      "complete",
    );
    expect(playback.records).toEqual([
      expect.objectContaining({ text: "Retained narration" }),
    ]);
  });

  it("preserves prepared narration while paused", async () => {
    const narration = new ScriptedNarrationPort();
    const turns = new StubTurns(narration);
    const playback = new ScriptedPlaybackPort(new VirtualAudioClock());
    const controller = new VoiceAudioController({
      turns,
      capture: new ScriptedCapturePort([]),
      transcriber: new ScriptedTranscriber([]),
      narration,
      playback,
      nextInteractionId: () => "unused-interaction",
      nextCaptureId: () => "unused-capture",
      observedObjects: () => [],
    });
    await narration.prepare(
      {
        narrationId: "paused-narration",
        role: "narrator",
        text: "Retained while paused",
        sourceEventId: "paused-output",
        correlationId: "paused-interaction",
      },
      new AbortController().signal,
    );

    await controller.pause();
    await expect(
      controller.playPrepared("paused-interaction"),
    ).rejects.toBeInstanceOf(VoiceAudioStateError);
    await controller.resume();
    await expect(controller.playPrepared("paused-interaction")).resolves.toBe(
      "complete",
    );
    expect(playback.records).toEqual([
      expect.objectContaining({ text: "Retained while paused" }),
    ]);
  });

  it("preserves prepared narration while a semantic turn is active", async () => {
    const narration = new ScriptedNarrationPort();
    const turns = new StubTurns(narration);
    let releaseSubmit = (): void => undefined;
    turns.submitGate = new Promise<void>((resolve) => {
      releaseSubmit = resolve;
    });
    let markSubmitted = (): void => undefined;
    const submitted = new Promise<void>((resolve) => {
      markSubmitted = resolve;
    });
    turns.onSubmit = markSubmitted;
    const playback = new ScriptedPlaybackPort(new VirtualAudioClock());
    const controller = new VoiceAudioController({
      turns,
      capture: new ScriptedCapturePort([]),
      transcriber: new ScriptedTranscriber([]),
      narration,
      playback,
      nextInteractionId: () => "active-turn",
      nextCaptureId: () => "unused-capture",
      observedObjects: () => [],
    });
    await narration.prepare(
      {
        narrationId: "external-narration",
        role: "narrator",
        text: "Retained during turn",
        sourceEventId: "external-output",
        correlationId: "external-interaction",
      },
      new AbortController().signal,
    );

    const activeTurn = controller.submitText("look");
    await submitted;
    await expect(
      controller.playPrepared("external-interaction"),
    ).rejects.toBeInstanceOf(VoiceAudioStateError);
    releaseSubmit();
    await activeTurn;
    await expect(controller.playPrepared("external-interaction")).resolves.toBe(
      "complete",
    );
    expect(playback.records.at(-1)).toMatchObject({
      text: "Retained during turn",
    });
  });

  it("drives push-to-talk through transcript, exact playback, and repeat", async () => {
    const subject = fixture([
      {
        clipId: "north",
        durationMs: 640,
        transcript: { text: "go north", confidence: 0.99 },
      },
    ]);
    await subject.controller.startCapture();
    expect(subject.controller.state).toBe("listening");
    const result = await subject.controller.finishCapture();
    expect(result.outcome).toBe("committed");
    expect(subject.controller.state).toBe("ready");
    expect(subject.turns.submitted).toEqual(["go north"]);
    expect(subject.playback.records).toEqual([
      expect.objectContaining({ role: "narrator", text: "exact:go north:0" }),
    ]);
    expect(subject.turns.lifecycle).toEqual([
      "capture-started",
      "capture-ended:submitted",
      "playback-started:narrator",
      "playback-ended:complete",
    ]);
    await subject.controller.repeat();
    expect(subject.playback.records).toHaveLength(2);
    expect(subject.states).toEqual(
      expect.arrayContaining([
        "listening",
        "processing",
        "narrator-speaking",
        "ready",
      ]),
    );
  });

  it("stays processing until playback reaches the audible start boundary", async () => {
    const narration = new ScriptedNarrationPort();
    const turns = new StubTurns(narration);
    const states: VoiceAudioState[] = [];
    let announceStart: (() => void) | undefined;
    let playbackReady!: () => void;
    const ready = new Promise<void>((resolve) => {
      playbackReady = resolve;
    });
    let finishPlayback!: () => void;
    const finished = new Promise<void>((resolve) => {
      finishPlayback = resolve;
    });
    const controller = new VoiceAudioController({
      turns,
      capture: new ScriptedCapturePort([]),
      transcriber: new ScriptedTranscriber([]),
      narration,
      playback: {
        play: async (_request, _signal, lifecycle) => {
          announceStart = lifecycle.onStarted;
          playbackReady();
          await finished;
        },
        stop: async () => undefined,
      },
      nextInteractionId: () => "delayed-audible-start",
      nextCaptureId: () => "unused-capture",
      observedObjects: () => [],
      onState: (state) => states.push(state),
    });

    const submitting = controller.submitText("look");
    await ready;

    expect(controller.state).toBe("processing");
    expect(turns.lifecycle).not.toContain("playback-started:narrator");

    announceStart?.();
    expect(controller.state).toBe("narrator-speaking");
    expect(turns.lifecycle).toContain("playback-started:narrator");

    finishPlayback();
    await submitting;
    expect(controller.state).toBe("ready");
    expect(states).toEqual(["processing", "narrator-speaking", "ready"]);
  });

  it("turns silence into a recoverable non-mutating result", async () => {
    const subject = fixture([{ clipId: "silence", durationMs: 500 }]);
    await subject.controller.startCapture();
    const result = await subject.controller.finishCapture();
    expect(result.outcome).toBe("failed");
    expect(subject.turns.submitted).toHaveLength(0);
    expect(subject.turns.lifecycle).toContain("transcription:no-speech");
    expect(subject.playback.records).toHaveLength(0);
    expect(subject.controller.state).toBe("recoverable-error");
  });

  it.each([
    [{ code: "budget-exhausted" }, "budget-exhausted"],
    [{ code: "sk-sensitive-value" }, "transcription-failed"],
  ] as const)(
    "records only allowlisted live transcription failures: %s",
    async (failure, expectedCode) => {
      const narration = new ScriptedNarrationPort();
      const turns = new StubTurns(narration);
      const controller = new VoiceAudioController({
        turns,
        capture: new ScriptedCapturePort([
          { clipId: "failed-live-transcript", durationMs: 300 },
        ]),
        transcriber: {
          transcribe: async () => {
            throw failure;
          },
        },
        narration,
        playback: new ScriptedPlaybackPort(new VirtualAudioClock()),
        nextInteractionId: () => "live-transcription-failure",
        nextCaptureId: () => "live-capture-failure",
        observedObjects: () => [],
      });

      await controller.startCapture();
      const result = await controller.finishCapture();

      expect(result.outcome).toBe("failed");
      expect(turns.submitted).toHaveLength(0);
      expect(turns.lifecycle).toContain(`transcription:${expectedCode}`);
      expect(controller.state).toBe("recoverable-error");
    },
  );

  it("does not invent transcript confidence when a provider omits it", async () => {
    const subject = fixture([
      {
        clipId: "provider-without-confidence",
        durationMs: 400,
        transcript: { text: "go north" },
      },
    ]);

    await subject.controller.startCapture();
    await subject.controller.finishCapture();

    expect(subject.turns.transcriptConfidences).toEqual([undefined]);
  });

  it("cancels active capture on pause and resumes without submitting", async () => {
    const subject = fixture([
      {
        clipId: "unused",
        durationMs: 300,
        transcript: { text: "go north", confidence: 0.99 },
      },
    ]);
    await subject.controller.startCapture();
    await subject.controller.pause();
    expect(subject.controller.state).toBe("paused");
    expect(subject.turns.submitted).toHaveLength(0);
    expect(subject.turns.lifecycle).toEqual([
      "capture-started",
      "capture-ended:cancelled",
      "paused",
    ]);
    await subject.controller.resume();
    expect(subject.controller.state).toBe("ready");
    expect(subject.turns.lifecycle).toContain("resumed");
  });

  it("stops an active microphone capture without submitting it", async () => {
    const subject = fixture([
      {
        clipId: "stopped",
        durationMs: 300,
        transcript: { text: "go north", confidence: 0.99 },
      },
    ]);

    await subject.controller.startCapture();
    await subject.controller.stop();

    expect(subject.controller.state).toBe("ready");
    expect(subject.turns.submitted).toHaveLength(0);
    expect(subject.turns.lifecycle).toEqual([
      "capture-started",
      "capture-ended:cancelled",
    ]);
  });

  it("reports a failed microphone cancellation without claiming success", async () => {
    const narration = new ScriptedNarrationPort();
    const turns = new StubTurns(narration);
    const controller = new VoiceAudioController({
      turns,
      capture: {
        start: async () => undefined,
        stop: async () => ({ clipId: "unused", durationMs: 0 }),
        cancel: async () => {
          throw new Error("recorder would not cancel");
        },
      },
      transcriber: new ScriptedTranscriber([]),
      narration,
      playback: new ScriptedPlaybackPort(new VirtualAudioClock()),
      nextInteractionId: () => "cancel-failure",
      nextCaptureId: () => "capture-cancel-failure",
      observedObjects: () => [],
    });

    await controller.startCapture();
    await controller.stop();

    expect(controller.state).toBe("recoverable-error");
    expect(turns.lifecycle).toEqual([
      "capture-started",
      "audio:capture-cancel-failed",
      "capture-ended:failed",
    ]);
  });

  it("cancels pending microphone permission without a late capture", async () => {
    const narration = new ScriptedNarrationPort();
    const turns = new StubTurns(narration);
    let grantPermission!: () => void;
    const permission = new Promise<void>((resolve) => {
      grantPermission = resolve;
    });
    const cancelled: string[] = [];
    const controller = new VoiceAudioController({
      turns,
      capture: {
        start: async () => permission,
        stop: async () => ({ clipId: "unused", durationMs: 0 }),
        cancel: async (captureId) => {
          cancelled.push(captureId);
        },
      },
      transcriber: new ScriptedTranscriber([]),
      narration,
      playback: new ScriptedPlaybackPort(new VirtualAudioClock()),
      nextInteractionId: () => "permission-pending",
      nextCaptureId: () => "capture-pending",
      observedObjects: () => [],
    });

    const starting = controller.startCapture();
    expect(controller.state).toBe("requesting-microphone");
    await controller.stop();
    expect(controller.state).toBe("ready");

    grantPermission();
    await starting;

    expect(cancelled).toEqual(["capture-pending", "capture-pending"]);
    expect(turns.lifecycle).toEqual([]);
    expect(turns.submitted).toHaveLength(0);
    expect(controller.state).toBe("ready");
  });

  it("cancels while the recorder stop boundary is still pending", async () => {
    const narration = new ScriptedNarrationPort();
    const turns = new StubTurns(narration);
    let rejectStop!: (error: unknown) => void;
    const stopped = new Promise<never>((_resolve, reject) => {
      rejectStop = reject;
    });
    const controller = new VoiceAudioController({
      turns,
      capture: {
        start: async () => undefined,
        stop: async () => stopped,
        cancel: async () => rejectStop(new Error("capture cancelled")),
      },
      transcriber: new ScriptedTranscriber([]),
      narration,
      playback: new ScriptedPlaybackPort(new VirtualAudioClock()),
      nextInteractionId: () => "delayed-stop",
      nextCaptureId: () => "capture-delayed-stop",
      observedObjects: () => [],
    });

    await controller.startCapture();
    const finishing = controller.finishCapture();
    await Promise.resolve();
    await controller.stop();
    const result = await finishing;

    expect(result.outcome).toBe("failed");
    expect(turns.submitted).toHaveLength(0);
    expect(turns.lifecycle).toEqual([
      "capture-started",
      "capture-ended:cancelled",
      "transcription:cancelled",
    ]);
    expect(controller.state).toBe("ready");
  });

  it("reports microphone denial without beginning a turn", async () => {
    const narration = new ScriptedNarrationPort();
    const turns = new StubTurns(narration);
    const controller = new VoiceAudioController({
      turns,
      capture: {
        start: async () => {
          throw new Error("permission denied");
        },
        stop: async () => ({ clipId: "unused", durationMs: 0 }),
        cancel: async () => undefined,
      },
      transcriber: new ScriptedTranscriber([]),
      narration,
      playback: new ScriptedPlaybackPort(new VirtualAudioClock()),
      nextInteractionId: () => "microphone-denial",
      nextCaptureId: () => "capture-denial",
      observedObjects: () => [],
    });

    await controller.startCapture();

    expect(controller.state).toBe("recoverable-error");
    expect(turns.submitted).toHaveLength(0);
    expect(turns.lifecycle).toEqual(["audio:microphone-unavailable"]);

    await controller.submitText("look");
    expect(controller.state).toBe("ready");
    expect(turns.submitted).toEqual(["look"]);
  });

  it("records player interruption while narration is in flight", async () => {
    let playbackStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      playbackStarted = resolve;
    });
    const playback = {
      play: async (
        _request: NarrationRequest,
        signal: AbortSignal,
        lifecycle: PlaybackLifecycle,
      ) => {
        lifecycle.onStarted();
        playbackStarted();
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        });
      },
      stop: async () => undefined,
    };
    const narration = new ScriptedNarrationPort();
    const turns = new StubTurns(narration);
    const clips: ScriptedClip[] = [
      {
        clipId: "north",
        durationMs: 640,
        transcript: { text: "go north", confidence: 0.99 },
      },
    ];
    const controller = new VoiceAudioController({
      turns,
      capture: new ScriptedCapturePort(clips),
      transcriber: new ScriptedTranscriber(clips),
      narration,
      playback,
      nextInteractionId: () => "interruption",
      nextCaptureId: () => "capture-interruption",
      observedObjects: () => [],
    });

    await controller.startCapture();
    const finishing = controller.finishCapture();
    await started;
    await controller.stop();
    await finishing;

    expect(turns.lifecycle).toContain("playback-ended:interrupted");
    expect(controller.state).toBe("ready");
  });

  it("does not announce a stale audible start after pre-onset stop", async () => {
    const narration = new ScriptedNarrationPort();
    const turns = new StubTurns(narration);
    let playbackReady!: () => void;
    const ready = new Promise<void>((resolve) => {
      playbackReady = resolve;
    });
    let staleStart: (() => void) | undefined;
    const controller = new VoiceAudioController({
      turns,
      capture: new ScriptedCapturePort([]),
      transcriber: new ScriptedTranscriber([]),
      narration,
      playback: {
        play: async (_request, signal, lifecycle) => {
          staleStart = lifecycle.onStarted;
          playbackReady();
          await new Promise<void>((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason), {
              once: true,
            });
          });
        },
        stop: async () => undefined,
      },
      nextInteractionId: () => "pre-onset-stop",
      nextCaptureId: () => "unused-capture",
      observedObjects: () => [],
    });

    const submitting = controller.submitText("look");
    await ready;
    expect(controller.state).toBe("processing");

    await controller.stop();
    await submitting;
    staleStart?.();

    expect(turns.lifecycle).toEqual(["playback-ended:interrupted"]);
    expect(controller.state).toBe("ready");
  });

  it("repeats the current narration after its first playback is interrupted", async () => {
    let playbackStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      playbackStarted = resolve;
    });
    const requests: NarrationRequest[] = [];
    const playback = {
      play: async (
        request: NarrationRequest,
        signal: AbortSignal,
        lifecycle: PlaybackLifecycle,
      ) => {
        requests.push({ ...request });
        lifecycle.onStarted();
        if (requests.length > 1) return;
        playbackStarted();
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        });
      },
      stop: async () => undefined,
    };
    const narration = new ScriptedNarrationPort();
    const turns = new StubTurns(narration);
    const clips: ScriptedClip[] = [
      {
        clipId: "repeat-interrupted",
        durationMs: 640,
        transcript: { text: "go north", confidence: 0.99 },
      },
    ];
    const controller = new VoiceAudioController({
      turns,
      capture: new ScriptedCapturePort(clips),
      transcriber: new ScriptedTranscriber(clips),
      narration,
      playback,
      nextInteractionId: () => "repeat-interrupted",
      nextCaptureId: () => "capture-repeat-interrupted",
      observedObjects: () => [],
    });

    await controller.startCapture();
    const finishing = controller.finishCapture();
    await started;
    await controller.stop();
    await finishing;
    await controller.repeat();

    expect(requests).toHaveLength(2);
    expect(requests[1]).toMatchObject({
      role: requests[0]?.role,
      text: requests[0]?.text,
    });
    expect(turns.lifecycle).toEqual(
      expect.arrayContaining([
        "playback-ended:interrupted",
        "playback-ended:complete",
      ]),
    );
  });

  it("does not start queued narration after playback is stopped", async () => {
    const narration = new ScriptedNarrationPort();
    const turns = new StubTurns(narration, 2);
    let firstStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });
    const requests: NarrationRequest[] = [];
    const controller = new VoiceAudioController({
      turns,
      capture: new ScriptedCapturePort([]),
      transcriber: new ScriptedTranscriber([]),
      narration,
      playback: {
        play: async (request, signal, lifecycle) => {
          requests.push({ ...request });
          lifecycle.onStarted();
          firstStarted();
          await new Promise<void>((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason), {
              once: true,
            });
          });
        },
        stop: async () => undefined,
      },
      nextInteractionId: () => "queued-stop",
      nextCaptureId: () => "unused-capture",
      observedObjects: () => [],
    });

    const submitting = controller.submitText("look");
    await started;
    await controller.stop();
    await submitting;

    expect(requests).toHaveLength(1);
    expect(turns.lifecycle).toEqual([
      "playback-started:narrator",
      "playback-ended:interrupted",
    ]);
    expect(controller.state).toBe("ready");
  });
});
