const canonicalCommandBrand: unique symbol = Symbol("CanonicalCommand");

export type CanonicalCommand = string & {
  readonly [canonicalCommandBrand]: true;
};

export const MAX_CANONICAL_COMMAND_LENGTH = 160;

export type CanonicalCommandErrorCode =
  | "not-a-string"
  | "empty"
  | "too-long"
  | "control-character"
  | "command-separator";

export class CanonicalCommandError extends Error {
  public readonly code: CanonicalCommandErrorCode;

  public constructor(code: CanonicalCommandErrorCode, message: string) {
    super(message);
    this.name = "CanonicalCommandError";
    this.code = code;
  }
}

/**
 * Performs the context-free part of command validation.
 *
 * The guide policy must still validate grammar, observed referents, confidence,
 * interaction idempotency, and expected engine revision before execution.
 */
export function canonicalizeCommand(input: unknown): CanonicalCommand {
  if (typeof input !== "string") {
    throw new CanonicalCommandError(
      "not-a-string",
      "A canonical command must be a string.",
    );
  }

  if (/\p{Cc}/u.test(input)) {
    throw new CanonicalCommandError(
      "control-character",
      "A canonical command cannot contain control characters.",
    );
  }

  const normalized = input.trim().replace(/[\t ]+/gu, " ");
  if (normalized.length === 0) {
    throw new CanonicalCommandError(
      "empty",
      "A canonical command cannot be empty.",
    );
  }

  if (normalized.length > MAX_CANONICAL_COMMAND_LENGTH) {
    throw new CanonicalCommandError(
      "too-long",
      `A canonical command cannot exceed ${MAX_CANONICAL_COMMAND_LENGTH} characters.`,
    );
  }

  if (/[.;]/u.test(normalized) || /(?:^|\s)then(?:\s|$)/iu.test(normalized)) {
    throw new CanonicalCommandError(
      "command-separator",
      "A canonical command must contain exactly one parser action.",
    );
  }

  return normalized as CanonicalCommand;
}
