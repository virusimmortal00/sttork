import type { SemanticTurnResult } from "@zork-voice/session";
import type { NarrationRequest } from "@zork-voice/session";
import { describe, expect, it } from "vitest";

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
  public constructor(private readonly narration: ScriptedNarrationPort) {}

  public async submitTurn(input: {
    readonly interactionId: string;
    readonly transcript: string;
  }): Promise<SemanticTurnResult> {
    this.submitted.push(input.transcript);
    await this.narration.prepare(
      {
        narrationId: `narration-${input.interactionId}`,
        role: "narrator",
        text: `exact:${input.transcript}`,
        sourceEventId: `output-${input.interactionId}`,
        correlationId: input.interactionId,
      },
      new AbortController().signal,
    );
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
      expect.objectContaining({ role: "narrator", text: "exact:go north" }),
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

  it("turns silence into a recoverable non-mutating result", async () => {
    const subject = fixture([{ clipId: "silence", durationMs: 500 }]);
    await subject.controller.startCapture();
    const result = await subject.controller.finishCapture();
    expect(result.outcome).toBe("failed");
    expect(subject.turns.submitted).toHaveLength(0);
    expect(subject.turns.lifecycle).toContain("transcription:no-speech");
    expect(subject.playback.records).toHaveLength(0);
    expect(subject.controller.state).toBe("ready");
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

    expect(controller.state).toBe("ready");
    expect(turns.submitted).toHaveLength(0);
    expect(turns.lifecycle).toEqual(["audio:microphone-unavailable"]);
  });

  it("records player interruption while narration is in flight", async () => {
    let playbackStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      playbackStarted = resolve;
    });
    const playback = {
      play: async (_request: NarrationRequest, signal: AbortSignal) => {
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
});
