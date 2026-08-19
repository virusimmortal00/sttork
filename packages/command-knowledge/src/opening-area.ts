import {
  canonicalizeCommand,
  type CanonicalCommand,
} from "../../contracts/src/index.js";

export const OPENING_AREA_KNOWLEDGE_VERSION = 3;
export const MAX_OBSERVED_OBJECTS = 32;
export const MAX_OBSERVED_OBJECT_LENGTH = 80;

export type OpeningCommandVerb =
  | "look"
  | "inventory"
  | "north"
  | "south"
  | "east"
  | "west"
  | "up"
  | "down"
  | "examine"
  | "open"
  | "read"
  | "take";

export type PendingOpeningObjectAction = "examine" | "open" | "read" | "take";

export interface PendingOpeningObjectIntent {
  readonly action: PendingOpeningObjectAction;
}

export interface OpeningCommandRule {
  readonly id: string;
  readonly verb: OpeningCommandVerb;
  readonly aliases: readonly string[];
  readonly objectRequired: boolean;
  readonly grammar: string;
}

export interface OpeningCommandKnowledge {
  readonly version: typeof OPENING_AREA_KNOWLEDGE_VERSION;
  readonly rules: readonly OpeningCommandRule[];
  readonly observedObjects: readonly string[];
  readonly sourceIds: readonly string[];
}

export type CommandGroundingFailureCode =
  | "unsupported-grammar"
  | "missing-object"
  | "unobserved-object"
  | "not-grounded-in-utterance";

export type CommandGroundingResult =
  | {
      readonly ok: true;
      readonly command: CanonicalCommand;
      readonly ruleId: string;
    }
  | {
      readonly ok: false;
      readonly code: CommandGroundingFailureCode;
    };

const RULES: readonly OpeningCommandRule[] = [
  {
    id: "grammar.look",
    verb: "look",
    aliases: ["look", "look around", "what do i see around me"],
    objectRequired: false,
    grammar: "look",
  },
  {
    id: "grammar.inventory",
    verb: "inventory",
    aliases: ["inventory", "check inventory", "what am i carrying"],
    objectRequired: false,
    grammar: "inventory",
  },
  ...(["north", "south", "east", "west", "up", "down"] as const).map(
    (direction): OpeningCommandRule => ({
      id: `grammar.direction.${direction}`,
      verb: direction,
      aliases: [direction, `go ${direction}`, `head ${direction}`],
      objectRequired: false,
      grammar: direction,
    }),
  ),
  {
    id: "grammar.examine",
    verb: "examine",
    aliases: ["examine", "inspect", "look at", "x"],
    objectRequired: true,
    grammar: "examine <observed object>",
  },
  {
    id: "grammar.open",
    verb: "open",
    aliases: ["open"],
    objectRequired: true,
    grammar: "open <observed object>",
  },
  {
    id: "grammar.read",
    verb: "read",
    aliases: ["read"],
    objectRequired: true,
    grammar: "read <observed object>",
  },
  {
    id: "grammar.take",
    verb: "take",
    aliases: ["take", "get", "pick up"],
    objectRequired: true,
    grammar: "take <observed object>",
  },
];

function normalizeWords(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function stripArticle(value: string): string {
  return value.replace(/^(?:a|an|the)\s+/u, "");
}

function includesPhrase(value: string, phrase: string): boolean {
  return ` ${value} `.includes(` ${phrase} `);
}

function appearsMultiStep(value: string): boolean {
  return /[;\n]|\b(?:and|then|after that|followed by)\b/iu.test(value);
}

const pendingObjectActions: readonly PendingOpeningObjectAction[] = [
  "examine",
  "open",
  "read",
  "take",
];

export function inferPendingOpeningObjectIntent(
  playerUtterance: string,
): PendingOpeningObjectIntent | undefined {
  const normalized = normalizeWords(playerUtterance);
  if (normalized.length === 0 || appearsMultiStep(playerUtterance)) {
    return undefined;
  }

  const actions = new Set<PendingOpeningObjectAction>();
  if (/^what does (?:the )?.+ say$/u.test(normalized)) {
    actions.add("examine");
  }
  if (/\bpick (?:it|that|this) up\b/u.test(normalized)) {
    actions.add("take");
  }
  for (const rule of RULES) {
    if (
      !rule.objectRequired ||
      !pendingObjectActions.includes(rule.verb as PendingOpeningObjectAction)
    ) {
      continue;
    }
    if (
      rule.aliases.some((alias) =>
        includesPhrase(normalized, normalizeWords(alias)),
      )
    ) {
      actions.add(rule.verb as PendingOpeningObjectAction);
    }
  }

  if (actions.size !== 1) return undefined;
  return Object.freeze({ action: [...actions][0]! });
}

export function groundPendingOpeningObjectReply(
  intent: PendingOpeningObjectIntent,
  playerUtterance: string,
  knowledge: OpeningCommandKnowledge,
): CommandGroundingResult {
  if (
    typeof intent !== "object" ||
    intent === null ||
    !pendingObjectActions.includes(intent.action)
  ) {
    return { ok: false, code: "unsupported-grammar" };
  }
  const object = stripArticle(normalizeWords(playerUtterance));
  if (object.length === 0 || !knowledge.observedObjects.includes(object)) {
    return { ok: false, code: "unobserved-object" };
  }
  return {
    ok: true,
    command: canonicalizeCommand(`${intent.action} ${object}`),
    ruleId: `grammar.${intent.action}`,
  };
}

export function createOpeningCommandKnowledge(input: {
  readonly observedObjects: readonly string[];
}): OpeningCommandKnowledge {
  if (input.observedObjects.length > MAX_OBSERVED_OBJECTS) {
    throw new RangeError(
      `Opening command knowledge accepts at most ${MAX_OBSERVED_OBJECTS} observed objects.`,
    );
  }
  const observedObjects = [
    ...new Set(
      input.observedObjects
        .map((object) => {
          if (
            typeof object !== "string" ||
            object.length > MAX_OBSERVED_OBJECT_LENGTH ||
            /\p{Cc}/u.test(object)
          ) {
            throw new TypeError(
              "Observed object names must be bounded strings.",
            );
          }
          return stripArticle(normalizeWords(object));
        })
        .filter((object) => object.length > 0),
    ),
  ].sort();

  const rules = RULES.map((rule) =>
    Object.freeze({ ...rule, aliases: Object.freeze([...rule.aliases]) }),
  );
  return Object.freeze({
    version: OPENING_AREA_KNOWLEDGE_VERSION,
    rules: Object.freeze(rules),
    observedObjects: Object.freeze(observedObjects),
    sourceIds: Object.freeze(RULES.map((rule) => rule.id)),
  });
}

function findRule(command: string): {
  readonly rule: OpeningCommandRule;
  readonly object: string;
} | null {
  for (const rule of RULES) {
    const commandAliases = [rule.verb, ...rule.aliases]
      .map(normalizeWords)
      .sort((left, right) => right.length - left.length);
    for (const alias of commandAliases) {
      if (command === alias && !rule.objectRequired) {
        return { rule, object: "" };
      }
      if (rule.objectRequired && command.startsWith(`${alias} `)) {
        return {
          rule,
          object: stripArticle(command.slice(alias.length + 1)),
        };
      }
    }
  }
  return null;
}

export function groundOpeningCommand(
  proposedCommand: unknown,
  playerUtterance: string,
  knowledge: OpeningCommandKnowledge,
): CommandGroundingResult {
  const candidate = canonicalizeCommand(proposedCommand);
  const normalizedCommand = normalizeWords(candidate);
  const parsed = findRule(normalizedCommand);
  if (parsed === null) {
    return { ok: false, code: "unsupported-grammar" };
  }

  const normalizedUtterance = normalizeWords(playerUtterance);
  const mentionsIntent = parsed.rule.aliases.some((alias) =>
    includesPhrase(normalizedUtterance, normalizeWords(alias)),
  );
  if (!mentionsIntent) {
    return { ok: false, code: "not-grounded-in-utterance" };
  }

  if (!parsed.rule.objectRequired) {
    return {
      ok: true,
      command: canonicalizeCommand(parsed.rule.verb),
      ruleId: parsed.rule.id,
    };
  }
  if (parsed.object.length === 0) {
    return { ok: false, code: "missing-object" };
  }
  if (!knowledge.observedObjects.includes(parsed.object)) {
    return { ok: false, code: "unobserved-object" };
  }
  if (!includesPhrase(normalizedUtterance, parsed.object)) {
    return { ok: false, code: "not-grounded-in-utterance" };
  }

  return {
    ok: true,
    command: canonicalizeCommand(`${parsed.rule.verb} ${parsed.object}`),
    ruleId: parsed.rule.id,
  };
}

export function groundObservedObjectContentQuestion(
  playerUtterance: string,
  knowledge: OpeningCommandKnowledge,
): CommandGroundingResult {
  if (appearsMultiStep(playerUtterance)) {
    return { ok: false, code: "not-grounded-in-utterance" };
  }

  const match = /^what does (?:the )?(.+) say$/u.exec(
    normalizeWords(playerUtterance),
  );
  const object = match?.[1];
  if (object === undefined || object.length === 0) {
    return { ok: false, code: "not-grounded-in-utterance" };
  }
  if (!knowledge.observedObjects.includes(object)) {
    return { ok: false, code: "unobserved-object" };
  }

  return {
    ok: true,
    command: canonicalizeCommand(`examine ${object}`),
    ruleId: "grammar.examine",
  };
}

export function openingCommandHelp(knowledge: OpeningCommandKnowledge): string {
  const objectHelp =
    knowledge.observedObjects.length === 0
      ? ""
      : ` For things already mentioned—${knowledge.observedObjects.join(", ")}—you can try examine, open, read, or take.`;
  return `You can look, check inventory, or try a direction such as north, south, east, west, up, or down.${objectHelp}`;
}
