import { describe, expect, it } from "vitest";

import {
  createOpeningCommandKnowledge,
  groundOpeningCommand,
  openingCommandHelp,
} from "./opening-area.js";

describe("opening-area command knowledge", () => {
  const knowledge = createOpeningCommandKnowledge({
    observedObjects: ["the brass token", "mailbox", "MAILBOX"],
  });

  it.each([
    ["north", "please head north", "north"],
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
