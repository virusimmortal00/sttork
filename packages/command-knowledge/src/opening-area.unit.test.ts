import { describe, expect, it } from "vitest";

import {
  OPENING_AREA_KNOWLEDGE_VERSION,
  PENDING_OPENING_CONTEXTUAL_OBJECT_ACTIONS,
  createPendingOpeningContentObjectIntent,
  createPendingOpeningContextualObjectActionChoiceIntent,
  createPendingOpeningReadExamineChoiceIntent,
  createOpeningCommandKnowledge,
  groundOpeningCommand,
  groundObservedObjectContentQuestion,
  groundPendingOpeningObjectReply,
  groundPendingOpeningContextualObjectActionChoiceReply,
  groundPendingOpeningReadExamineChoiceReply,
  identifyNonlexicalOpeningContentRequest,
  identifyNonlexicalOpeningReadExamineAmbiguity,
  identifyNonlexicalOpeningReadAmbiguity,
  identifyOpeningReadExamineClarificationChoice,
  inferPendingOpeningObjectIntent,
  isPendingOpeningObjectIntent,
  openingActionOptionsRequested,
  openingGlobalActionHelpScopeRequested,
  openingObjectActionMentioned,
  openingObjectObservationDirectlyRequested,
  openingObjectSelectionMentioned,
  openingReadExamineActionMentioned,
  openingScopedActionOptionsRequested,
  resolvePendingOpeningContentObjectReply,
  resolvePendingOpeningContextualObjectActionChoiceObject,
  resolvePendingOpeningReadExamineChoiceObject,
  resolveOpeningCommandComparisonQuestion,
  openingCommandHelp,
  resolveOpeningCommandIntent,
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

  it.each([
    "Read the leaflet.",
    "Please read the leaflet.",
    "Can you read the leaflet?",
    "I'd like you to read the leaflet.",
    "I want to read the leaflet.",
    "I'd like to read the leaflet.",
    "I need to read the leaflet.",
  ])("accepts the direct tier-three request %s", (playerUtterance) => {
    expect(
      groundOpeningCommand(
        "read leaflet",
        playerUtterance,
        createOpeningCommandKnowledge({ observedObjects: ["leaflet"] }),
      ),
    ).toMatchObject({ ok: true, command: "read leaflet" });
  });

  it("keeps explicit READ available for every current observed object", () => {
    expect(
      groundOpeningCommand("read mailbox", "Read the mailbox.", knowledge),
    ).toEqual({
      ok: true,
      command: "read mailbox",
      ruleId: "grammar.read",
    });
  });

  it.each([
    "Examine the leaflet without taking it.",
    "Can you examine the leaflet without taking it?",
    "Examine the leaflet without taking it, please.",
  ])(
    "accepts the explicit non-taking EXAMINE request %s",
    (playerUtterance) => {
      expect(
        groundOpeningCommand(
          "examine leaflet",
          playerUtterance,
          createOpeningCommandKnowledge({ observedObjects: ["leaflet"] }),
        ),
      ).toMatchObject({ ok: true, command: "examine leaflet" });
    },
  );

  it.each([
    "What if I READ the leaflet?",
    "Will READ take the leaflet?",
    "Should I read the leaflet?",
    "If I read the leaflet, what happens?",
    "I might read the leaflet.",
    "I wonder what if I read the leaflet.",
    "I said read the leaflet.",
    'The guide said "read the leaflet."',
    '"Read the leaflet."',
    "`Read the leaflet.`",
    "‘Read the leaflet.’",
    "‹Read the leaflet›",
    "「Read the leaflet」",
    "‚Read the leaflet‘",
    "‛Read the leaflet‛",
    "❝Read the leaflet❞",
    "> Read the leaflet.",
    "(Read the leaflet.)",
    "Read the leaflet?",
    "Read anything except the leaflet.",
    "Can you read anything except the leaflet?",
    "Read the leaflet only if it is safe.",
    "Read all but the leaflet.",
    "Read something other than the leaflet.",
    "Read another object instead of the leaflet.",
    "Read the leaflet later.",
    "Read the leaflet when you are ready.",
    "Read the leaflet provided it is safe.",
    "Read the leaflet as long as it is safe.",
    "No read the leaflet.",
    "Read the leaflet without taking it.",
  ])("rejects the non-direct tier-three discussion %s", (playerUtterance) => {
    expect(
      groundOpeningCommand(
        "read leaflet",
        playerUtterance,
        createOpeningCommandKnowledge({ observedObjects: ["leaflet"] }),
      ),
    ).toEqual({ ok: false, code: "not-direct-action-request" });
  });

  it.each([
    ["open mailbox", "Open anything except the mailbox."],
    ["take mailbox", "Take anything but the mailbox."],
  ])("does not retarget %s from the exclusion %s", (command, utterance) => {
    expect(groundOpeningCommand(command, utterance, knowledge)).toEqual({
      ok: false,
      code: "not-direct-action-request",
    });
  });

  it.each(["Pick the mailbox up.", "Can you pick the mailbox up?"])(
    "accepts the separable TAKE request %s",
    (playerUtterance) => {
      expect(
        groundOpeningCommand("take mailbox", playerUtterance, knowledge),
      ).toMatchObject({ ok: true, command: "take mailbox" });
    },
  );

  it.each([
    "Examine all but the leaflet.",
    "I said examine the leaflet.",
    "“Examine the leaflet.”",
    "What if I examine the leaflet?",
  ])("rejects the non-direct EXAMINE discussion %s", (playerUtterance) => {
    expect(
      groundOpeningCommand(
        "examine leaflet",
        playerUtterance,
        createOpeningCommandKnowledge({ observedObjects: ["leaflet"] }),
      ),
    ).toEqual({ ok: false, code: "not-direct-action-request" });
  });

  it.each([
    "Could you look more closely at the mailbox?",
    "Let's take a closer look at the mailbox.",
    "What can you tell me about the mailbox?",
    "Give me a description of the mailbox.",
    "Show me what the mailbox looks like.",
    "Could you check the mailbox out?",
    "Let's see what the mailbox looks like.",
    "Could you look over the mailbox?",
    "Could you tell me what you see on the mailbox?",
    "I want to know more about the mailbox.",
    "How would you describe the mailbox?",
    "What can I see on the mailbox?",
    "Take a good look at the mailbox.",
  ])(
    "recognizes the direct semantic EXAMINE request %s without a phrase allowlist",
    (playerUtterance) => {
      const mailbox = knowledge.observedObjectOptions.find(
        (option) => option.label === "mailbox",
      );
      if (mailbox === undefined) throw new Error("Expected current mailbox.");
      expect(
        openingObjectObservationDirectlyRequested(
          mailbox,
          playerUtterance,
          knowledge,
        ),
      ).toBe(true);
    },
  );

  it.each([
    "What if I check out the mailbox?",
    "If it is safe, check out the mailbox.",
    "The guide suggested checking out the mailbox.",
    "The guide said ‘check out the mailbox.’",
    "I might check out the mailbox.",
    "I wonder whether to look more closely at the mailbox.",
    "Could you open the mailbox?",
    "Can you open up the mailbox?",
    "Could you open the closed mailbox?",
    "I'd like you to open the mailbox carefully.",
    "Let's open up the mailbox.",
    "Could you head north past the mailbox?",
    "How do I open the mailbox?",
    "How do I read the mailbox?",
    "What does opening the mailbox involve?",
    "Can you tell me whether opening the mailbox is safe?",
    "Can you tell me a joke about the mailbox?",
    "I want you to destroy the mailbox.",
    "Can you open the mailbox later?",
    "Would you read the mailbox aloud?",
    "Could you take the mailbox tomorrow?",
    "What does EXAMINE do with the mailbox?",
  ])(
    "rejects the non-direct semantic EXAMINE request %s",
    (playerUtterance) => {
      const mailbox = knowledge.observedObjectOptions.find(
        (option) => option.label === "mailbox",
      );
      if (mailbox === undefined) throw new Error("Expected current mailbox.");
      expect(
        openingObjectObservationDirectlyRequested(
          mailbox,
          playerUtterance,
          knowledge,
        ),
      ).toBe(false);
    },
  );

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

  it("compiles zero-slot and observed-object intents under local risk policy", () => {
    expect(
      resolveOpeningCommandIntent(
        { affordanceId: "grammar.look", slots: [] },
        knowledge,
      ),
    ).toEqual({
      ok: true,
      command: "look",
      ruleId: "grammar.look",
      riskTier: 1,
      semanticFallbackAllowed: true,
    });
    expect(
      resolveOpeningCommandIntent(
        { affordanceId: "grammar.inventory", slots: [] },
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
      resolveOpeningCommandIntent(
        {
          affordanceId: "grammar.examine",
          slots: [{ slotId: "object", valueId: "observed-object:mailbox" }],
        },
        knowledge,
      ),
    ).toEqual({
      ok: true,
      command: "examine mailbox",
      ruleId: "grammar.examine",
      riskTier: 2,
      semanticFallbackAllowed: true,
      selectedObject: {
        id: "observed-object:mailbox",
        label: "mailbox",
      },
    });
    expect(
      resolveOpeningCommandIntent(
        {
          affordanceId: "grammar.open",
          slots: [{ slotId: "object", valueId: "observed-object:mailbox" }],
        },
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
    {
      name: "missing object slot",
      intent: { affordanceId: "grammar.examine", slots: [] },
      code: "missing-slot",
    },
    {
      name: "extra object slot",
      intent: {
        affordanceId: "grammar.examine",
        slots: [
          { slotId: "object", valueId: "observed-object:mailbox" },
          { slotId: "object", valueId: "observed-object:brass token" },
        ],
      },
      code: "unexpected-slot",
    },
    {
      name: "slot on a zero-slot rule",
      intent: {
        affordanceId: "grammar.look",
        slots: [{ slotId: "object", valueId: "observed-object:mailbox" }],
      },
      code: "unexpected-slot",
    },
    {
      name: "unknown slot ID",
      intent: {
        affordanceId: "grammar.examine",
        slots: [{ slotId: "direction", valueId: "observed-object:mailbox" }],
      },
      code: "unexpected-slot",
    },
    {
      name: "unobserved value ID",
      intent: {
        affordanceId: "grammar.examine",
        slots: [{ slotId: "object", valueId: "observed-object:sword" }],
      },
      code: "unknown-slot-value",
    },
    {
      name: "unknown affordance",
      intent: { affordanceId: "grammar.unknown", slots: [] },
      code: "unknown-affordance",
    },
    {
      name: "extra intent field",
      intent: { affordanceId: "grammar.look", slots: [], command: "look" },
      code: "invalid-intent",
    },
    {
      name: "extra slot field",
      intent: {
        affordanceId: "grammar.examine",
        slots: [
          {
            slotId: "object",
            valueId: "observed-object:mailbox",
            label: "mailbox",
          },
        ],
      },
      code: "unexpected-slot",
    },
  ])("rejects an intent with $name", ({ intent, code }) => {
    expect(resolveOpeningCommandIntent(intent, knowledge)).toEqual({
      ok: false,
      code,
    });
  });

  it("verifies that the selected observed-object label is explicit in the utterance", () => {
    const resolved = resolveOpeningCommandIntent(
      {
        affordanceId: "grammar.examine",
        slots: [{ slotId: "object", valueId: "observed-object:mailbox" }],
      },
      knowledge,
    );
    expect(resolved).toMatchObject({ ok: true });
    if (!resolved.ok || resolved.selectedObject === undefined) {
      throw new Error("Expected one selected observed object.");
    }

    expect(
      openingObjectSelectionMentioned(
        resolved.selectedObject,
        "What does the mailbox look like?",
      ),
    ).toBe(true);
    expect(
      openingObjectSelectionMentioned(
        resolved.selectedObject,
        "Let's check out MAILBOX.",
      ),
    ).toBe(true);
    expect(
      openingObjectSelectionMentioned(
        resolved.selectedObject,
        "Let's check out the house.",
      ),
    ).toBe(false);
    expect(
      openingObjectSelectionMentioned(
        resolved.selectedObject,
        "What do the mailboxes look like?",
      ),
    ).toBe(false);
  });

  it.each([
    "What does the leaflet say?",
    "What might the leaflet say?",
    "Tell me what the leaflet says.",
    "What's written on the leaflet?",
    "What is the writing on the leaflet?",
    "What words are on the leaflet?",
    "Tell me the text on the leaflet.",
    "What is the content of the leaflet?",
    "What's in the leaflet?",
    "What's on or in the leaflet?",
    "What is in or on the leaflet?",
    "Could you tell me what's on or in the leaflet?",
    "Please tell me what is on or inside the leaflet.",
    "What information is available on the leaflet?",
    "What does the leaflet contain?",
    "What are the contents of the leaflet?",
    "What is contained in the leaflet?",
    "Show me the contents of the leaflet.",
    "Can you tell me what's in the leaflet?",
    "What is the inscription on the leaflet?",
    "What's printed on the leaflet?",
  ])("identifies the local content ambiguity in %s", (playerUtterance) => {
    const leafletKnowledge = createOpeningCommandKnowledge({
      observedObjects: ["leaflet"],
    });
    expect(
      identifyNonlexicalOpeningContentRequest(
        playerUtterance,
        leafletKnowledge,
      ),
    ).toEqual({ id: "observed-object:leaflet", label: "leaflet" });
  });

  it.each([
    "Read the written leaflet.",
    "Examine the writing on the leaflet.",
    "Take the leaflet with the printed text.",
    "What's written on the leaflet or mailbox?",
    "What's on or in the leaflet and open the mailbox.",
    "What's written on the sword?",
  ])(
    "does not replace the explicit, ambiguous, or unobserved request %s with a local content ambiguity",
    (playerUtterance) => {
      expect(
        identifyNonlexicalOpeningContentRequest(
          playerUtterance,
          createOpeningCommandKnowledge({
            observedObjects: ["leaflet", "mailbox"],
          }),
        ),
      ).toBeUndefined();
    },
  );

  it("revalidates a pending READ/EXAMINE focus and recognizes action-options help", () => {
    const leafletKnowledge = createOpeningCommandKnowledge({
      observedObjects: ["leaflet", "mailbox"],
    });
    const pending = createPendingOpeningReadExamineChoiceIntent({
      id: "observed-object:leaflet",
      label: "leaflet",
    });

    expect(
      resolvePendingOpeningReadExamineChoiceObject(pending, leafletKnowledge),
    ).toEqual({ id: "observed-object:leaflet", label: "leaflet" });
    expect(
      resolvePendingOpeningReadExamineChoiceObject(
        pending,
        createOpeningCommandKnowledge({ observedObjects: ["mailbox"] }),
      ),
    ).toBeUndefined();
    expect(openingActionOptionsRequested("What are the action options?")).toBe(
      true,
    );
    expect(openingActionOptionsRequested("What is inside the leaflet?")).toBe(
      false,
    );
    expect(
      openingScopedActionOptionsRequested("What are the action options?"),
    ).toBe(true);
    expect(openingScopedActionOptionsRequested("What can I do here?")).toBe(
      false,
    );
    expect(
      openingGlobalActionHelpScopeRequested("What options do I have here?"),
    ).toBe(true);
    expect(
      openingGlobalActionHelpScopeRequested("What else can I do around here?"),
    ).toBe(true);
    expect(
      openingGlobalActionHelpScopeRequested("Generally, what are my options?"),
    ).toBe(true);
    expect(
      openingGlobalActionHelpScopeRequested("What can I do with the leaflet?"),
    ).toBe(false);
    expect(
      openingReadExamineActionMentioned(
        "Could you remind me what those choices were?",
      ),
    ).toBe(false);
    expect(openingReadExamineActionMentioned('Did you mean "READ"?')).toBe(
      true,
    );
    expect(openingReadExamineActionMentioned("Should I inspect it?")).toBe(
      true,
    );
    expect(openingObjectActionMentioned("Would OPEN it be useful?")).toBe(true);
    expect(openingObjectActionMentioned("What if I pick it up?")).toBe(true);
    expect(
      openingObjectActionMentioned(
        "Could you remind me what those choices were?",
      ),
    ).toBe(false);
    expect(openingReadExamineActionMentioned("Would OPEN it be useful?")).toBe(
      false,
    );
  });

  it.each(["grammar.examine", "grammar.read"])(
    "does not bind an overlapping shorter object from %s",
    (affordanceId) => {
      expect(
        identifyNonlexicalOpeningReadExamineAmbiguity(
          {
            affordanceId,
            slots: [
              {
                slotId: "object",
                valueId: "observed-object:leaflet",
              },
            ],
          },
          "What is written on the red leaflet?",
          createOpeningCommandKnowledge({
            observedObjects: ["leaflet", "red leaflet"],
          }),
        ),
      ).toBeUndefined();
    },
  );

  it("binds the uniquely mentioned longer overlapping object", () => {
    const overlappingKnowledge = createOpeningCommandKnowledge({
      observedObjects: ["leaflet", "red leaflet"],
    });
    expect(
      identifyNonlexicalOpeningContentRequest(
        "What is written on the red leaflet?",
        overlappingKnowledge,
      ),
    ).toEqual({
      id: "observed-object:red leaflet",
      label: "red leaflet",
    });

    const redLeaflet = overlappingKnowledge.observedObjectOptions.find(
      (option) => option.label === "red leaflet",
    );
    if (redLeaflet === undefined) {
      throw new Error("Expected current red leaflet.");
    }
    expect(
      openingObjectObservationDirectlyRequested(
        redLeaflet,
        "Could you look more closely at the red leaflet?",
        overlappingKnowledge,
      ),
    ).toBe(true);
  });

  it.each([
    [["examine leaflet", "read leaflet"]],
    [["READ the leaflet", "EXAMINE the leaflet"]],
  ])("identifies one current READ/EXAMINE clarification pair %#", (choices) => {
    expect(
      identifyOpeningReadExamineClarificationChoice(
        choices,
        "What information is on the leaflet?",
        createOpeningCommandKnowledge({ observedObjects: ["leaflet"] }),
      ),
    ).toEqual({ id: "observed-object:leaflet", label: "leaflet" });
  });

  it.each([
    ["duplicate action", ["read leaflet", "read leaflet"]],
    ["different current objects", ["examine leaflet", "read mailbox"]],
    ["stale object", ["examine leaflet", "read leaflet"]],
    ["unobserved object", ["examine sword", "read sword"]],
    ["wrong action", ["open leaflet", "read leaflet"]],
    ["extra action", ["examine leaflet", "read leaflet", "take leaflet"]],
    ["overlapping object label", ["examine leaflet", "read leaflet"]],
  ])("rejects a $name clarification pair", (_name, choices) => {
    const observedObjects =
      _name === "stale object"
        ? ["mailbox"]
        : _name === "overlapping object label"
          ? ["leaflet", "red leaflet"]
          : ["leaflet", "mailbox"];
    const utterance =
      _name === "overlapping object label"
        ? "What is written on the red leaflet?"
        : "What information is on the leaflet?";
    expect(
      identifyOpeningReadExamineClarificationChoice(
        choices,
        utterance,
        createOpeningCommandKnowledge({ observedObjects }),
      ),
    ).toBeUndefined();
  });

  it.each([
    {
      affordanceId: "grammar.read",
      playerUtterance: "What's written on the leaflet?",
    },
    {
      affordanceId: "grammar.read",
      playerUtterance: "Tell me what the leaflet says.",
    },
    {
      affordanceId: "grammar.read",
      playerUtterance: "What words are on the leaflet?",
    },
    {
      affordanceId: "grammar.examine",
      playerUtterance: "What's printed on the leaflet?",
    },
    {
      affordanceId: "grammar.examine",
      playerUtterance: "Tell me the text on the leaflet.",
    },
  ])(
    "identifies a nonlexical $affordanceId ambiguity in $playerUtterance",
    ({ affordanceId, playerUtterance }) => {
      const leafletKnowledge = createOpeningCommandKnowledge({
        observedObjects: ["leaflet"],
      });

      expect(
        identifyNonlexicalOpeningReadExamineAmbiguity(
          {
            affordanceId,
            slots: [
              {
                slotId: "object",
                valueId: "observed-object:leaflet",
              },
            ],
          },
          playerUtterance,
          leafletKnowledge,
        ),
      ).toEqual({
        id: "observed-object:leaflet",
        label: "leaflet",
      });
    },
  );

  it.each([
    {
      name: "explicit READ authorization",
      intent: {
        affordanceId: "grammar.read",
        slots: [{ slotId: "object", valueId: "observed-object:leaflet" }],
      },
      playerUtterance: "Read the leaflet.",
      observedObjects: ["leaflet"],
    },
    {
      name: "different selected object",
      intent: {
        affordanceId: "grammar.read",
        slots: [{ slotId: "object", valueId: "observed-object:mailbox" }],
      },
      playerUtterance: "What's written on the leaflet?",
      observedObjects: ["leaflet", "mailbox"],
    },
    {
      name: "unobserved selected object",
      intent: {
        affordanceId: "grammar.read",
        slots: [{ slotId: "object", valueId: "observed-object:leaflet" }],
      },
      playerUtterance: "What's written on the leaflet?",
      observedObjects: ["mailbox"],
    },
    {
      name: "non-READ affordance",
      intent: {
        affordanceId: "grammar.take",
        slots: [{ slotId: "object", valueId: "observed-object:leaflet" }],
      },
      playerUtterance: "What's written on the leaflet?",
      observedObjects: ["leaflet"],
    },
    {
      name: "nonlexical EXAMINE appearance request",
      intent: {
        affordanceId: "grammar.examine",
        slots: [{ slotId: "object", valueId: "observed-object:leaflet" }],
      },
      playerUtterance: "What does the leaflet look like?",
      observedObjects: ["leaflet"],
    },
    {
      name: "nonlexical EXAMINE check-out request",
      intent: {
        affordanceId: "grammar.examine",
        slots: [{ slotId: "object", valueId: "observed-object:leaflet" }],
      },
      playerUtterance: "Let's check out the leaflet.",
      observedObjects: ["leaflet"],
    },
  ])("does not identify a $name as ambiguous", (testCase) => {
    expect(
      identifyNonlexicalOpeningReadAmbiguity(
        testCase.intent,
        testCase.playerUtterance,
        createOpeningCommandKnowledge({
          observedObjects: testCase.observedObjects,
        }),
      ),
    ).toBeUndefined();
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

  it("retains an unresolved content-object request without choosing an action", () => {
    expect(inferPendingOpeningObjectIntent("What does it say?")).toEqual({
      kind: "content-object",
    });
  });

  it.each([
    ["read it", "read"],
    ["please open it", "open"],
    ["pick it up", "take"],
    ["Can you pick it up?", "take"],
  ])("retains the single reviewed object action in %s", (utterance, action) => {
    expect(inferPendingOpeningObjectIntent(utterance)).toEqual({ action });
  });

  it.each([
    "go north",
    "open it and take it",
    "read it and go north",
    "read it or examine it",
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

  it("turns an unresolved content object into one typed current READ/EXAMINE choice", () => {
    const contentIntent = createPendingOpeningContentObjectIntent();
    const selected = resolvePendingOpeningContentObjectReply(
      contentIntent,
      "The brass token",
      knowledge,
    );
    expect(selected).toEqual({
      ok: true,
      selectedObject: {
        id: "observed-object:brass token",
        label: "brass token",
      },
    });
    if (!selected.ok) throw new Error("Expected one current object.");

    const choice = createPendingOpeningReadExamineChoiceIntent(
      selected.selectedObject,
    );
    expect(choice).toEqual({
      kind: "read-examine-choice",
      objectValueId: "observed-object:brass token",
      allowedActions: ["examine", "read"],
    });
    expect(isPendingOpeningObjectIntent(choice)).toBe(true);

    for (const [utterance, command] of [
      ["READ", "read brass token"],
      ["read it", "read brass token"],
      ["Please read it", "read brass token"],
      ["Can you read it?", "read brass token"],
      ["I'd like to read it", "read brass token"],
      ["read it please", "read brass token"],
      ["Okay, read it", "read brass token"],
      ["EXAMINE", "examine brass token"],
      ["examine it", "examine brass token"],
      ["Could you examine it?", "examine brass token"],
      ["Examine it without taking it", "examine brass token"],
      ["Please examine it without taking it", "examine brass token"],
      ["Can you examine it without taking it?", "examine brass token"],
      ["Just examine it without taking it", "examine brass token"],
      ["Examine it without taking it, please", "examine brass token"],
    ] as const) {
      expect(
        groundPendingOpeningReadExamineChoiceReply(
          choice,
          utterance,
          knowledge,
        ),
      ).toMatchObject({ ok: true, command });
    }
  });

  it("stores exactly two canonical suggestions without narrowing explicit object actions", () => {
    const mailbox = knowledge.observedObjectOptions.find(
      (option) => option.label === "mailbox",
    );
    if (mailbox === undefined) throw new Error("Expected current mailbox.");
    const choice = createPendingOpeningContextualObjectActionChoiceIntent(
      mailbox,
      ["open", "examine"],
    );

    expect(choice).toEqual({
      kind: "contextual-object-action-choice",
      objectValueId: "observed-object:mailbox",
      suggestedActions: ["examine", "open"],
    });
    expect(PENDING_OPENING_CONTEXTUAL_OBJECT_ACTIONS).toEqual([
      "examine",
      "open",
      "read",
      "take",
    ]);
    expect(Object.isFrozen(choice)).toBe(true);
    expect(Object.isFrozen(choice.suggestedActions)).toBe(true);
    expect(isPendingOpeningObjectIntent(choice)).toBe(true);
    expect(
      resolvePendingOpeningContextualObjectActionChoiceObject(
        choice,
        knowledge,
      ),
    ).toEqual(mailbox);
    expect(
      resolvePendingOpeningContextualObjectActionChoiceObject(
        choice,
        createOpeningCommandKnowledge({ observedObjects: ["leaflet"] }),
      ),
    ).toBeUndefined();

    for (const [utterance, command] of [
      ["examine it", "examine mailbox"],
      ["open it", "open mailbox"],
      ["read it", "read mailbox"],
      ["take it", "take mailbox"],
    ] as const) {
      expect(
        groundPendingOpeningContextualObjectActionChoiceReply(
          choice,
          utterance,
          knowledge,
        ),
      ).toEqual({
        ok: true,
        command,
        ruleId: `grammar.${command.split(" ")[0]}`,
      });
    }
    expect(
      groundPendingOpeningContextualObjectActionChoiceReply(
        choice,
        "Should I read it?",
        knowledge,
      ),
    ).toEqual({ ok: false, code: "not-direct-action-request" });
  });

  it("rejects malformed contextual suggestion pairs", () => {
    const mailbox = {
      id: "observed-object:mailbox",
      label: "mailbox",
    } as const;
    expect(() =>
      createPendingOpeningContextualObjectActionChoiceIntent(mailbox, [
        "read",
        "read",
      ]),
    ).toThrow(TypeError);
    for (const intent of [
      {
        kind: "contextual-object-action-choice",
        objectValueId: "observed-object:mailbox",
        suggestedActions: ["open", "examine"],
      },
      {
        kind: "contextual-object-action-choice",
        objectValueId: "observed-object:mailbox",
        suggestedActions: ["examine", "examine"],
      },
      {
        kind: "contextual-object-action-choice",
        objectValueId: "observed-object:mailbox",
        suggestedActions: ["examine", "dance"],
      },
      {
        kind: "contextual-object-action-choice",
        objectValueId: "observed-object:mailbox",
        suggestedActions: ["examine", "open", "read"],
      },
    ]) {
      expect(isPendingOpeningObjectIntent(intent)).toBe(false);
    }
  });

  it.each([
    "READ?",
    "Read it?",
    '"READ"',
    "‘Read it.’",
    "Read it only if it will not take it.",
    "Read all but it",
    "Read it later",
    "Read it when you are ready",
    "No read it",
  ])("does not execute the pending choice discussion %s", (utterance) => {
    const choice = createPendingOpeningReadExamineChoiceIntent({
      id: "observed-object:brass token",
      label: "brass token",
    });
    expect(
      groundPendingOpeningReadExamineChoiceReply(choice, utterance, knowledge),
    ).toMatchObject({ ok: false });
  });

  it("fails a pending READ/EXAMINE choice closed without capturing a fresh command", () => {
    const choice = createPendingOpeningReadExamineChoiceIntent({
      id: "observed-object:brass token",
      label: "brass token",
    });
    expect(
      groundPendingOpeningReadExamineChoiceReply(
        choice,
        "read it",
        createOpeningCommandKnowledge({ observedObjects: ["mailbox"] }),
      ),
    ).toEqual({ ok: false, code: "unobserved-object" });
    expect(
      groundPendingOpeningReadExamineChoiceReply(
        choice,
        "open the mailbox",
        knowledge,
      ),
    ).toEqual({ ok: false, code: "not-grounded-in-utterance" });
    expect(
      groundPendingOpeningReadExamineChoiceReply(
        choice,
        "read the mailbox",
        knowledge,
      ),
    ).toEqual({ ok: false, code: "not-grounded-in-utterance" });
    expect(
      groundPendingOpeningReadExamineChoiceReply(
        choice,
        "read it and open the mailbox",
        knowledge,
      ),
    ).toEqual({ ok: false, code: "not-grounded-in-utterance" });
  });

  it.each([
    null,
    { kind: "content-object", action: "read" },
    {
      kind: "read-examine-choice",
      objectValueId: "observed-object:brass token",
      allowedActions: ["read", "examine"],
    },
    {
      kind: "read-examine-choice",
      objectValueId: "observed-object:sword\u0000",
      allowedActions: ["examine", "read"],
    },
  ])("rejects malformed pending state %#", (intent) => {
    expect(isPendingOpeningObjectIntent(intent)).toBe(false);
  });

  it("builds help only from parser grammar and observed object names", () => {
    const help = openingCommandHelp(knowledge);
    expect(help).toBe(
      "You can look, check inventory, or try a direction such as north, south, east, west, up, or down. For things already mentioned—brass token, mailbox—you can try examine, open, read, or take.",
    );
    expect(help).toContain("look");
    expect(help).toContain("brass token");
    expect(help).toContain("mailbox");
    expect(help).not.toMatch(/sword|trapdoor|kitchen/iu);
    expect(Object.isFrozen(knowledge)).toBe(true);
    expect(Object.isFrozen(knowledge.rules)).toBe(true);
    expect(Object.isFrozen(knowledge.observedObjects)).toBe(true);
    expect(Object.isFrozen(knowledge.observedObjectOptions)).toBe(true);
    expect(knowledge.version).toBe(OPENING_AREA_KNOWLEDGE_VERSION);
    expect(knowledge.version).toBe(7);
    expect(knowledge.observedObjectOptions).toEqual([
      {
        id: "observed-object:brass token",
        label: "brass token",
      },
      { id: "observed-object:mailbox", label: "mailbox" },
    ]);
    expect(
      knowledge.rules.find((rule) => rule.id === "grammar.look"),
    ).toMatchObject({
      semanticDescription: expect.any(String),
      riskTier: 1,
      semanticFallbackAllowed: true,
      slots: [],
    });
    const examine = knowledge.rules.find(
      (rule) => rule.id === "grammar.examine",
    );
    expect(examine).toMatchObject({
      riskTier: 2,
      semanticFallbackAllowed: true,
      slots: [
        {
          slotId: "object",
          allowedValueIds: [
            "observed-object:brass token",
            "observed-object:mailbox",
          ],
        },
      ],
    });
    expect(Object.isFrozen(examine?.slots)).toBe(true);
    expect(Object.isFrozen(examine?.slots[0]?.allowedValueIds)).toBe(true);
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
      ["grammar.examine", 2],
    ]);
  });

  it("renders the reviewed READ-versus-EXAMINE comparison from validated sources", () => {
    expect(
      openingCommandHelp(knowledge, ["grammar.read", "grammar.examine"]),
    ).toBe(
      "EXAMINE inspects an observed object without taking it. READ asks the parser to read the object and may implicitly take it.",
    );
    expect(
      openingCommandHelp(knowledge, ["grammar.examine", "grammar.read"]),
    ).toBe(
      "EXAMINE inspects an observed object without taking it. READ asks the parser to read the object and may implicitly take it.",
    );
  });

  it.each([
    "What is the difference between read and examine?",
    "How do READ and EXAMINE differ?",
    "Explain the difference between examine and read.",
    "read versus examine",
    "read vs. examine",
    "Should I read or examine the leaflet?",
    "Can you tell me the difference between read and examine?",
    "Tell me the difference between read and examine.",
    "How exactly does read differ from examine?",
    "Can you compare read and examine?",
    "Please compare read and examine.",
    "Could you explain the difference between read and examine?",
    "Can you tell me how read and examine differ?",
  ])("resolves the bounded command comparison %s", (playerUtterance) => {
    const comparisonKnowledge = playerUtterance.includes("leaflet")
      ? createOpeningCommandKnowledge({ observedObjects: ["leaflet"] })
      : knowledge;
    expect(
      resolveOpeningCommandComparisonQuestion(
        playerUtterance,
        comparisonKnowledge,
      ),
    ).toEqual({
      kind: "resolved",
      sourceIds: ["grammar.examine", "grammar.read"],
    });
  });

  it("resolves an arbitrary offered command pair in canonical rule order", () => {
    expect(
      resolveOpeningCommandComparisonQuestion(
        "Compare take and open.",
        knowledge,
      ),
    ).toEqual({
      kind: "resolved",
      sourceIds: ["grammar.open", "grammar.take"],
    });
  });

  it.each([
    ["What does READ do with the leaflet?", ["grammar.read"]],
    ["Does READ take the leaflet?", ["grammar.read"]],
    ["Does READ implicitly take the leaflet?", ["grammar.read"]],
    [
      "Is READ safer than EXAMINE for the leaflet?",
      ["grammar.examine", "grammar.read"],
    ],
    [
      "Should I read the leaflet instead of examining it?",
      ["grammar.examine", "grammar.read"],
    ],
    [
      "Is READ different from EXAMINE for the leaflet?",
      ["grammar.examine", "grammar.read"],
    ],
    ["Could I read the leaflet?", ["grammar.read"]],
    ["What would happen if I read the leaflet?", ["grammar.read"]],
  ])("resolves the command meta question %s", (playerUtterance, sourceIds) => {
    expect(
      resolveOpeningCommandComparisonQuestion(
        playerUtterance,
        createOpeningCommandKnowledge({ observedObjects: ["leaflet"] }),
      ),
    ).toEqual({ kind: "resolved", sourceIds });
  });

  it.each(["Can you read the leaflet?", "What does the mailbox look like?"])(
    "leaves the direct request %s on the ordinary action path",
    (utterance) => {
      expect(
        resolveOpeningCommandComparisonQuestion(utterance, knowledge),
      ).toEqual({ kind: "not-comparison" });
    },
  );

  it.each([
    "Compare read and dance.",
    "Compare read and read.",
    "Compare read and examine, then open the mailbox.",
    "Compare read, examine, and open.",
    "Compare mailbox with house.",
    "Should I read or dance the mailbox?",
  ])("rejects the invalid command comparison %s", (playerUtterance) => {
    expect(
      resolveOpeningCommandComparisonQuestion(playerUtterance, knowledge),
    ).toEqual({ kind: "invalid" });
  });

  it("leaves ordinary multi-action wording to the normal action policy", () => {
    expect(
      resolveOpeningCommandComparisonQuestion(
        "Open the mailbox and take it.",
        knowledge,
      ),
    ).toEqual({ kind: "not-comparison" });
  });

  it("fails closed on a comparison cue between non-command terms", () => {
    expect(
      resolveOpeningCommandComparisonQuestion(
        "What is the difference between house and mailbox?",
        knowledge,
      ),
    ).toEqual({ kind: "invalid" });
  });

  it("renders other targeted help in canonical rule order with observed context", () => {
    expect(
      openingCommandHelp(knowledge, ["grammar.take", "grammar.look"]),
    ).toBe(
      "LOOK: Describe the player's current location and visible surroundings. TAKE: Take one currently observed object. Observed objects currently available: brass token, mailbox.",
    );
  });

  it("rejects unknown or empty targeted command-help sources", () => {
    expect(() => openingCommandHelp(knowledge, ["grammar.unknown"])).toThrow(
      TypeError,
    );
    expect(() => openingCommandHelp(knowledge, [])).toThrow(TypeError);
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
