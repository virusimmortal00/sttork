import type { SemanticTurnResult } from "@zork-voice/session";
import type { NarrationRequest } from "@zork-voice/session";
import { describe, expect, it } from "vitest";

import type { PlaybackLifecycle } from "./contracts.js";
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
  type VoiceAudioState,
  type VoiceTurnPort,
} from "./voice-audio-controller.js";

class StubTurns implements VoiceTurnPort {
  public readonly lifecycle: string[] = [];
  public readonly submitted: string[] = [];
  public readonly transcriptConfidences: Array<number | undefined> = [];
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
  public recordPlaybackEnded(input: { readonly outcome: string }): void {
    this.lifecycle.push(`playback-ended:${input.outcome}`);
  }
  public recordPaused(): void {
    this.lifecycle.push("paused");
  }
  public recordResumed(): void {
    this.lifecycle.push("resumed");
  }
}

function fixture(clips: readonly ScriptedClip[]) {
  const narration = new ScriptedNarrationPort();
  const turns = new StubTurns(narration);
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
