import type { GuideDecision, MetaControl } from "@zork-voice/contracts";

export type GuideDecisionValidationCode =
  | "not-an-object"
  | "unknown-kind"
  | "unknown-field"
  | "missing-field"
  | "invalid-field";

export class GuideDecisionValidationError extends Error {
  public readonly code: GuideDecisionValidationCode;

  public constructor(code: GuideDecisionValidationCode, message: string) {
    super(message);
    this.name = "GuideDecisionValidationError";
    this.code = code;
  }
}

type UnknownRecord = Record<string, unknown>;

const META_CONTROLS = new Set<MetaControl>([
  "stop-speaking",
  "repeat-last",
  "pause-session",
  "resume-session",
  "speech-slower",
  "speech-faster",
  "show-transcript",
  "hide-transcript",
]);

function record(input: unknown): UnknownRecord {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new GuideDecisionValidationError(
      "not-an-object",
      "A guide decision must be an object.",
    );
  }
  return input as UnknownRecord;
}

function exactKeys(
  input: UnknownRecord,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) {
      throw new GuideDecisionValidationError(
        "unknown-field",
        `Unknown guide decision field: ${key}`,
      );
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(input, key)) {
      throw new GuideDecisionValidationError(
        "missing-field",
        `Missing guide decision field: ${key}`,
      );
    }
  }
}

function boundedString(input: unknown, field: string, maximum = 1_000): string {
  if (typeof input !== "string" || input.trim().length === 0) {
    throw new GuideDecisionValidationError(
      "invalid-field",
      `${field} must be a non-empty string.`,
    );
  }
  if (input.length > maximum || /\p{Cc}/u.test(input)) {
    throw new GuideDecisionValidationError(
      "invalid-field",
      `${field} is not a bounded display string.`,
    );
  }
  return input;
}

function optionalString(input: unknown, field: string): string | undefined {
  return input === undefined ? undefined : boundedString(input, field);
}

function stringArray(input: unknown, field: string): readonly string[] {
  if (!Array.isArray(input) || input.length > 32) {
    throw new GuideDecisionValidationError(
      "invalid-field",
      `${field} must be a bounded string array.`,
    );
  }
  return input.map((value) => boundedString(value, field, 160));
}

export function validateGuideDecision(input: unknown): GuideDecision {
  const value = record(input);
  if (typeof value.kind !== "string") {
    throw new GuideDecisionValidationError(
      "missing-field",
      "A guide decision requires a kind.",
    );
  }

  switch (value.kind) {
    case "execute": {
      exactKeys(
        value,
        ["kind", "command", "intentSummary", "confidence"],
        ["expectedEffect", "acknowledgement", "remainingGoal"],
      );
      const confidence = value.confidence;
      if (
        typeof confidence !== "number" ||
        !Number.isFinite(confidence) ||
        confidence < 0 ||
        confidence > 1
      ) {
        throw new GuideDecisionValidationError(
          "invalid-field",
          "confidence must be a finite number from zero through one.",
        );
      }
      return {
        kind: "execute",
        command: boundedString(value.command, "command", 160),
        intentSummary: boundedString(value.intentSummary, "intentSummary"),
        confidence,
        ...(value.expectedEffect === undefined
          ? {}
          : {
              expectedEffect: optionalString(
                value.expectedEffect,
                "expectedEffect",
              ) as string,
            }),
        ...(value.acknowledgement === undefined
          ? {}
          : {
              acknowledgement: optionalString(
                value.acknowledgement,
                "acknowledgement",
              ) as string,
            }),
        ...(value.remainingGoal === undefined
          ? {}
          : {
              remainingGoal: optionalString(
                value.remainingGoal,
                "remainingGoal",
              ) as string,
            }),
      };
    }
    case "clarify": {
      exactKeys(value, ["kind", "question", "ambiguity"], ["choices"]);
      let choices:
        | readonly [string, string]
        | readonly [string, string, string]
        | undefined;
      if (value.choices !== undefined) {
        if (
          !Array.isArray(value.choices) ||
          (value.choices.length !== 2 && value.choices.length !== 3)
        ) {
          throw new GuideDecisionValidationError(
            "invalid-field",
            "choices must contain two or three strings.",
          );
        }
        const validated = value.choices.map((choice) =>
          boundedString(choice, "choices", 160),
        );
        choices =
          validated.length === 2
            ? [validated[0] as string, validated[1] as string]
            : [
                validated[0] as string,
                validated[1] as string,
                validated[2] as string,
              ];
      }
      return {
        kind: "clarify",
        question: boundedString(value.question, "question"),
        ambiguity: boundedString(value.ambiguity, "ambiguity"),
        ...(choices === undefined ? {} : { choices }),
      };
    }
    case "explain": {
      exactKeys(value, ["kind", "response", "basis", "sourceIds"]);
      if (
        value.basis !== "command-help" &&
        value.basis !== "observed-memory" &&
        value.basis !== "game-explanation"
      ) {
        throw new GuideDecisionValidationError(
          "invalid-field",
          "Unknown explanation basis.",
        );
      }
      return {
        kind: "explain",
        response: boundedString(value.response, "response", 4_000),
        basis: value.basis,
        sourceIds: stringArray(value.sourceIds, "sourceIds"),
      };
    }
    case "request_hint": {
      exactKeys(value, ["kind", "puzzleContext", "requestedLevel"]);
      if (
        value.requestedLevel !== 1 &&
        value.requestedLevel !== 2 &&
        value.requestedLevel !== 3 &&
        value.requestedLevel !== 4
      ) {
        throw new GuideDecisionValidationError(
          "invalid-field",
          "requestedLevel must be from one through four.",
        );
      }
      return {
        kind: "request_hint",
        puzzleContext: boundedString(value.puzzleContext, "puzzleContext"),
        requestedLevel: value.requestedLevel,
      };
    }
    case "session_control": {
      exactKeys(value, ["kind", "control"]);
      if (
        typeof value.control !== "string" ||
        !META_CONTROLS.has(value.control as MetaControl)
      ) {
        throw new GuideDecisionValidationError(
          "invalid-field",
          "Unknown session control.",
        );
      }
      return { kind: "session_control", control: value.control as MetaControl };
    }
    case "cannot_comply": {
      exactKeys(value, ["kind", "response", "reason"]);
      if (
        value.reason !== "not-observed" &&
        value.reason !== "unsupported" &&
        value.reason !== "unsafe" &&
        value.reason !== "provider-limitation"
      ) {
        throw new GuideDecisionValidationError(
          "invalid-field",
          "Unknown cannot-comply reason.",
        );
      }
      return {
        kind: "cannot_comply",
        response: boundedString(value.response, "response"),
        reason: value.reason,
      };
    }
    default:
      throw new GuideDecisionValidationError(
        "unknown-kind",
        `Unknown guide decision kind: ${value.kind}`,
      );
  }
}
