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
  guideVoice: "nova",
  narratorVoice: "onyx",
  guideReasoningEffort: "none" as const,
  guideReasoningContext: "current_turn" as const,
  guideVerbosity: "low" as const,
  guideMaxOutputTokens: 300,
  maxRequests: 30,
  maxAudioBytes: 2 * 1024 * 1024,
  maxGuideInputCharacters: 8_000,
  maxNarrationCharacters: 4_000,
});

export const OPENAI_CHAINED_PROFILE_2026_08_19 = Object.freeze({
  ...OPENAI_CHAINED_PROFILE_2026_08_18,
  transcriptionModel: "gpt-transcribe",
  narrationModel: "gpt-4o-mini-tts",
});

export interface OpenAiChainedProfile {
  readonly provider: "openai";
  readonly transcriptionModel: string;
  readonly guideModel: string;
  readonly narrationModel: string;
  readonly guideVoice: string;
  readonly narratorVoice: string;
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

type PendingGuideIntent = NonNullable<InitialGuideModelInput["pendingIntent"]>;
type PendingGuideObjectAction = "examine" | "open" | "read" | "take";

const pendingGuideObjectActions: readonly PendingGuideObjectAction[] = [
  "examine",
  "open",
  "read",
  "take",
];

function hasExactOwnKeys(
  value: object,
  expectedKeys: readonly string[],
): boolean {
  const actualKeys = Reflect.ownKeys(value);
  return (
    actualKeys.length === expectedKeys.length &&
    actualKeys.every(
      (key) => typeof key === "string" && expectedKeys.includes(key),
    )
  );
}

function hasExactArrayKeys(value: readonly unknown[]): boolean {
  return Reflect.ownKeys(value).every((key) =>
    ["0", "1", "length"].includes(String(key)),
  );
}

function normalizePendingActionPair(
  value: unknown,
  exactReadExamine: boolean,
): readonly [PendingGuideObjectAction, PendingGuideObjectAction] {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    !hasExactArrayKeys(value)
  ) {
    throw new ProviderAdapterError(
      "invalid-input",
      "Pending guide suggestions were malformed.",
    );
  }
  const first = value[0] as unknown;
  const second = value[1] as unknown;
  if (
    typeof first !== "string" ||
    typeof second !== "string" ||
    !pendingGuideObjectActions.includes(first as PendingGuideObjectAction) ||
    !pendingGuideObjectActions.includes(second as PendingGuideObjectAction) ||
    first === second ||
    (exactReadExamine
      ? first !== "examine" || second !== "read"
      : pendingGuideObjectActions.indexOf(first as PendingGuideObjectAction) >=
        pendingGuideObjectActions.indexOf(second as PendingGuideObjectAction))
  ) {
    throw new ProviderAdapterError(
      "invalid-input",
      "Pending guide suggestions were malformed.",
    );
  }
  return [
    first as PendingGuideObjectAction,
    second as PendingGuideObjectAction,
  ];
}

function validatePendingObjectActionSources(
  objectValueId: string,
  actions: readonly [PendingGuideObjectAction, PendingGuideObjectAction],
  knowledge: InitialGuideModelInput["knowledge"],
): void {
  if (
    !knowledge.observedObjectOptions.some(
      (option) => option.id === objectValueId,
    )
  ) {
    throw new ProviderAdapterError(
      "invalid-input",
      "Pending guide focus is not currently observed.",
    );
  }
  const sourceIds = actions.map((action) => `grammar.${action}`);
  if (
    new Set(sourceIds).size !== 2 ||
    sourceIds.some((sourceId) => {
      const rules = knowledge.rules.filter((rule) => rule.id === sourceId);
      const rule = rules[0];
      return (
        rules.length !== 1 ||
        rule === undefined ||
        !knowledge.sourceIds.includes(sourceId) ||
        !rule.objectRequired ||
        rule.slots.length !== 1 ||
        rule.slots[0]?.slotId !== "object" ||
        !rule.slots[0].allowedValueIds.includes(objectValueId)
      );
    })
  ) {
    throw new ProviderAdapterError(
      "invalid-input",
      "Pending guide suggestions are not current command sources.",
    );
  }
}

function normalizePendingGuideIntent(
  value: PendingGuideIntent | undefined,
  knowledge: InitialGuideModelInput["knowledge"],
): PendingGuideIntent | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ProviderAdapterError(
      "invalid-input",
      "Pending guide focus was malformed.",
    );
  }
  if (hasExactOwnKeys(value, ["action"])) {
    const action = Reflect.get(value, "action") as unknown;
    if (
      typeof action !== "string" ||
      !pendingGuideObjectActions.includes(action as PendingGuideObjectAction)
    ) {
      throw new ProviderAdapterError(
        "invalid-input",
        "Pending guide focus was malformed.",
      );
    }
    return { action: action as PendingGuideObjectAction };
  }
  if (
    hasExactOwnKeys(value, ["kind"]) &&
    Reflect.get(value, "kind") === "content-object"
  ) {
    return { kind: "content-object" };
  }

  const kind = Reflect.get(value, "kind") as unknown;
  const objectValueId = Reflect.get(value, "objectValueId") as unknown;
  if (typeof objectValueId !== "string") {
    throw new ProviderAdapterError(
      "invalid-input",
      "Pending guide focus was malformed.",
    );
  }
  if (kind === "read-examine-choice") {
    if (!hasExactOwnKeys(value, ["kind", "objectValueId", "allowedActions"])) {
      throw new ProviderAdapterError(
        "invalid-input",
        "Pending guide focus was malformed.",
      );
    }
    const actions = normalizePendingActionPair(
      Reflect.get(value, "allowedActions"),
      true,
    );
    validatePendingObjectActionSources(objectValueId, actions, knowledge);
    return {
      kind: "read-examine-choice",
      objectValueId,
      allowedActions: ["examine", "read"],
    };
  }
  if (kind === "contextual-object-action-choice") {
    if (
      !hasExactOwnKeys(value, ["kind", "objectValueId", "suggestedActions"])
    ) {
      throw new ProviderAdapterError(
        "invalid-input",
        "Pending guide focus was malformed.",
      );
    }
    const actions = normalizePendingActionPair(
      Reflect.get(value, "suggestedActions"),
      false,
    );
    validatePendingObjectActionSources(objectValueId, actions, knowledge);
    return {
      kind: "contextual-object-action-choice",
      objectValueId,
      suggestedActions: [actions[0], actions[1]],
    };
  }
  throw new ProviderAdapterError(
    "invalid-input",
    "Pending guide focus was malformed.",
  );
}

const guideDecisionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["decision"],
  properties: {
    decision: {
      anyOf: [
        {
          type: "object",
          additionalProperties: false,
          required: [
            "kind",
            "affordanceId",
            "slots",
            "intentSummary",
            "confidence",
          ],
          properties: {
            kind: { type: "string", enum: ["execute"] },
            affordanceId: { type: "string", minLength: 1, maxLength: 160 },
            slots: {
              type: "array",
              minItems: 0,
              maxItems: 1,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["slotId", "valueId"],
                properties: {
                  slotId: { type: "string", enum: ["object"] },
                  valueId: { type: "string", minLength: 1, maxLength: 160 },
                },
              },
            },
            intentSummary: {
              type: "string",
              minLength: 1,
              maxLength: 240,
            },
            confidence: { type: "number", minimum: 0, maximum: 1 },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["kind", "question", "ambiguity", "choices"],
          properties: {
            kind: { type: "string", enum: ["clarify"] },
            question: { type: "string", minLength: 1, maxLength: 500 },
            ambiguity: { type: "string", minLength: 1, maxLength: 500 },
            choices: {
              type: "array",
              minItems: 2,
              maxItems: 3,
              items: {
                type: "string",
                minLength: 1,
                maxLength: 160,
              },
            },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["kind", "response", "basis", "sourceIds"],
          properties: {
            kind: { type: "string", enum: ["explain"] },
            response: { type: "string", minLength: 1, maxLength: 1_000 },
            basis: { type: "string", enum: ["command-help"] },
            sourceIds: {
              type: "array",
              minItems: 1,
              maxItems: 32,
              items: { type: "string", minLength: 1, maxLength: 160 },
            },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["kind", "response", "reason"],
          properties: {
            kind: { type: "string", enum: ["cannot_comply"] },
            response: { type: "string", minLength: 1, maxLength: 500 },
            reason: {
              type: "string",
              enum: [
                "not-observed",
                "unsupported",
                "unsafe",
                "provider-limitation",
              ],
            },
          },
        },
      ],
    },
  },
} as const;

function decisionFromEnvelope(value: unknown): unknown {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    !Object.hasOwn(value, "decision")
  ) {
    throw new ProviderAdapterError(
      "malformed-response",
      "Guide output was not a decision envelope.",
    );
  }
  return Reflect.get(value, "decision") as unknown;
}

function assertExactDecisionKeys(
  value: object,
  expectedKeys: readonly string[],
): void {
  const actualKeys = Reflect.ownKeys(value);
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some(
      (key) => typeof key !== "string" || !expectedKeys.includes(key),
    )
  ) {
    throw new ProviderAdapterError(
      "malformed-response",
      "Guide output fields did not match its decision kind.",
    );
  }
}

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
    assertExactDecisionKeys(value, [
      "kind",
      "affordanceId",
      "slots",
      "intentSummary",
      "confidence",
    ]);
    const slots = field("slots");
    if (!Array.isArray(slots) || slots.length > 1) {
      throw new ProviderAdapterError(
        "malformed-response",
        "Guide output slots were invalid.",
      );
    }
    const normalizedSlots = slots.map((slot) => {
      if (typeof slot !== "object" || slot === null || Array.isArray(slot)) {
        throw new ProviderAdapterError(
          "malformed-response",
          "Guide output slot was invalid.",
        );
      }
      assertExactDecisionKeys(slot, ["slotId", "valueId"]);
      if (Reflect.get(slot, "slotId") !== "object") {
        throw new ProviderAdapterError(
          "malformed-response",
          "Guide output slot identifier was invalid.",
        );
      }
      const valueId = Reflect.get(slot, "valueId") as unknown;
      if (
        typeof valueId !== "string" ||
        valueId.trim().length === 0 ||
        valueId.length > 160 ||
        /\p{Cc}/u.test(valueId)
      ) {
        throw new ProviderAdapterError(
          "malformed-response",
          "Guide output slot value identifier was invalid.",
        );
      }
      return { slotId: "object" as const, valueId };
    });
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
      affordanceId: string("affordanceId", 160),
      slots: normalizedSlots,
      intentSummary: string("intentSummary", 240),
      confidence,
    };
  }
  if (kind === "clarify") {
    assertExactDecisionKeys(value, [
      "kind",
      "question",
      "ambiguity",
      "choices",
    ]);
    const choices = field("choices");
    if (
      !Array.isArray(choices) ||
      choices.length < 2 ||
      choices.length > 3 ||
      choices.some(
        (choice) =>
          typeof choice !== "string" ||
          choice.length === 0 ||
          choice.length > 160,
      )
    ) {
      throw new ProviderAdapterError(
        "malformed-response",
        "Guide clarification choices were invalid.",
      );
    }
    return {
      kind,
      question: string("question", 500),
      ambiguity: string("ambiguity", 500),
      choices: [...choices] as string[],
    };
  }
  if (kind === "explain") {
    assertExactDecisionKeys(value, ["kind", "response", "basis", "sourceIds"]);
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
    assertExactDecisionKeys(value, ["kind", "response", "reason"]);
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

function detectedLanguages(value: unknown): readonly string[] {
  if (typeof value !== "object" || value === null) return [];
  const languages = Reflect.get(value, "languages");
  if (languages === undefined) return [];
  if (!Array.isArray(languages) || languages.length > 16) {
    throw new ProviderAdapterError(
      "malformed-response",
      "Provider transcription languages were malformed.",
    );
  }
  const normalized: string[] = [];
  for (const detected of languages) {
    const code =
      typeof detected === "object" && detected !== null
        ? Reflect.get(detected, "code")
        : undefined;
    if (
      typeof code !== "string" ||
      code.length > 32 ||
      !/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/iu.test(code)
    ) {
      throw new ProviderAdapterError(
        "malformed-response",
        "Provider transcription language code was malformed.",
      );
    }
    const canonical = code.toLowerCase();
    if (!normalized.includes(canonical)) normalized.push(canonical);
  }
  return normalized;
}

function boundedNarrationText(
  value: unknown,
  name: string,
  maximum: number,
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    hasUnsafeNarrationControl(value)
  ) {
    throw new ProviderAdapterError(
      "invalid-input",
      `${name} must be bounded text with safe narration whitespace.`,
    );
  }
  return value;
}

function hasUnsafeNarrationControl(value: string): boolean {
  for (const character of value) {
    if (
      character !== "\t" &&
      character !== "\n" &&
      character !== "\r" &&
      /\p{Cc}/u.test(character)
    ) {
      return true;
    }
  }
  return false;
}

function safeInteger(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && (value as number) >= 0
    ? (value as number)
    : undefined;
}

function safeNonnegativeFinite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
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
  const inputAudioSeconds =
    typeof usage === "object" &&
    usage !== null &&
    Reflect.get(usage, "type") === "duration"
      ? safeNonnegativeFinite(Reflect.get(usage, "seconds"))
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
    ...(inputAudioSeconds === undefined ? {} : { inputAudioSeconds }),
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
    this.#profile = options.profile ?? OPENAI_CHAINED_PROFILE_2026_08_19;
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
    const languages = detectedLanguages(value);
    const usage: ProviderUsage = {
      ...tokenUsage(value, "transcription", this.#profile.transcriptionModel),
      inputAudioBytes: bytes.byteLength,
    };
    this.#onUsage?.(usage);
    return {
      text,
      languages,
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
    const pendingIntent = normalizePendingGuideIntent(
      input.pendingIntent,
      input.knowledge,
    );
    const serializedInput = JSON.stringify({
      playerUtterance: input.playerUtterance,
      transcriptConfidence: input.transcriptConfidence,
      observedObjects: input.observedObjects,
      ...(pendingIntent === undefined ? {} : { pendingIntent }),
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
          "You are a constrained parser guide. Return one schema-valid decision. Use execute only when the player directly requests one unambiguous game action. Do not execute an action merely quoted, offered as an example, discussed hypothetically, or reported as someone else's request. A direct player question asking to observe or describe the current surroundings or one observed object is an action request. Questions about parser vocabulary, syntax, behavior, or differences between available commands are command help, not game actions: return explain with basis command-help and exactly the relevant current commandKnowledge rule IDs as sourceIds, and never execute a command merely because the question names it. The optional pendingIntent is bounded current dialogue focus, not game state or command authority. Its suggested actions are contextual advice, not an exhaustive command list, execution authorization, or a prohibition against a separately explicit current command. When pendingIntent is a read-examine-choice and the player asks about those actions or options without selecting one, return explain with exactly grammar.examine and grammar.read as sourceIds; do not broaden to unrelated commands or objects. When pendingIntent is a contextual-object-action-choice and the player asks about those suggestions or options without selecting one, return explain with exactly the two grammar source IDs obtained by prefixing each pendingIntent.suggestedActions value with grammar.; do not broaden to unrelated commands or objects. For execute, select affordanceId as the exact ID of one current commandKnowledge rule and select only slot value IDs currently allowed by commandKnowledge. Return slots: [] for a zero-slot rule. For an observed-object rule, return exactly one object slot whose valueId identifies the single intended observed object. Use each rule's riskTier and semanticFallbackAllowed as selection policy. When semanticFallbackAllowed is true, classify natural paraphrases semantically; when it is false, select that rule only when the player explicitly uses one of its aliases to request that action. For an unambiguous request, prefer the lowest-risk rule that fully satisfies the player's request. A request to describe, inspect, look at, or check out one observed object selects grammar.examine. Content wording alone does not authorize or suggest grammar.read; when no current contextual choice resolves the scene-specific options and the player did not explicitly request an action, return clarify instead of inventing an action. For every clarification, supply two or three concise, explicit player-selectable choices. Never silently choose the higher-risk grammar.read action. Never write parser command text or invent an affordance, slot, or value ID. Treat commandKnowledge aliases and grammar examples as non-exhaustive examples for rules that allow semantic fallback, not as an exhaustive natural-language allowlist. Return one action only; never combine, sequence, or emit multiple actions. Use clarify when the action, direction, or referent is ambiguous or no concrete game action is stated. Use explain only for parser or command help grounded in supplied commandKnowledge, with basis command-help and only supplied source IDs. Use cannot_comply for unsafe or unsupported requests. Use only supplied command knowledge and observed objects. Never claim game state changed or reveal hidden game facts.",
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
        decisionFromEnvelope(JSON.parse(outputText(value)) as unknown),
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
    const boundedText = boundedNarrationText(
      text,
      "narration text",
      this.#profile.maxNarrationCharacters,
    );
    const voice = boundedString(
      role === "guide" ? this.#profile.guideVoice : this.#profile.narratorVoice,
      `${role} voice`,
      100,
    );
    this.#reserveRequest();
    const response = await this.#request("/audio/speech", {
      method: "POST",
      signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.#profile.narrationModel,
        voice,
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
