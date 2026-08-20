export interface ProviderUsage {
  readonly provider: "openai";
  readonly capability: "transcription" | "guide" | "narration";
  readonly model: string;
  readonly inputTokens?: number;
  readonly cachedInputTokens?: number;
  readonly cacheWriteInputTokens?: number;
  readonly outputTokens?: number;
  readonly reasoningTokens?: number;
  readonly totalTokens?: number;
  readonly inputAudioBytes?: number;
  readonly inputAudioSeconds?: number;
  readonly inputCharacters?: number;
}

export interface ProviderTranscription {
  readonly text: string;
  readonly languages: readonly string[];
  readonly usage: ProviderUsage;
}

export interface ProviderSpeech {
  readonly bytes: Uint8Array;
  readonly mediaType: string;
  readonly usage: ProviderUsage;
}

export interface GuideDecisionWithUsage {
  readonly decision: unknown;
  readonly usage: ProviderUsage;
}

export type ProviderErrorCode =
  | "aborted"
  | "budget-exhausted"
  | "invalid-input"
  | "malformed-response"
  | "provider-rejected"
  | "transport-failed";

export class ProviderAdapterError extends Error {
  public constructor(
    public readonly code: ProviderErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ProviderAdapterError";
  }
}
