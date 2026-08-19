import type { NarrationRole } from "../../contracts/src/index.js";
import type { NarrationRequest } from "../../session/src/index.js";

export interface CapturedAudioTurn {
  readonly clipId: string;
  readonly durationMs: number;
}

export interface FinalTranscript {
  readonly text: string;
  readonly confidence?: number;
}

export interface CapturePort {
  start(captureId: string): Promise<void>;
  stop(captureId: string): Promise<CapturedAudioTurn>;
  cancel(captureId: string): Promise<void>;
}

export interface TranscriberPort {
  transcribe(
    audio: CapturedAudioTurn,
    signal: AbortSignal,
  ): Promise<FinalTranscript>;
}

export interface PlaybackPort {
  play(request: NarrationRequest, signal: AbortSignal): Promise<void>;
  stop(): Promise<void>;
}

export interface AudioClock {
  readonly nowMs: number;
  wait(durationMs: number, signal: AbortSignal): Promise<void>;
}

export interface PlaybackRecord {
  readonly narrationId: string;
  readonly role: NarrationRole;
  readonly text: string;
  readonly startedAtMs: number;
  readonly endedAtMs: number;
}
