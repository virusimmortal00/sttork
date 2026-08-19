import { describe, expect, it } from "vitest";

import {
  OPENING_AREA_KNOWLEDGE_VERSION,
  createOpeningCommandKnowledge,
  groundOpeningCommand,
  groundObservedObjectContentQuestion,
  groundPendingOpeningObjectReply,
  inferPendingOpeningObjectIntent,
  openingCommandHelp,
  resolveOpeningAffordanceCommand,
} from "./opening-area.js";

describe("opening-area command knowledge", () => {
  const knowledge = createOpeningCommandKnowledge({
    observedObjects: ["the brass token", "mailbox", "MAILBOX"],
  });

  it.each([
    ["north", "please head north", "north"],
    ["look", "What do I see around me?", "look"],
    ["look", "What do I see in front of me?", "look"],
    ["x mailbox", "inspect the mailbox", "examine mailbox"],
    ["get brass token", "pick up the brass token", "take brass token"],
  ])("grounds %s in the utterance as %s", (command, utterance, expected) => {
    expect(groundOpeningCommand(command, utterance, knowledge)).toMatchObject({
      ok: true,
      command: expected,
    });
  });

  it("rejects hidden objects and commands not grounded in the utterance", () => {
    expect(
      groundOpeningCommand("take sword", "take the sword", knowledge),
    ).toEqual({ ok: false, code: "unobserved-object" });
    expect(groundOpeningCommand("north", "look around", knowledge)).toEqual({
      ok: false,
      code: "not-grounded-in-utterance",
    });
    expect(
      groundOpeningCommand("north", "What do I see around me?", knowledge),
    ).toEqual({ ok: false, code: "not-grounded-in-utterance" });
    expect(
      groundOpeningCommand("north", "What do I see in front of me?", knowledge),
    ).toEqual({ ok: false, code: "not-grounded-in-utterance" });
    expect(
      groundOpeningCommand(
        "what do i see",
        "what do i see around me",
        knowledge,
      ),
    ).toEqual({ ok: false, code: "unsupported-grammar" });
  });

  it("resolves only locally described affordances and marks the semantic tier", () => {
    expect(
      resolveOpeningAffordanceCommand("look", "grammar.look", knowledge),
    ).toEqual({
      ok: true,
      command: "look",
      ruleId: "grammar.look",
      riskTier: 1,
      semanticFallbackAllowed: true,
    });
    expect(
      resolveOpeningAffordanceCommand(
        "inventory",
        "grammar.inventory",
        knowledge,
      ),
    ).toEqual({
      ok: true,
      command: "inventory",
      ruleId: "grammar.inventory",
      riskTier: 1,
      semanticFallbackAllowed: true,
    });
    expect(
      resolveOpeningAffordanceCommand(
        "open mailbox",
        "grammar.open",
        knowledge,
      ),
    ).toMatchObject({
      ok: true,
      command: "open mailbox",
      riskTier: 3,
      semanticFallbackAllowed: false,
    });
  });

  it.each([
    ["look", "grammar.direction.north", "affordance-command-mismatch"],
    ["north", "grammar.look", "affordance-command-mismatch"],
    ["look", "grammar.unknown", "unknown-affordance"],
    ["take sword", "grammar.take", "unobserved-object"],
  ])("rejects command %s for affordance %s", (command, affordanceId, code) => {
    expect(
      resolveOpeningAffordanceCommand(command, affordanceId, knowledge),
    ).toEqual({ ok: false, code });
  });

  it.each([
    ["What does the mailbox say?", "examine mailbox"],
    ["what does brass token say", "examine brass token"],
  ])(
    "grounds the exact observed-object content question %s as %s",
    (utterance, expected) => {
      expect(groundObservedObjectContentQuestion(utterance, knowledge)).toEqual(
        {
          ok: true,
          command: expected,
          ruleId: "grammar.examine",
        },
      );
    },
  );

  it.each([
    {
      name: "unobserved object",
      utterance: "What does the sword say?",
      code: "unobserved-object",
    },
    {
      name: "different question form",
      utterance: "What does the mailbox contain?",
      code: "not-grounded-in-utterance",
    },
    {
      name: "extra request wording",
      utterance: "Please tell me what the mailbox says.",
      code: "not-grounded-in-utterance",
    },
    {
      name: "multi-step request",
      utterance: "What does the mailbox say, then go north?",
      code: "not-grounded-in-utterance",
    },
  ])("rejects a $name content question", ({ utterance, code }) => {
    expect(groundObservedObjectContentQuestion(utterance, knowledge)).toEqual({
      ok: false,
      code,
    });
  });

  it.each([
    ["What does it say?", "examine"],
    ["read it", "read"],
    ["please open it", "open"],
    ["pick it up", "take"],
  ])("retains the single reviewed object action in %s", (utterance, action) => {
    expect(inferPendingOpeningObjectIntent(utterance)).toEqual({ action });
  });

  it.each([
    "go north",
    "open it and take it",
    "read it and go north",
    "what does it say then go north",
  ])("does not retain an unsafe or absent object action in %s", (utterance) => {
    expect(inferPendingOpeningObjectIntent(utterance)).toBeUndefined();
  });

  it("fills a pending object slot only from one exact observed-object answer", () => {
    expect(
      groundPendingOpeningObjectReply(
        { action: "examine" },
        "The brass token",
        knowledge,
      ),
    ).toEqual({
      ok: true,
      command: "examine brass token",
      ruleId: "grammar.examine",
    });
    expect(
      groundPendingOpeningObjectReply(
        { action: "read" },
        "the mailbox",
        knowledge,
      ),
    ).toEqual({
      ok: true,
      command: "read mailbox",
      ruleId: "grammar.read",
    });
    expect(
      groundPendingOpeningObjectReply(
        { action: "examine" },
        "the sword",
        knowledge,
      ),
    ).toEqual({ ok: false, code: "unobserved-object" });
    expect(
      groundPendingOpeningObjectReply(
        { action: "examine" },
        "the mailbox and brass token",
        knowledge,
      ),
    ).toEqual({ ok: false, code: "unobserved-object" });
  });

  it("builds help only from parser grammar and observed object names", () => {
    const help = openingCommandHelp(knowledge);
    expect(help).toContain("look");
    expect(help).toContain("brass token");
    expect(help).toContain("mailbox");
    expect(help).not.toMatch(/sword|trapdoor|kitchen/iu);
    expect(Object.isFrozen(knowledge)).toBe(true);
    expect(Object.isFrozen(knowledge.rules)).toBe(true);
    expect(Object.isFrozen(knowledge.observedObjects)).toBe(true);
    expect(knowledge.version).toBe(OPENING_AREA_KNOWLEDGE_VERSION);
    expect(knowledge.version).toBe(5);
    expect(
      knowledge.rules.find((rule) => rule.id === "grammar.look"),
    ).toMatchObject({
      semanticDescription: expect.any(String),
      riskTier: 1,
      semanticFallbackAllowed: true,
    });
    expect(
      knowledge.rules.find((rule) => rule.id === "grammar.look")?.aliases,
    ).not.toContain("tell me where i am");
    expect(
      knowledge.rules
        .filter((rule) => rule.semanticFallbackAllowed)
        .map((rule) => [rule.id, rule.riskTier]),
    ).toEqual([
      ["grammar.look", 1],
      ["grammar.inventory", 1],
    ]);
  });

  it("rejects oversized observed context before constructing model input", () => {
    expect(() =>
      createOpeningCommandKnowledge({
        observedObjects: Array.from(
          { length: 33 },
          (_, index) => `item ${index}`,
        ),
      }),
    ).toThrow(RangeError);
  });
});
