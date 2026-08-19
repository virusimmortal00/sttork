import {
  canonicalizeCommand,
  type CanonicalCommand,
} from "../../contracts/src/index.js";

export const OPENING_AREA_KNOWLEDGE_VERSION = 6;
export const MAX_OBSERVED_OBJECTS = 32;
export const MAX_OBSERVED_OBJECT_LENGTH = 80;
export const OBSERVED_OBJECT_VALUE_ID_PREFIX = "observed-object:";
export const MAX_OBSERVED_OBJECT_VALUE_ID_LENGTH =
  OBSERVED_OBJECT_VALUE_ID_PREFIX.length + MAX_OBSERVED_OBJECT_LENGTH;
export const OPENING_OBJECT_SLOT_ID = "object";

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

export interface OpeningObservedObjectOption {
  readonly id: string;
  readonly label: string;
}

export interface OpeningCommandSlotDefinition {
  readonly slotId: typeof OPENING_OBJECT_SLOT_ID;
  readonly allowedValueIds: readonly string[];
}

export interface OpeningCommandIntentSlot {
  readonly slotId: string;
  readonly valueId: string;
}

export interface OpeningCommandIntent {
  readonly affordanceId: string;
  readonly slots: readonly OpeningCommandIntentSlot[];
}

export interface OpeningCommandRule {
  readonly id: string;
  readonly verb: OpeningCommandVerb;
  readonly aliases: readonly string[];
  readonly objectRequired: boolean;
  readonly grammar: string;
  readonly semanticDescription: string;
  readonly riskTier: 1 | 2 | 3;
  readonly semanticFallbackAllowed: boolean;
  readonly slots: readonly OpeningCommandSlotDefinition[];
}

export interface OpeningCommandKnowledge {
  readonly version: typeof OPENING_AREA_KNOWLEDGE_VERSION;
  readonly rules: readonly OpeningCommandRule[];
  readonly observedObjects: readonly string[];
  readonly observedObjectOptions: readonly OpeningObservedObjectOption[];
  readonly sourceIds: readonly string[];
}

export type CommandGroundingFailureCode =
  | "unsupported-grammar"
  | "missing-object"
  | "unobserved-object"
  | "not-grounded-in-utterance"
  | "unknown-affordance"
  | "invalid-intent"
  | "missing-slot"
  | "unexpected-slot"
  | "unknown-slot-value";

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

export type OpeningCommandIntentResolution =
  | {
      readonly ok: true;
      readonly command: CanonicalCommand;
      readonly ruleId: string;
      readonly riskTier: 1 | 2 | 3;
      readonly semanticFallbackAllowed: boolean;
      readonly selectedObject?: OpeningObservedObjectOption;
    }
  | {
      readonly ok: false;
      readonly code: CommandGroundingFailureCode;
    };

type OpeningCommandRuleTemplate = Omit<OpeningCommandRule, "slots">;

const RULES: readonly OpeningCommandRuleTemplate[] = [
  {
    id: "grammar.look",
    verb: "look",
    aliases: [
      "look",
      "look around",
      "what do i see around me",
      "what do i see in front of me",
    ],
    objectRequired: false,
    grammar: "look",
    semanticDescription:
      "Describe the player's current location and visible surroundings.",
    riskTier: 1,
    semanticFallbackAllowed: true,
  },
  {
    id: "grammar.inventory",
    verb: "inventory",
    aliases: ["inventory", "check inventory", "what am i carrying"],
    objectRequired: false,
    grammar: "inventory",
    semanticDescription: "List the possessions the player currently carries.",
    riskTier: 1,
    semanticFallbackAllowed: true,
  },
  ...(["north", "south", "east", "west", "up", "down"] as const).map(
    (direction): OpeningCommandRuleTemplate => ({
      id: `grammar.direction.${direction}`,
      verb: direction,
      aliases: [direction, `go ${direction}`, `head ${direction}`],
      objectRequired: false,
      grammar: direction,
      semanticDescription: `Move in the ${direction} direction.`,
      riskTier: 3,
      semanticFallbackAllowed: false,
    }),
  ),
  {
    id: "grammar.examine",
    verb: "examine",
    aliases: ["examine", "inspect", "look at", "x"],
    objectRequired: true,
    grammar: "examine <observed object>",
    semanticDescription: "Observe one currently observed object more closely.",
    riskTier: 2,
    semanticFallbackAllowed: true,
  },
  {
    id: "grammar.open",
    verb: "open",
    aliases: ["open"],
    objectRequired: true,
    grammar: "open <observed object>",
    semanticDescription: "Open one currently observed object.",
    riskTier: 3,
    semanticFallbackAllowed: false,
  },
  {
    id: "grammar.read",
    verb: "read",
    aliases: ["read"],
    objectRequired: true,
    grammar: "read <observed object>",
    semanticDescription: "Read one currently observed object.",
    riskTier: 3,
    semanticFallbackAllowed: false,
  },
  {
    id: "grammar.take",
    verb: "take",
    aliases: ["take", "get", "pick up"],
    objectRequired: true,
    grammar: "take <observed object>",
    semanticDescription: "Take one currently observed object.",
    riskTier: 3,
    semanticFallbackAllowed: false,
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
          const normalized = stripArticle(normalizeWords(object));
          if (normalized.length > MAX_OBSERVED_OBJECT_LENGTH) {
            throw new TypeError(
              "Normalized observed object names must remain bounded.",
            );
          }
          return normalized;
        })
        .filter((object) => object.length > 0),
    ),
  ].sort();

  const observedObjectOptions = observedObjects.map((label) =>
    Object.freeze({
      id: `${OBSERVED_OBJECT_VALUE_ID_PREFIX}${label}`,
      label,
    }),
  );
  const allowedObjectValueIds = Object.freeze(
    observedObjectOptions.map((option) => option.id),
  );
  const rules = RULES.map((rule) => {
    const slots: readonly OpeningCommandSlotDefinition[] = rule.objectRequired
      ? Object.freeze([
          Object.freeze({
            slotId: OPENING_OBJECT_SLOT_ID,
            allowedValueIds: allowedObjectValueIds,
          }),
        ])
      : Object.freeze([]);
    return Object.freeze({
      ...rule,
      aliases: Object.freeze([...rule.aliases]),
      slots,
    });
  });
  return Object.freeze({
    version: OPENING_AREA_KNOWLEDGE_VERSION,
    rules: Object.freeze(rules),
    observedObjects: Object.freeze(observedObjects),
    observedObjectOptions: Object.freeze(observedObjectOptions),
    sourceIds: Object.freeze(RULES.map((rule) => rule.id)),
  });
}

function findRule(command: string): {
  readonly rule: OpeningCommandRuleTemplate;
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

function compileParsedOpeningCommand(
  parsed: NonNullable<ReturnType<typeof findRule>>,
  knowledge: OpeningCommandKnowledge,
): CommandGroundingResult {
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
  return {
    ok: true,
    command: canonicalizeCommand(`${parsed.rule.verb} ${parsed.object}`),
    ruleId: parsed.rule.id,
  };
}

function exactObjectKeys(
  value: object,
  expectedKeys: readonly string[],
): boolean {
  const keys = Reflect.ownKeys(value);
  return (
    keys.length === expectedKeys.length &&
    keys.every((key) => typeof key === "string" && expectedKeys.includes(key))
  );
}

function validIntentIdentifier(
  value: unknown,
  maximum: number,
): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    !/\p{Cc}/u.test(value)
  );
}

export function resolveOpeningCommandIntent(
  intent: unknown,
  knowledge: OpeningCommandKnowledge,
): OpeningCommandIntentResolution {
  if (
    typeof intent !== "object" ||
    intent === null ||
    Array.isArray(intent) ||
    !exactObjectKeys(intent, ["affordanceId", "slots"])
  ) {
    return { ok: false, code: "invalid-intent" };
  }
  const affordanceId = Reflect.get(intent, "affordanceId") as unknown;
  const slots = Reflect.get(intent, "slots") as unknown;
  if (!validIntentIdentifier(affordanceId, 160) || !Array.isArray(slots)) {
    return { ok: false, code: "invalid-intent" };
  }

  const rulePolicy = RULES.find((rule) => rule.id === affordanceId);
  const selectedRule = knowledge.rules.find((rule) => rule.id === affordanceId);
  if (
    rulePolicy === undefined ||
    selectedRule === undefined ||
    !knowledge.sourceIds.includes(rulePolicy.id)
  ) {
    return { ok: false, code: "unknown-affordance" };
  }

  if (!rulePolicy.objectRequired) {
    if (slots.length !== 0) {
      return { ok: false, code: "unexpected-slot" };
    }
    return {
      ok: true,
      command: canonicalizeCommand(rulePolicy.verb),
      ruleId: rulePolicy.id,
      riskTier: rulePolicy.riskTier,
      semanticFallbackAllowed: rulePolicy.semanticFallbackAllowed,
    };
  }

  if (slots.length === 0) {
    return { ok: false, code: "missing-slot" };
  }
  if (slots.length > 1) {
    return { ok: false, code: "unexpected-slot" };
  }
  const slot = slots[0];
  if (
    typeof slot !== "object" ||
    slot === null ||
    Array.isArray(slot) ||
    !exactObjectKeys(slot, ["slotId", "valueId"])
  ) {
    return { ok: false, code: "unexpected-slot" };
  }
  const slotId = Reflect.get(slot, "slotId") as unknown;
  const valueId = Reflect.get(slot, "valueId") as unknown;
  const definition = selectedRule.slots[0];
  if (
    selectedRule.slots.length !== 1 ||
    definition === undefined ||
    slotId !== definition.slotId
  ) {
    return { ok: false, code: "unexpected-slot" };
  }
  if (
    !validIntentIdentifier(valueId, MAX_OBSERVED_OBJECT_VALUE_ID_LENGTH) ||
    !definition.allowedValueIds.includes(valueId)
  ) {
    return { ok: false, code: "unknown-slot-value" };
  }
  const selectedObject = knowledge.observedObjectOptions.find(
    (option) => option.id === valueId,
  );
  if (selectedObject === undefined) {
    return { ok: false, code: "unknown-slot-value" };
  }

  return {
    ok: true,
    command: canonicalizeCommand(`${rulePolicy.verb} ${selectedObject.label}`),
    ruleId: rulePolicy.id,
    riskTier: rulePolicy.riskTier,
    semanticFallbackAllowed: rulePolicy.semanticFallbackAllowed,
    selectedObject,
  };
}

export function openingObjectSelectionMentioned(
  selectedObject: OpeningObservedObjectOption,
  playerUtterance: string,
): boolean {
  if (
    typeof selectedObject !== "object" ||
    selectedObject === null ||
    !exactObjectKeys(selectedObject, ["id", "label"]) ||
    !validIntentIdentifier(
      selectedObject.id,
      MAX_OBSERVED_OBJECT_VALUE_ID_LENGTH,
    ) ||
    typeof selectedObject.label !== "string" ||
    typeof playerUtterance !== "string"
  ) {
    return false;
  }
  const label = stripArticle(normalizeWords(selectedObject.label));
  return (
    label.length > 0 && includesPhrase(normalizeWords(playerUtterance), label)
  );
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

  const compiled = compileParsedOpeningCommand(parsed, knowledge);
  if (!compiled.ok) return compiled;
  if (
    parsed.rule.objectRequired &&
    !includesPhrase(normalizedUtterance, parsed.object)
  ) {
    return { ok: false, code: "not-grounded-in-utterance" };
  }
  return compiled;
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
