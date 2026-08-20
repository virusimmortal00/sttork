import {
  createOpeningCommandKnowledge,
  isPendingOpeningObjectIntent,
  resolvePendingOpeningContextualObjectActionChoiceObject,
  resolvePendingOpeningReadExamineChoiceObject,
  type PendingOpeningObjectIntent,
} from "@zork-voice/command-knowledge";
import { validateInitialGuideModelDecision } from "@zork-voice/guide-core";
import type {
  GuideDecisionWithUsage,
  ProviderSpeech,
  ProviderTranscription,
} from "@zork-voice/providers";
import { ProviderAdapterError } from "@zork-voice/providers";
import { parseOpenAiLiveOrigin } from "./local-live-harness.js";

export interface OpenAiLiveProviderPort {
  transcribe(
    bytes: Uint8Array,
    mediaType: string,
    signal: AbortSignal,
  ): Promise<ProviderTranscription>;
  decideWithUsage(
    input: {
      readonly interactionId: string;
      readonly playerUtterance: string;
      readonly transcriptConfidence?: number;
      readonly observedObjects: readonly string[];
      readonly pendingIntent?: PendingOpeningObjectIntent;
      readonly knowledge: ReturnType<typeof createOpeningCommandKnowledge>;
    },
    signal: AbortSignal,
  ): Promise<GuideDecisionWithUsage>;
  synthesize(
    text: string,
    role: "guide" | "narrator",
    signal: AbortSignal,
  ): Promise<ProviderSpeech>;
}

export interface OpenAiLiveServiceOptions {
  readonly provider: OpenAiLiveProviderPort;
  readonly allowedOrigin: string;
  readonly sessionToken: string;
}

const sessionHeader = "x-zork-voice-live-session";
const jsonLimit = 16 * 1024;
const audioLimit = 2 * 1024 * 1024;

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function failure(code: string, status: number): Response {
  return json({ error: { code } }, status);
}

async function boundedBody(
  request: Request,
  maximum: number,
): Promise<Uint8Array> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && (declared < 0 || declared > maximum)) {
    throw new RangeError("request-too-large");
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > maximum) {
    throw new RangeError("request-size-invalid");
  }
  return bytes;
}

async function boundedJson(request: Request): Promise<unknown> {
  const bytes = await boundedBody(request, jsonLimit);
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as unknown;
  } catch {
    throw new TypeError("invalid-json");
  }
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("invalid-object");
  }
  return value as Record<string, unknown>;
}

function boundedString(value: unknown, maximum: number): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    /\p{Cc}/u.test(value)
  ) {
    throw new TypeError("invalid-string");
  }
  return value;
}

function boundedNarrationText(value: unknown, maximum: number): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    hasUnsafeNarrationControl(value)
  ) {
    throw new TypeError("invalid-narration-text");
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

function observedObjects(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length > 64) {
    throw new TypeError("invalid-observed-objects");
  }
  return value.map((item) => boundedString(item, 160));
}

function pendingOpeningIntent(
  value: unknown,
): PendingOpeningObjectIntent | undefined {
  if (value === undefined) return undefined;
  if (!isPendingOpeningObjectIntent(value)) {
    throw new TypeError("invalid-pending-intent");
  }
  if ("action" in value) return { action: value.action };
  if (value.kind === "content-object") return { kind: "content-object" };
  if (value.kind === "contextual-object-action-choice") {
    return {
      kind: "contextual-object-action-choice",
      objectValueId: value.objectValueId,
      suggestedActions: [value.suggestedActions[0], value.suggestedActions[1]],
    };
  }
  return {
    kind: "read-examine-choice",
    objectValueId: value.objectValueId,
    allowedActions: [value.allowedActions[0], value.allowedActions[1]],
  };
}

function safeUsage(usage: ProviderTranscription["usage"]): object {
  return { ...usage };
}

export function createOpenAiLiveService(options: OpenAiLiveServiceOptions) {
  parseOpenAiLiveOrigin(options.allowedOrigin);
  if (options.sessionToken.length < 32 || options.sessionToken.length > 160) {
    throw new TypeError("Local live-smoke session token is invalid.");
  }

  return async function handle(request: Request): Promise<Response> {
    if (
      request.headers.get("origin") !== options.allowedOrigin ||
      request.headers.get(sessionHeader) !== options.sessionToken
    ) {
      return failure("forbidden", 403);
    }
    if (request.method !== "POST") return failure("method-not-allowed", 405);

    const pathname = new URL(request.url).pathname;
    try {
      if (pathname === "/api/live/openai/transcribe") {
        const mediaType = request.headers.get("content-type")?.split(";", 1)[0];
        if (
          mediaType === undefined ||
          !["audio/webm", "audio/mp4", "audio/ogg"].includes(mediaType)
        ) {
          return failure("unsupported-audio", 415);
        }
        const bytes = await boundedBody(request, audioLimit);
        const result = await options.provider.transcribe(
          bytes,
          mediaType,
          request.signal,
        );
        return json({
          text: result.text,
          languages: result.languages,
          usage: safeUsage(result.usage),
        });
      }

      if (pathname === "/api/live/openai/guide") {
        const input = record(await boundedJson(request));
        const interactionId = boundedString(input.interactionId, 160);
        const playerUtterance = boundedString(input.playerUtterance, 2_000);
        const objects = observedObjects(input.observedObjects);
        const pendingIntent = pendingOpeningIntent(input.pendingIntent);
        const knowledge = createOpeningCommandKnowledge({
          observedObjects: objects,
        });
        const invalidPendingObjectChoice =
          pendingIntent !== undefined &&
          "kind" in pendingIntent &&
          ((pendingIntent.kind === "read-examine-choice" &&
            resolvePendingOpeningReadExamineChoiceObject(
              pendingIntent,
              knowledge,
            ) === undefined) ||
            (pendingIntent.kind === "contextual-object-action-choice" &&
              resolvePendingOpeningContextualObjectActionChoiceObject(
                pendingIntent,
                knowledge,
              ) === undefined));
        if (invalidPendingObjectChoice) {
          throw new TypeError("stale-pending-intent");
        }
        const confidence = input.transcriptConfidence;
        if (
          confidence !== undefined &&
          (typeof confidence !== "number" ||
            !Number.isFinite(confidence) ||
            confidence < 0 ||
            confidence > 1)
        ) {
          throw new TypeError("invalid-confidence");
        }
        const result = await options.provider.decideWithUsage(
          {
            interactionId,
            playerUtterance,
            ...(confidence === undefined
              ? {}
              : { transcriptConfidence: confidence as number }),
            observedObjects: objects,
            ...(pendingIntent === undefined ? {} : { pendingIntent }),
            knowledge,
          },
          request.signal,
        );
        let decision;
        try {
          decision = validateInitialGuideModelDecision(result.decision);
        } catch (error) {
          throw new ProviderAdapterError(
            "malformed-response",
            "Provider guide decision failed validation.",
            { cause: error },
          );
        }
        return json({ decision, usage: safeUsage(result.usage) });
      }

      if (pathname === "/api/live/openai/speech") {
        const input = record(await boundedJson(request));
        const text = boundedNarrationText(input.text, 4_000);
        if (input.role !== "guide" && input.role !== "narrator") {
          throw new TypeError("invalid-role");
        }
        const result = await options.provider.synthesize(
          text,
          input.role,
          request.signal,
        );
        return new Response(result.bytes.slice(), {
          status: 200,
          headers: {
            "content-type": result.mediaType,
            "content-length": String(result.bytes.byteLength),
            "cache-control": "no-store",
            "x-content-type-options": "nosniff",
            "x-zork-voice-provider": result.usage.provider,
            "x-zork-voice-model": result.usage.model,
          },
        });
      }

      return failure("not-found", 404);
    } catch (error) {
      if (request.signal.aborted) return failure("aborted", 499);
      if (error instanceof ProviderAdapterError) {
        const status = error.code === "budget-exhausted" ? 429 : 502;
        return failure(error.code, status);
      }
      if (error instanceof RangeError) return failure("request-too-large", 413);
      return failure("invalid-request", 400);
    }
  };
}
