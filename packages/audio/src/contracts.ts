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

export const transcriptionFailureCodes = Object.freeze([
  "aborted",
  "budget-exhausted",
  "capture-empty",
  "capture-too-large",
  "invalid-input",
  "malformed-response",
  "no-speech",
  "provider-rejected",
  "session-expired",
  "transport-failed",
  "unknown-clip",
] as const);

export type TranscriptionFailureCode =
  (typeof transcriptionFailureCodes)[number];

const transcriptionFailureCodeSet = new Set<string>(transcriptionFailureCodes);

/**
 * Returns only provider-neutral, player-safe transcription failure codes.
 * Adapter messages, response bodies, and arbitrary vendor codes stay outside
 * the semantic event stream.
 */
export function transcriptionFailureCode(
  error: unknown,
): TranscriptionFailureCode | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  try {
    const code = Reflect.get(error, "code");
    return typeof code === "string" && transcriptionFailureCodeSet.has(code)
      ? (code as TranscriptionFailureCode)
      : undefined;
  } catch {
    return undefined;
  }
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
  play(
    request: NarrationRequest,
    signal: AbortSignal,
    lifecycle: PlaybackLifecycle,
  ): Promise<void>;
  stop(): Promise<void>;
}

export interface PlaybackLifecycle {
  readonly onStarted: () => void;
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
