import { describe, expect, it } from "vitest";

import {
  OPENING_AREA_KNOWLEDGE_VERSION,
  createOpeningCommandKnowledge,
  groundOpeningCommand,
  groundObservedObjectContentQuestion,
  openingCommandHelp,
} from "./opening-area.js";

describe("opening-area command knowledge", () => {
  const knowledge = createOpeningCommandKnowledge({
    observedObjects: ["the brass token", "mailbox", "MAILBOX"],
  });

  it.each([
    ["north", "please head north", "north"],
    ["look", "What do I see around me?", "look"],
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
      groundOpeningCommand(
        "what do i see",
        "what do i see around me",
        knowledge,
      ),
    ).toEqual({ ok: false, code: "unsupported-grammar" });
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
    expect(knowledge.version).toBe(3);
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
