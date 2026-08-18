# Dungeon Guide Agent

## Status

This document defines the implementation contract for the agent that sits
between a player and the Z-machine. It is normative for the first playable
release. Product strategy and milestones may change provider choices, but they
must preserve the boundaries described here.

## Purpose

The Dungeon Guide lets a player speak in ordinary language while the original
game remains the sole authority over the world. It interprets intent, turns
grounded intent into parser commands, explains parser failures, remembers facts
the player has encountered, and provides hints at a player-controlled spoiler
level.

The guide is not a replacement game engine, co-author, or omniscient
walkthrough. It must never invent a room, object, outcome, inventory item, score
change, or successful action.

## Authority boundary

The responsibilities are deliberately split:

| Component            | Authoritative for                                                                                                 | Must not do                                                 |
| -------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Z-machine            | World state, valid actions, movement, inventory, puzzles, score, death, and exact game prose                      | Infer player intent or supply guide dialogue                |
| Dungeon Guide        | Intent interpretation, clarification, command grounding, command help, observed-memory recall, and hint selection | Mutate game state except through a validated parser command |
| Session orchestrator | Turn ordering, tool validation, audio routing, save/checkpoint coordination, retries, and meta controls           | Fabricate engine or guide results                           |
| Narrator             | Speaking exact Z-machine output                                                                                   | Paraphrase, embellish, or add hints to game prose           |

Only a successful `executeGameCommand` call may advance the game. Model text
claiming that an action happened has no effect and must never be presented as an
engine result.

## Core invariants

1. Every mutating game action is represented by a command accepted by the
   Z-machine.
2. The guide may propose only one engine command per decision. A multi-step
   request is executed as a turn-by-turn loop, observing the engine after every
   command.
3. The orchestrator validates every model decision against a closed schema
   before acting on it.
4. The guide sees only player-observed information plus deliberately exposed
   command grammar. Hidden map, object, and puzzle state are excluded from its
   normal context.
5. Narration preserves exact engine text. Guide speech is a separate event and a
   perceptibly separate role.
6. Ambiguity with materially different outcomes results in clarification, not a
   guess.
7. Hints never exceed the player's selected spoiler level.
8. Provider failure cannot silently advance or roll back the game.

## Interaction loop

For each completed player utterance, the orchestrator performs this loop:

1. Route deterministic meta controls such as “stop,” “pause,” and “repeat”
   before invoking the guide.
2. Build a bounded `GuideContext` from the latest transcript, recent engine
   turns, observed memory, command affordances, and current hint policy.
3. Ask the selected guide provider for one schema-constrained `GuideDecision`.
4. Validate its shape, command safety, referents, and spoiler policy.
5. Speak a clarification or answer, or execute one command.
6. If a command was executed, record and narrate the exact engine response.
7. Extract only newly observed facts, update memory with provenance, and
   re-evaluate any pending multi-step intent.
8. Stop the loop when the request is satisfied, the engine response diverges
   from the expected result, clarification is required, or the per-utterance
   action limit is reached.

The default per-utterance action limit is three engine turns. The player can
continue a longer plan with “continue.” This bounds cost and prevents a mistaken
interpretation from cascading through the game.

## Runtime contracts

The examples below are language-level contracts. The implementation should
publish equivalent runtime schemas, such as JSON Schema or Zod, and reject
additional properties at provider boundaries.

```ts
type InteractionId = string;
type EventId = string;
declare const canonicalCommandBrand: unique symbol;
type CanonicalCommand = string & { readonly [canonicalCommandBrand]: true };

interface GuideContext {
  interactionId: InteractionId;
  playerUtterance: string;
  transcriptConfidence?: number;
  recentTurns: ReadonlyArray<{
    command: string;
    engineOutput: string;
    engineRevision: number;
    eventIds: readonly EventId[];
  }>;
  observedFacts: readonly ObservedFact[];
  commandAffordances: readonly CommandAffordance[];
  pendingIntent?: PendingIntent;
  hintPolicy: HintPolicy;
  preferences: {
    verbosity: "terse" | "balanced" | "conversational";
    proactiveNudges: boolean;
  };
}

interface ObservedFact {
  id: string;
  statement: string;
  kind: "location" | "object" | "inventory" | "event" | "relationship";
  confidence: "explicit" | "inferred";
  sourceEventIds: readonly EventId[];
  firstObservedAtRevision: number;
  lastConfirmedAtRevision: number;
  supersededBy?: string;
}

interface CommandAffordance {
  id: string;
  verb: string;
  aliases: readonly string[];
  grammar: readonly string[];
  candidateObjects: readonly string[];
  source: "compiled-grammar" | "observed-context" | "parser-feedback";
}

interface PendingIntent {
  summary: string;
  remainingGoal: string;
  completedCommands: readonly string[];
}

interface HintPolicy {
  enabled: boolean;
  maximumLevel: 1 | 2 | 3 | 4;
  proactiveHintsAllowed: boolean;
  revealedHintIds: readonly string[];
}
```

### Guide decision

`GuideDecision` below is the canonical provider-neutral decision contract.
Architecture summaries and implementations must import or reference this
contract rather than redefine a smaller variant. The provider must return
exactly one branch. `execute` carries one parser command, never a command batch.

```ts
type GuideDecision =
  | {
      kind: "execute";
      command: string;
      intentSummary: string;
      expectedEffect?: string;
      confidence: number;
      acknowledgement?: string;
      remainingGoal?: string;
    }
  | {
      kind: "clarify";
      question: string;
      choices?: readonly [string, string] | readonly [string, string, string];
      ambiguity: string;
    }
  | {
      kind: "explain";
      response: string;
      basis: "command-help" | "observed-memory" | "game-explanation";
      sourceIds: readonly string[];
    }
  | {
      kind: "request_hint";
      puzzleContext: string;
      requestedLevel: 1 | 2 | 3 | 4;
    }
  | {
      kind: "session_control";
      control: MetaControl;
    }
  | {
      kind: "cannot_comply";
      response: string;
      reason: "not-observed" | "unsupported" | "unsafe" | "provider-limitation";
    };

type MetaControl =
  | "stop-speaking"
  | "repeat-last"
  | "pause-session"
  | "resume-session"
  | "speech-slower"
  | "speech-faster"
  | "show-transcript"
  | "hide-transcript";
```

`session_control` is a fallback for natural paraphrases that deterministic
routing did not catch. The orchestrator remains authoritative for applying
controls. `request_hint` does not carry solution prose: after policy approval,
the orchestrator retrieves a reviewed hint record through `getHint` and emits
that separately as guide speech. This separation prevents ordinary model output
from bypassing the spoiler gate.

### Tool surface

The guide subsystem exposes a small, explicit tool surface. A realtime provider
may request these tools, but the adapter first normalizes the request into the
canonical decision and the orchestrator applies policy; the provider never
receives an unvalidated engine object or direct mutation capability. Tools
return typed data, not implementation objects.

```ts
interface DungeonGuideTools {
  observe(input: { interactionId: InteractionId }): Promise<ObservedContext>;

  executeGameCommand(input: {
    interactionId: InteractionId;
    command: CanonicalCommand;
    expectedRevision: number;
  }): Promise<EngineTurnResult>;

  searchObservedMemory(input: {
    interactionId: InteractionId;
    query: string;
    limit?: number;
  }): Promise<ObservedFact[]>;

  inventory(input: {
    interactionId: InteractionId;
  }): Promise<ObservedInventory>;

  getCommandHelp(input: {
    interactionId: InteractionId;
    intent: string;
    observedObjectIds?: string[];
  }): Promise<CommandHelpResult>;

  getHint(input: {
    interactionId: InteractionId;
    puzzleContext: string;
    requestedLevel: 1 | 2 | 3 | 4;
  }): Promise<HintResult>;
}

interface ObservedContext {
  engineRevision: number;
  lastEngineOutput: string;
  visibleObjectNames: readonly string[];
  knownInventoryNames: readonly string[];
  recentCommandAffordances: readonly CommandAffordance[];
}

interface ObservedInventory {
  asOfRevision: number;
  itemNames: readonly string[];
  sourceEventIds: readonly EventId[];
  certainty: "engine-confirmed" | "event-derived";
}

interface EngineTurnResult {
  accepted: boolean;
  revisionBefore: number;
  revisionAfter: number;
  command: string;
  exactOutput: string;
  classification:
    | "progress"
    | "observation"
    | "parser-error"
    | "blocked-action"
    | "game-over"
    | "system-command";
  eventIds: readonly EventId[];
}

interface CommandHelpResult {
  intent: string;
  forms: ReadonlyArray<{
    example: string;
    explanation: string;
    sourceAffordanceIds: readonly string[];
  }>;
}

type HintResult =
  | {
      found: true;
      hintId: string;
      level: 1 | 2 | 3 | 4;
      text: string;
      progressGateId: string;
    }
  | {
      found: false;
      reason:
        "disabled" | "above-policy" | "not-authored" | "context-uncertain";
    };
```

The tool implementation enforces interaction IDs and optimistic engine
revisions. A duplicated or stale invocation must not execute twice. `inventory`
returns the most recently observed/public inventory projection and never
inspects hidden engine memory; if that projection is stale, the guide proposes
the canonical `inventory` parser command and observes the engine response.

`puzzleContext` is an untrusted lookup hint. The hint-policy layer resolves it
against the current observed state and reviewed hint registry; naming a puzzle
or hidden fact in provider output cannot grant access to it.

## Command grounding

The command index is built from the game grammar and maintained outside the
model. It contains verbs, aliases, recognized grammar forms, standard parser
commands, and contextually visible object names. It does not expose hidden
solutions.

Before execution, the orchestrator checks:

- the decision matches the runtime schema;
- the command is plain parser input, within the length limit, with no control
  characters;
- its verb and grammar are present in the command index or explicitly permitted
  system-command list;
- referenced objects are visible, carried, or otherwise present in observed
  memory;
- pronouns have one high-confidence referent;
- confidence meets the configured threshold;
- consequential ambiguity has been resolved;
- the command is not a duplicated retry for an already completed interaction and
  engine revision.

If validation fails, the command is not sent to the engine. The orchestrator may
ask the provider once to repair a structural error; semantic uncertainty becomes
a short spoken clarification.

Only the validator may brand the normalized string as `CanonicalCommand` for
`executeGameCommand`. Provider code cannot construct that type directly.

The engine response is final. A parser error is not rewritten as success. The
guide may explain the error, present up to three grounded alternatives, or ask
what the player meant.

## Clarification policy

Clarify when any of these conditions holds:

- more than one observed object plausibly matches a referent;
- the player's request implies different meaningful actions or destinations;
- transcription confidence is low on a command-bearing word or object name;
- an action is likely to cause death, discard an item, consume a limited object,
  overwrite a save, restart, or quit and the intent is not explicit;
- the request relies on knowledge the player has not observed;
- a multi-step plan reaches an unexpected engine response.

A clarification is one short question. Offer two or three spoken choices only
when they are grounded in observed state. Do not bury the question beneath an
explanation.

## Observed memory

Memory exists to help with requests such as “where did I see the mailbox?” and
“go back to the room with the rug.” It is an event-derived index, not a second
game state.

- Every fact includes source event IDs.
- Exact engine statements are stored as `explicit`; model-derived summaries are
  stored as `inferred`.
- Contradictory later observations supersede rather than erase earlier facts.
- Inventory and location claims should be re-confirmed from recent engine output
  before a consequential command.
- Save data includes the guide memory snapshot and its matching engine
  revision/checkpoint.
- Restoring a game restores the paired guide memory. Memory from the abandoned
  branch must not leak into the restored branch.
- Normal guide context includes only the minimum relevant facts. Long histories
  are retrieved on demand.

The guide must phrase uncertain recall as uncertainty. It must not promote an
inference to an engine fact.

## Hint and spoiler policy

Command help and puzzle hints are separate. Explaining that Zork understands a
form such as “put X in Y” is command help; revealing which object solves a
puzzle is a hint.

Hints use a four-level ladder:

1. **Syntax:** explain how to express the attempted action without revealing a
   solution.
2. **Nudge:** direct attention to an already observed clue or area.
3. **Strong hint:** identify the relevant observed object, relationship, or
   action class.
4. **Solution:** provide the exact command or command sequence.

Rules:

- If hints are disabled, ask the player to enable them before revealing puzzle
  guidance; ordinary parser syntax help remains available.
- Start at or below the configured maximum level and never escalate
  automatically.
- “Give me a hint” starts with level 2 unless the problem is only parser syntax.
- A player may explicitly request any level, including the solution.
- A hint is scoped to the current puzzle and current progress; it must not
  reveal later consequences.
- Prefer curated, progress-gated hint records and speak their reviewed wording
  as authored. Any future wording adapter is a separate, policy-checked stage
  that receives only the permitted record and may not add solution content.
- Record revealed hint IDs so repetition is consistent and escalation is
  deliberate.
- If no grounded hint exists, offer command help or summarize observed clues. Do
  not invent a walkthrough.
- Proactive nudges are off by default. When enabled, the guide may offer to
  provide a hint but does not reveal it until accepted.

## Guide and narrator speech

The narrator speaks `EngineTurnResult.exactOutput`, subject only to
pronunciation markup that does not change words or meaning. The guide speaks
acknowledgements, questions, command help, memory answers, and hints.

Acknowledgements should be omitted for obvious commands when they would add
latency or repeat the player's words. When included, they must not predict
success. “I’ll try opening the mailbox” is valid; “The mailbox opens” is not
valid until the engine says so.

The two roles use distinct voice profiles or, if only one voice is available, a
short nonverbal transition cue and clearly different delivery settings. Guide
speech must never be concatenated into the engine output payload.

## Provider requirements

OpenAI Realtime, OpenRouter-backed models, and suitable Hugging Face inference
models use the same guide contract. A provider or model is enabled only after it
passes the conformance suite for:

- strict structured decisions;
- one-command tool discipline;
- grounded object and verb selection;
- clarification under ambiguity;
- spoiler-level compliance;
- tool retry idempotency;
- acceptable latency for a spoken turn.

A provider may implement transcription, guide reasoning, and narration as one
realtime session or as separate stages. Provider-specific messages remain inside
adapters; domain events and save files contain no provider-native payloads.

## Failure behavior

| Failure                                   | Required behavior                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Empty or low-confidence transcript        | Do not execute. Ask the player to repeat the uncertain phrase or confirm the interpreted command.                                                                                                                                                                                                                 |
| Malformed provider decision               | Reject it, retry schema repair once, then ask a generic clarification. Record a redacted diagnostic event.                                                                                                                                                                                                        |
| Ungrounded or disallowed command          | Do not execute. Ask what the player meant and offer grounded choices when available.                                                                                                                                                                                                                              |
| Duplicate/stale tool call                 | Return the recorded result for the idempotency key or a stale-revision error; never execute twice.                                                                                                                                                                                                                |
| Guide timeout/disconnect                  | Keep game state unchanged. Retry according to provider policy, then report that the guide is temporarily unavailable.                                                                                                                                                                                             |
| Authentication, quota, or billing failure | Preserve the session and checkpoint. Explain how to reconnect or choose another configured provider without losing progress.                                                                                                                                                                                      |
| Parser error                              | Narrate the exact parser response, then offer concise syntax help. Never claim the intended action occurred.                                                                                                                                                                                                      |
| Unexpected result during a plan           | Clear or pause the remaining plan and ask before continuing.                                                                                                                                                                                                                                                      |
| Hint unavailable                          | State that no grounded hint is available and offer observed-fact recap or command help.                                                                                                                                                                                                                           |
| TTS failure                               | Keep the text event available for repeat and accessible display; do not mark it as spoken. Retry or offer another configured narrator.                                                                                                                                                                            |
| Engine crash or corrupt state             | Stop all guide actions and inspect the engine revision/receipt. Atomically restore the last verified checkpoint when commit status is known; report whether the last command committed. Require an explicit recovery choice when status or compatibility is uncertain. Never reconstruct state from model memory. |

Error messages should be short, honest, and actionable. Provider and stack
details appear only in debug mode unless the player needs them to reconnect.

## Security and privacy

- Treat transcripts, saves, and observed memory as user data.
- Do not place provider access tokens, raw credentials, or secret-bearing URLs
  in prompts, events, logs, or debug views.
- Raw audio retention is off by default.
- Transcript retention is limited to the current session unless the player
  enables history. A paired save must remain valid if transcript content is
  cleared.
- Tool inputs are orchestrator-generated from validated decisions; never execute
  provider-supplied code or URLs.
- Debug exports redact credentials and stable account identifiers.

## Required regression scenarios

The guide contract is not complete until automated fixtures cover at least:

1. A direct intent such as “open the mailbox” executes one grounded command.
2. A natural request such as “look around for anything useful” maps to
   observation without fabricated findings.
3. An ambiguous object reference produces a clarification and no engine turn.
4. A multi-step request observes each engine response and stops after an
   unexpected result.
5. A parser rejection is narrated exactly and explained separately.
6. A question about an observed object is answered with source-backed memory.
7. A question about an unobserved object does not leak hidden game knowledge.
8. Hint requests remain within each level and escalate only after player intent.
9. Duplicate tool delivery does not duplicate a game action.
10. Provider timeout, malformed output, and TTS failure leave the engine
    checkpoint unchanged.
11. Restore returns both engine state and observed memory to the same branch.
12. Meta controls never reach the Z-machine as parser commands.

## Initial implementation sequence

1. Define shared runtime schemas and event identifiers.
2. Wrap the Z-machine with idempotent, revision-checked command execution.
3. Compile the initial verb/grammar index and implement grounding validation.
4. Implement observed-memory extraction with provenance.
5. Implement the guide loop using recorded provider fixtures before live APIs.
6. Add curated hint records for the vertical-slice puzzles.
7. Add provider adapters behind the conformance suite.
8. Connect guide and narrator events to the voice experience described in
   `experience.md`.
