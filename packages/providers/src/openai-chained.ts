import type {
  GuideModel,
  InitialGuideModelInput,
} from "@zork-voice/guide-core";

import {
  ProviderAdapterError,
  type GuideDecisionWithUsage,
  type ProviderSpeech,
  type ProviderTranscription,
  type ProviderUsage,
} from "./contracts.js";

export const OPENAI_CHAINED_PROFILE_2026_08_18 = Object.freeze({
  provider: "openai" as const,
  transcriptionModel: "gpt-4o-mini-transcribe",
  guideModel: "gpt-5.6-luna",
  narrationModel: "tts-1",
  guideReasoningEffort: "none" as const,
  guideReasoningContext: "current_turn" as const,
  guideVerbosity: "low" as const,
  guideMaxOutputTokens: 300,
  maxRequests: 12,
  maxAudioBytes: 2 * 1024 * 1024,
  maxGuideInputCharacters: 8_000,
  maxNarrationCharacters: 4_000,
});

export interface OpenAiChainedProfile {
  readonly provider: "openai";
  readonly transcriptionModel: string;
  readonly guideModel: string;
  readonly narrationModel: string;
  readonly guideReasoningEffort: "none" | "low";
  readonly guideReasoningContext: "current_turn";
  readonly guideVerbosity: "low" | "medium" | "high";
  readonly guideMaxOutputTokens: number;
  readonly maxRequests: number;
  readonly maxAudioBytes: number;
  readonly maxGuideInputCharacters: number;
  readonly maxNarrationCharacters: number;
}

export interface OpenAiChainedProviderOptions {
  readonly apiKey: string;
  readonly fetch?: typeof fetch;
  readonly baseUrl?: string;
  readonly profile?: OpenAiChainedProfile;
  readonly safetyIdentifier?: string;
  readonly onUsage?: (usage: ProviderUsage) => void;
}

const guideDecisionSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "kind",
    "command",
    "intentSummary",
    "confidence",
    "question",
    "ambiguity",
    "response",
    "basis",
    "sourceIds",
    "reason",
  ],
  properties: {
    kind: {
      type: "string",
      enum: ["execute", "clarify", "explain", "cannot_comply"],
    },
    command: {
      anyOf: [
        { type: "string", minLength: 1, maxLength: 160 },
        { type: "null" },
      ],
    },
    intentSummary: {
      anyOf: [
        { type: "string", minLength: 1, maxLength: 240 },
        { type: "null" },
      ],
    },
    confidence: {
      anyOf: [{ type: "number", minimum: 0, maximum: 1 }, { type: "null" }],
    },
    question: {
      anyOf: [
        { type: "string", minLength: 1, maxLength: 500 },
        { type: "null" },
      ],
    },
    ambiguity: {
      anyOf: [
        { type: "string", minLength: 1, maxLength: 500 },
        { type: "null" },
      ],
    },
    response: {
      anyOf: [
        { type: "string", minLength: 1, maxLength: 1_000 },
        { type: "null" },
      ],
    },
    basis: {
      anyOf: [{ type: "string", enum: ["command-help"] }, { type: "null" }],
    },
    sourceIds: {
      anyOf: [
        {
          type: "array",
          minItems: 1,
          maxItems: 32,
          items: { type: "string", minLength: 1, maxLength: 160 },
        },
        { type: "null" },
      ],
    },
    reason: {
      anyOf: [
        {
          type: "string",
          enum: [
            "not-observed",
            "unsupported",
            "unsafe",
            "provider-limitation",
          ],
        },
        { type: "null" },
      ],
    },
  },
} as const;

function normalizeGuideDecision(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ProviderAdapterError(
      "malformed-response",
      "Guide output was not a decision object.",
    );
  }
  const field = (name: string) => Reflect.get(value, name) as unknown;
  const string = (name: string, maximum: number): string => {
    const candidate = field(name);
    if (
      typeof candidate !== "string" ||
      candidate.length === 0 ||
      candidate.length > maximum
    ) {
      throw new ProviderAdapterError(
        "malformed-response",
        `Guide output field ${name} was invalid.`,
      );
    }
    return candidate;
  };
  const kind = field("kind");
  if (kind === "execute") {
    const confidence = field("confidence");
    if (
      typeof confidence !== "number" ||
      !Number.isFinite(confidence) ||
      confidence < 0 ||
      confidence > 1
    ) {
      throw new ProviderAdapterError(
        "malformed-response",
        "Guide output confidence was invalid.",
      );
    }
    return {
      kind,
      command: string("command", 160),
      intentSummary: string("intentSummary", 240),
      confidence,
    };
  }
  if (kind === "clarify") {
    return {
      kind,
      question: string("question", 500),
      ambiguity: string("ambiguity", 500),
    };
  }
  if (kind === "explain") {
    const sourceIds = field("sourceIds");
    if (
      field("basis") !== "command-help" ||
      !Array.isArray(sourceIds) ||
      sourceIds.length === 0 ||
      sourceIds.length > 32 ||
      sourceIds.some(
        (sourceId) =>
          typeof sourceId !== "string" ||
          sourceId.length === 0 ||
          sourceId.length > 160,
      )
    ) {
      throw new ProviderAdapterError(
        "malformed-response",
        "Guide explanation metadata was invalid.",
      );
    }
    return {
      kind,
      response: string("response", 1_000),
      basis: "command-help",
      sourceIds: [...sourceIds] as string[],
    };
  }
  if (kind === "cannot_comply") {
    const reason = field("reason");
    if (
      reason !== "not-observed" &&
      reason !== "unsupported" &&
      reason !== "unsafe" &&
      reason !== "provider-limitation"
    ) {
      throw new ProviderAdapterError(
        "malformed-response",
        "Guide refusal reason was invalid.",
      );
    }
    return { kind, response: string("response", 500), reason };
  }
  throw new ProviderAdapterError(
    "malformed-response",
    "Guide output kind was invalid.",
  );
}

function boundedString(value: unknown, name: string, maximum: number): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    /\p{Cc}/u.test(value)
  ) {
    throw new ProviderAdapterError(
      "invalid-input",
      `${name} must be a bounded nonempty string.`,
    );
  }
  return value;
}

function safeInteger(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && (value as number) >= 0
    ? (value as number)
    : undefined;
}

function outputText(value: unknown): string {
  if (typeof value !== "object" || value === null) {
    throw new ProviderAdapterError(
      "malformed-response",
      "Provider response was not an object.",
    );
  }
  const output = Reflect.get(value, "output");
  if (!Array.isArray(output)) {
    throw new ProviderAdapterError(
      "malformed-response",
      "Provider response omitted output items.",
    );
  }
  const texts: string[] = [];
  for (const item of output) {
    if (typeof item !== "object" || item === null) continue;
    const content = Reflect.get(item, "content");
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (
        typeof part === "object" &&
        part !== null &&
        Reflect.get(part, "type") === "output_text" &&
        typeof Reflect.get(part, "text") === "string"
      ) {
        texts.push(Reflect.get(part, "text") as string);
      }
    }
  }
  if (texts.length !== 1 || texts[0]?.length === 0) {
    throw new ProviderAdapterError(
      "malformed-response",
      "Provider response did not contain exactly one output text.",
    );
  }
  return texts[0]!;
}

function tokenUsage(
  response: unknown,
  capability: ProviderUsage["capability"],
  model: string,
): ProviderUsage {
  const usage =
    typeof response === "object" && response !== null
      ? Reflect.get(response, "usage")
      : undefined;
  const inputTokens =
    typeof usage === "object" && usage !== null
      ? safeInteger(Reflect.get(usage, "input_tokens"))
      : undefined;
  const inputDetails =
    typeof usage === "object" && usage !== null
      ? Reflect.get(usage, "input_tokens_details")
      : undefined;
  const cachedInputTokens =
    typeof inputDetails === "object" && inputDetails !== null
      ? safeInteger(Reflect.get(inputDetails, "cached_tokens"))
      : undefined;
  const cacheWriteInputTokens =
    typeof inputDetails === "object" && inputDetails !== null
      ? safeInteger(Reflect.get(inputDetails, "cache_write_tokens"))
      : undefined;
  const outputTokens =
    typeof usage === "object" && usage !== null
      ? safeInteger(Reflect.get(usage, "output_tokens"))
      : undefined;
  const outputDetails =
    typeof usage === "object" && usage !== null
      ? Reflect.get(usage, "output_tokens_details")
      : undefined;
  const reasoningTokens =
    typeof outputDetails === "object" && outputDetails !== null
      ? safeInteger(Reflect.get(outputDetails, "reasoning_tokens"))
      : undefined;
  const totalTokens =
    typeof usage === "object" && usage !== null
      ? safeInteger(Reflect.get(usage, "total_tokens"))
      : undefined;
  return {
    provider: "openai",
    capability,
    model,
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(cachedInputTokens === undefined ? {} : { cachedInputTokens }),
    ...(cacheWriteInputTokens === undefined ? {} : { cacheWriteInputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(reasoningTokens === undefined ? {} : { reasoningTokens }),
    ...(totalTokens === undefined ? {} : { totalTokens }),
  };
}

export class OpenAiChainedProvider implements GuideModel {
  readonly #apiKey: string;
  readonly #fetch: typeof fetch;
  readonly #baseUrl: string;
  readonly #profile: OpenAiChainedProfile;
  readonly #safetyIdentifier: string | undefined;
  readonly #onUsage: ((usage: ProviderUsage) => void) | undefined;
  #requests = 0;

  public constructor(options: OpenAiChainedProviderOptions) {
    if (!/^sk-[A-Za-z0-9_-]{20,}$/u.test(options.apiKey)) {
      throw new ProviderAdapterError(
        "invalid-input",
        "OpenAI API key is missing or malformed.",
      );
    }
    this.#apiKey = options.apiKey;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#baseUrl = (options.baseUrl ?? "https://api.openai.com/v1").replace(
      /\/$/u,
      "",
    );
    if (!this.#baseUrl.startsWith("https://")) {
      throw new ProviderAdapterError(
        "invalid-input",
        "OpenAI base URL must use HTTPS.",
      );
    }
    this.#profile = options.profile ?? OPENAI_CHAINED_PROFILE_2026_08_18;
    this.#safetyIdentifier =
      options.safetyIdentifier === undefined
        ? undefined
        : boundedString(options.safetyIdentifier, "safety identifier", 160);
    this.#onUsage = options.onUsage;
  }

  public async transcribe(
    bytes: Uint8Array,
    mediaType: string,
    signal: AbortSignal,
  ): Promise<ProviderTranscription> {
    if (
      bytes.byteLength === 0 ||
      bytes.byteLength > this.#profile.maxAudioBytes
    ) {
      throw new ProviderAdapterError(
        "invalid-input",
        "Audio input is empty or exceeds the live-smoke limit.",
      );
    }
    const boundedType = boundedString(mediaType, "audio media type", 100);
    this.#reserveRequest();
    const body = new FormData();
    body.set("model", this.#profile.transcriptionModel);
    body.set(
      "file",
      new Blob([bytes.slice()], { type: boundedType }),
      "turn-audio",
    );
    const response = await this.#request("/audio/transcriptions", {
      method: "POST",
      body,
      signal,
    });
    const value: unknown = await this.#json(response);
    const text = boundedString(
      typeof value === "object" && value !== null
        ? Reflect.get(value, "text")
        : undefined,
      "transcription",
      2_000,
    );
    const languageValue =
      typeof value === "object" && value !== null
        ? Reflect.get(value, "language")
        : undefined;
    const usage: ProviderUsage = {
      ...tokenUsage(value, "transcription", this.#profile.transcriptionModel),
      inputAudioBytes: bytes.byteLength,
    };
    this.#onUsage?.(usage);
    return {
      text,
      ...(typeof languageValue === "string" && languageValue.length <= 32
        ? { language: languageValue }
        : {}),
      usage,
    };
  }

  public async decide(
    input: InitialGuideModelInput,
    signal: AbortSignal,
  ): Promise<unknown> {
    return (await this.decideWithUsage(input, signal)).decision;
  }

  public async decideWithUsage(
    input: InitialGuideModelInput,
    signal: AbortSignal,
  ): Promise<GuideDecisionWithUsage> {
    const serializedInput = JSON.stringify({
      playerUtterance: input.playerUtterance,
      transcriptConfidence: input.transcriptConfidence,
      observedObjects: input.observedObjects,
      commandKnowledge: input.knowledge,
    });
    if (serializedInput.length > this.#profile.maxGuideInputCharacters) {
      throw new ProviderAdapterError(
        "invalid-input",
        "Guide input exceeds the live-smoke limit.",
      );
    }
    this.#reserveRequest();
    const response = await this.#request("/responses", {
      method: "POST",
      signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.#profile.guideModel,
        max_output_tokens: this.#profile.guideMaxOutputTokens,
        store: false,
        reasoning: {
          effort: this.#profile.guideReasoningEffort,
          context: this.#profile.guideReasoningContext,
        },
        ...(this.#safetyIdentifier === undefined
          ? {}
          : { safety_identifier: this.#safetyIdentifier }),
        instructions:
          "You are a constrained parser guide. Return one schema-valid decision. Use only the supplied command knowledge and observed objects. Never claim game state changed. Prefer clarification when intent or referents are ambiguous. Do not emit multiple commands or hidden game facts. Set every field unused by the selected kind to null.",
        input: serializedInput,
        text: {
          verbosity: this.#profile.guideVerbosity,
          format: {
            type: "json_schema",
            name: "initial_guide_decision",
            strict: true,
            schema: guideDecisionSchema,
          },
        },
      }),
    });
    const value: unknown = await this.#json(response);
    let decision: unknown;
    try {
      decision = normalizeGuideDecision(
        JSON.parse(outputText(value)) as unknown,
      );
    } catch (error) {
      if (error instanceof ProviderAdapterError) throw error;
      throw new ProviderAdapterError(
        "malformed-response",
        "Guide output was not valid JSON.",
        { cause: error },
      );
    }
    const usage = tokenUsage(value, "guide", this.#profile.guideModel);
    this.#onUsage?.(usage);
    return { decision, usage };
  }

  public async synthesize(
    text: string,
    role: "guide" | "narrator",
    signal: AbortSignal,
  ): Promise<ProviderSpeech> {
    const boundedText = boundedString(
      text,
      "narration text",
      this.#profile.maxNarrationCharacters,
    );
    this.#reserveRequest();
    const response = await this.#request("/audio/speech", {
      method: "POST",
      signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.#profile.narrationModel,
        voice: role === "guide" ? "nova" : "onyx",
        input: boundedText,
        response_format: "mp3",
        speed: 1,
      }),
    });
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > 2 * 1024 * 1024) {
      throw new ProviderAdapterError(
        "malformed-response",
        "Speech response exceeds the live-smoke limit.",
      );
    }
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength === 0 || buffer.byteLength > 2 * 1024 * 1024) {
      throw new ProviderAdapterError(
        "malformed-response",
        "Speech response is empty or oversized.",
      );
    }
    const usage: ProviderUsage = {
      provider: "openai",
      capability: "narration",
      model: this.#profile.narrationModel,
      inputCharacters: boundedText.length,
    };
    this.#onUsage?.(usage);
    return {
      bytes: new Uint8Array(buffer.slice(0)),
      mediaType: "audio/mpeg",
      usage,
    };
  }

  #reserveRequest(): void {
    if (this.#requests >= this.#profile.maxRequests) {
      throw new ProviderAdapterError(
        "budget-exhausted",
        "The live-smoke provider request budget is exhausted.",
      );
    }
    this.#requests += 1;
  }

  async #request(path: string, init: RequestInit): Promise<Response> {
    let response: Response;
    try {
      response = await this.#fetch(`${this.#baseUrl}${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${this.#apiKey}`,
          ...(init.headers ?? {}),
        },
      });
    } catch (error) {
      if (init.signal?.aborted) {
        throw new ProviderAdapterError("aborted", "Provider call aborted.", {
          cause: error,
        });
      }
      throw new ProviderAdapterError(
        "transport-failed",
        "Provider transport failed.",
        { cause: error },
      );
    }
    if (!response.ok) {
      throw new ProviderAdapterError(
        "provider-rejected",
        `Provider rejected the request with status ${response.status}.`,
      );
    }
    return response;
  }

  async #json(response: Response): Promise<unknown> {
    try {
      return (await response.json()) as unknown;
    } catch (error) {
      throw new ProviderAdapterError(
        "malformed-response",
        "Provider returned malformed JSON.",
        { cause: error },
      );
    }
  }
}
