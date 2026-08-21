import { describe, expect, it } from "vitest";

import {
  SpokenTranscriptPresentation,
  spokenActionText,
  spokenCommandText,
  spokenNarrationLineRole,
  spokenNarrationLines,
  spokenPlayerText,
  spokenWordIntervalMs,
} from "./spoken-transcript-presentation.js";

interface FakeElement {
  readonly dataset: Record<string, string>;
  readonly children: FakeElement[];
  readonly classList: {
    add(name: string): void;
    remove(name: string): void;
    contains(name: string): boolean;
  };
  readonly ownerDocument: { createElement(tag: string): FakeElement };
  readonly lastElementChild: FakeElement | null;
  className: string;
  hidden: boolean;
  scrollTop: number;
  textContent: string;
  attachTo(parent: FakeElement | undefined): void;
  append(...children: FakeElement[]): void;
  prepend(child: FakeElement): void;
  remove(): void;
  replaceChildren(...children: FakeElement[]): void;
}

function fakeDocument(): FakeElement["ownerDocument"] {
  const document = {
    createElement: (): FakeElement => fakeElement(document),
  };
  return document;
}

function fakeElement(document = fakeDocument()): FakeElement {
  const children: FakeElement[] = [];
  const classes = new Set<string>();
  let ownText = "";
  let parent: FakeElement | undefined;
  const element: FakeElement = {
    dataset: {},
    children,
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
    },
    ownerDocument: document,
    className: "",
    hidden: false,
    scrollTop: 0,
    get lastElementChild() {
      return children.at(-1) ?? null;
    },
    get textContent() {
      return children.length === 0
        ? ownText
        : children.map((child) => child.textContent).join(" ");
    },
    set textContent(value: string) {
      ownText = value;
      for (const child of children) child.attachTo(undefined);
      children.splice(0);
    },
    attachTo(nextParent) {
      parent = nextParent;
    },
    append(...nextChildren) {
      for (const child of nextChildren) {
        child.remove();
        children.push(child);
        child.attachTo(element);
      }
    },
    prepend(child) {
      child.remove();
      children.unshift(child);
      child.attachTo(element);
    },
    remove() {
      if (parent === undefined) return;
      const index = parent.children.indexOf(element);
      if (index >= 0) parent.children.splice(index, 1);
      parent = undefined;
    },
    replaceChildren(...nextChildren) {
      for (const child of children) child.attachTo(undefined);
      children.splice(0, children.length, ...nextChildren);
      ownText = "";
      for (const child of nextChildren) child.attachTo(element);
    },
  };
  return element;
}

class ManualScheduler {
  readonly #tasks = new Map<number, () => void>();
  #nextHandle = 0;
  public maximumActive = 0;
  public scheduled = 0;
  public cancelled = 0;
  public readonly delays: number[] = [];

  public readonly schedule = (
    callback: () => void,
    delayMs: number,
  ): number => {
    const handle = ++this.#nextHandle;
    this.#tasks.set(handle, callback);
    this.delays.push(delayMs);
    this.scheduled += 1;
    this.maximumActive = Math.max(this.maximumActive, this.#tasks.size);
    return handle;
  };

  public readonly cancel = (handle: number): void => {
    if (this.#tasks.delete(handle)) this.cancelled += 1;
  };

  public get active(): number {
    return this.#tasks.size;
  }

  public runNext(): void {
    const next = this.#tasks.entries().next().value as
      [number, () => void] | undefined;
    if (next === undefined) return;
    this.#tasks.delete(next[0]);
    next[1]();
  }

  public runAll(limit = 10_000): void {
    let callbacks = 0;
    while (this.#tasks.size > 0) {
      if (++callbacks > limit) throw new Error("Scheduler did not settle.");
      this.runNext();
    }
  }
}

function fixture(
  options: {
    readonly reducedMotion?: boolean;
    readonly now?: () => number;
  } = {},
) {
  const document = fakeDocument();
  const region = fakeElement(document);
  const activeLine = fakeElement(document);
  const history = fakeElement(document);
  const scheduler = new ManualScheduler();
  const subject = new SpokenTranscriptPresentation(
    {
      region: region as unknown as HTMLElement,
      activeLine: activeLine as unknown as HTMLElement,
      history: history as unknown as HTMLOListElement,
    },
    {
      ...(options.reducedMotion === undefined
        ? {}
        : { reducedMotion: options.reducedMotion }),
      ...(options.now === undefined ? {} : { now: options.now }),
      schedule: scheduler.schedule,
      cancelScheduled: scheduler.cancel,
    },
  );
  return { subject, scheduler, region, activeLine, history };
}

describe("spoken transcript presentation", () => {
  it("fades the completed active line before adding it to history", () => {
    const view = fixture();
    view.subject.start("A finished line.", 1, "narrator");
    view.subject.finish("complete");

    expect(view.region.dataset.playbackState).toBe("settling");
    expect(view.activeLine.classList.contains("is-leaving")).toBe(true);
    expect(view.history.children).toHaveLength(0);
    expect(view.scheduler.active).toBe(1);
    expect(view.scheduler.delays.at(-1)).toBe(560);

    view.subject.finish("complete");
    expect(view.scheduler.active).toBe(1);

    view.scheduler.runNext();

    expect(view.region.dataset.playbackState).toBe("settled");
    expect(view.activeLine.children).toHaveLength(0);
    expect(view.history.children).toHaveLength(1);
    expect(view.history.children[0]?.classList.contains("is-arriving")).toBe(
      true,
    );
    expect(view.history.children[0]?.textContent).toBe("A finished line.");
  });

  it("keeps the speaker tag stable between queued lines from the same role", () => {
    const view = fixture();
    view.subject.start("First guide sentence.", 1, "guide");
    view.subject.start("Second guide sentence.", 1, "guide");
    view.subject.finish("complete");

    expect(view.activeLine.classList.contains("is-leaving")).toBe(true);
    expect(view.activeLine.classList.contains("is-speaker-continuing")).toBe(
      true,
    );

    view.scheduler.runNext();

    expect(view.activeLine.dataset.role).toBe("guide");
    expect(view.activeLine.textContent).toBe("Second guide sentence.");
    expect(view.activeLine.classList.contains("is-speaker-continuing")).toBe(
      false,
    );
  });

  it("transitions the speaker tag when the queued role changes", () => {
    const view = fixture();
    view.subject.start("The guide finishes.", 1, "guide");
    view.subject.finish("complete");
    view.subject.start("The narrator begins.", 1, "narrator");

    expect(view.activeLine.classList.contains("is-leaving")).toBe(true);
    expect(view.activeLine.classList.contains("is-speaker-continuing")).toBe(
      false,
    );
  });

  it("replays an existing line without adding another history row", () => {
    const view = fixture();
    view.subject.start("There is a small mailbox here.", 1, "narrator");
    view.subject.finish("complete");
    view.scheduler.runAll();

    expect(view.history.children).toHaveLength(1);

    view.subject.replay("There is a small mailbox here.", 1, "narrator");
    expect(view.activeLine.textContent).toBe("There is a small mailbox here.");
    view.subject.finish("complete");
    view.scheduler.runAll();

    expect(view.activeLine.textContent).toBe("");
    expect(view.history.children).toHaveLength(1);
    expect(view.history.children[0]?.textContent).toBe(
      "There is a small mailbox here.",
    );

    view.subject.replay("There is a small mailbox here.", 1, "narrator");
    view.subject.finish("complete");
    view.scheduler.runAll();

    expect(view.history.children).toHaveLength(1);
  });

  it("keeps a canonical command exact while normalizing visual spacing", () => {
    expect(spokenCommandText("  examine   mailbox  ")).toBe("examine mailbox");
  });

  it("focuses a final player transcript immediately before settling it", () => {
    const view = fixture();
    view.subject.showPlayer("  please   examine the mailbox  ");

    expect(view.activeLine.dataset.role).toBe("player");
    expect(view.activeLine.textContent).toBe("please examine the mailbox");
    expect(
      view.activeLine.children[0]?.children.every((word) =>
        word.classList.contains("is-visible"),
      ),
    ).toBe(true);
    expect(view.scheduler.delays).toEqual([850]);

    view.scheduler.runNext();
    expect(view.activeLine.classList.contains("is-leaving")).toBe(true);
    expect(view.history.children).toHaveLength(0);

    view.scheduler.runNext();
    expect(view.activeLine.textContent).toBe("");
    expect(view.history.children[0]?.dataset.role).toBe("player");
    expect(view.history.children[0]?.textContent).toBe(
      "please examine the mailbox",
    );
  });

  it("queues a committed command behind the briefly focused player line", () => {
    const view = fixture();
    view.subject.showPlayer("Examine the mailbox");
    view.subject.showCommand("examine mailbox");

    expect(view.activeLine.dataset.role).toBe("player");

    view.scheduler.runAll();

    expect(view.activeLine.textContent).toBe("");
    expect(
      view.history.children.map((row) => [row.dataset.role, row.textContent]),
    ).toEqual([
      ["command", "examine mailbox"],
      ["player", "Examine the mailbox"],
    ]);
  });

  it("holds a committed command in focus before dissolving it into history", () => {
    const view = fixture();
    view.subject.showCommand("examine mailbox");

    expect(view.region.dataset.playbackState).toBe("active");
    expect(view.activeLine.dataset.role).toBe("command");
    expect(view.activeLine.textContent).toBe("examine mailbox");
    expect(view.history.children).toHaveLength(0);
    expect(view.scheduler.delays).toEqual([850]);

    view.scheduler.runNext();

    expect(view.region.dataset.playbackState).toBe("settling");
    expect(view.activeLine.classList.contains("is-leaving")).toBe(true);
    expect(view.history.children).toHaveLength(0);

    view.scheduler.runNext();

    expect(view.region.dataset.playbackState).toBe("settled");
    expect(view.activeLine.textContent).toBe("");
    expect(view.history.children[0]?.dataset.role).toBe("command");
    expect(view.history.children[0]?.textContent).toBe("examine mailbox");
  });

  it("retains a fast narration outcome behind player and command focus", () => {
    const view = fixture();
    view.subject.showPlayer("Go north");
    view.subject.showCommand("north");
    view.subject.start("North Room", 1, "narrator");
    view.subject.finish("complete");

    view.scheduler.runAll();

    expect(view.region.dataset.playbackState).toBe("settled");
    expect(view.activeLine.textContent).toBe("");
    expect(
      view.history.children.map((row) => [row.dataset.role, row.textContent]),
    ).toEqual([
      ["narrator", "North Room"],
      ["command", "north"],
      ["player", "Go north"],
    ]);
  });

  it("normalizes player transcript spacing without changing its words", () => {
    expect(spokenPlayerText("  Examine   the mailbox. ")).toBe(
      "Examine the mailbox.",
    );
  });

  it("preserves narration line boundaries while normalizing visual spacing", () => {
    expect(
      spokenNarrationLines(
        "ZORK I: The Great Underground Empire\n\n West   of House \nYou are here.",
      ),
    ).toEqual([
      "ZORK I: The Great Underground Empire",
      "West of House",
      "You are here.",
    ]);
  });

  it("does not promote the standalone Z-machine prompt into narration", () => {
    expect(spokenNarrationLines("The mailbox is closed.\n\n> ")).toEqual([
      "The mailbox is closed.",
    ]);
  });

  it("classifies only standalone parenthetical game output as an action", () => {
    expect(spokenNarrationLineRole("(Taken)", "narrator")).toBe("action");
    expect(
      spokenNarrationLineRole("The leaflet says (Taken).", "narrator"),
    ).toBe("narrator");
    expect(spokenNarrationLineRole("(A guide aside)", "guide")).toBe("guide");
  });

  it("names the implicitly taken command target in the visual action", () => {
    expect(spokenActionText("(Taken)", "read leaflet")).toBe("Took leaflet.");
    expect(spokenActionText("(Taken)", "read the leaflet with care")).toBe(
      "Took the leaflet.",
    );
    expect(spokenActionText("(Taken)", undefined)).toBe("(Taken)");
    expect(spokenActionText("(Already taken)", "read leaflet")).toBe(
      "(Already taken)",
    );
  });

  it("holds an implicit game action in focus before continuing narration", () => {
    const view = fixture();
    view.subject.showCommand("read leaflet");
    view.subject.start('(Taken)\n"WELCOME TO ZORK!"', 1, "narrator");

    view.scheduler.runNext();
    view.scheduler.runNext();

    view.scheduler.runNext();

    expect(view.activeLine.dataset.role).toBe("action");
    expect(view.activeLine.textContent).toBe("Took leaflet.");
    view.scheduler.runNext();
    expect(view.scheduler.delays.at(-1)).toBe(520);

    view.scheduler.runNext();

    expect(view.history.children[0]?.dataset.role).toBe("action");
    expect(view.history.children[0]?.textContent).toBe("Took leaflet.");
    expect(view.activeLine.dataset.role).toBe("narrator");
    expect(view.activeLine.textContent).toBe('"WELCOME TO ZORK!"');
  });

  it("reveals faster and slower voices at a bounded rate-aware cadence", () => {
    expect(spokenWordIntervalMs(1)).toBe(286);
    expect(spokenWordIntervalMs(0.75)).toBeGreaterThan(spokenWordIntervalMs(1));
    expect(spokenWordIntervalMs(1)).toBeGreaterThan(spokenWordIntervalMs(1.25));
    expect(spokenWordIntervalMs(Number.NaN)).toBe(spokenWordIntervalMs(1));
  });

  it("pauses progressive text and resumes with the remaining reveal delay", () => {
    let now = 1_000;
    const view = fixture({ now: () => now });
    view.subject.start("one two three", 1, "narrator");
    view.scheduler.runNext();

    expect(
      view.activeLine.children[0]?.children[0]?.classList.contains(
        "is-visible",
      ),
    ).toBe(true);
    expect(
      view.activeLine.children[0]?.children[1]?.classList.contains(
        "is-visible",
      ),
    ).toBe(false);
    expect(view.scheduler.delays.at(-1)).toBe(286);

    now += 100;
    view.subject.pause();
    expect(view.scheduler.active).toBe(0);
    view.scheduler.runAll();
    expect(
      view.activeLine.children[0]?.children[1]?.classList.contains(
        "is-visible",
      ),
    ).toBe(false);

    view.subject.resume();
    expect(view.scheduler.delays.at(-1)).toBe(186);
    view.scheduler.runNext();
    expect(
      view.activeLine.children[0]?.children[1]?.classList.contains(
        "is-visible",
      ),
    ).toBe(true);
  });

  it("keeps one active callback for maximum-length narration", () => {
    const view = fixture();
    const maximumText = "word ".repeat(800).trim();
    expect(maximumText).toHaveLength(3_999);

    view.subject.start(maximumText, 1, "narrator");

    expect(view.scheduler.active).toBe(1);
    expect(view.scheduler.maximumActive).toBe(1);
    expect(view.activeLine.children).toHaveLength(1);
    expect(view.activeLine.children[0]?.children).toHaveLength(800);
    view.scheduler.runAll();
    expect(view.scheduler.maximumActive).toBe(1);
    expect(view.scheduler.scheduled).toBe(800);
    expect(
      view.activeLine.children[0]?.children.every((word) =>
        word.classList.contains("is-visible"),
      ),
    ).toBe(true);
  });

  it("cancels promptly and retains only words revealed before interruption", () => {
    const view = fixture();
    view.subject.start("one two three four five", 1, "guide");
    view.scheduler.runNext();
    view.scheduler.runNext();
    view.scheduler.runNext();

    view.subject.finish("interrupted");

    expect(view.scheduler.active).toBe(1);
    expect(view.scheduler.cancelled).toBe(1);
    expect(view.activeLine.textContent).toBe("one two three");
    expect(view.region.dataset.playbackState).toBe("settling");

    view.scheduler.runNext();

    expect(view.scheduler.active).toBe(0);
    expect(view.activeLine.children).toEqual([]);
    expect(view.history.children[0]?.textContent).toBe("one two three");
    expect(view.region.dataset.playbackState).toBe("settled");
  });

  it("queues rapid replacement behind the active line with one callback", () => {
    const view = fixture();
    view.subject.start("old one two three", 1, "guide");
    view.scheduler.runNext();
    view.scheduler.runNext();

    view.subject.start("new alpha beta", 1, "narrator");

    expect(view.scheduler.active).toBe(1);
    expect(view.scheduler.maximumActive).toBe(1);
    expect(view.scheduler.cancelled).toBe(0);
    expect(view.history.children).toHaveLength(0);

    view.subject.finish("complete");
    view.scheduler.runNext();

    expect(view.history.children[0]?.textContent).toBe("old one two three");
    expect(view.history.children[0]?.dataset.role).toBe("guide");
    view.scheduler.runAll();
    expect(view.activeLine.textContent).toBe("new alpha beta");
    expect(view.activeLine.dataset.role).toBe("narrator");
  });

  it("retains completion for playback that ends while a prior line fades", () => {
    const view = fixture();
    view.subject.start("first", 1, "guide");
    view.subject.finish("complete");
    view.subject.start("second", 1, "narrator");
    view.subject.finish("complete");

    view.scheduler.runAll();

    expect(view.region.dataset.playbackState).toBe("settled");
    expect(view.activeLine.textContent).toBe("");
    expect(view.history.children.map((row) => row.textContent)).toEqual([
      "second",
      "first",
    ]);
  });

  it("cleans up the sole timer when playback fails before the first reveal", () => {
    const view = fixture();
    view.subject.start("nothing should remain", 1);

    view.subject.finish("failed");

    expect(view.scheduler.active).toBe(1);
    expect(view.scheduler.cancelled).toBe(1);

    view.scheduler.runNext();

    expect(view.scheduler.active).toBe(0);
    expect(view.activeLine.textContent).toBe("");
    expect(view.region.dataset.playbackState).toBe("settled");
  });

  it("reveals reduced-motion narration immediately with six history lines", () => {
    const view = fixture({ reducedMotion: true });
    const lines = Array.from({ length: 8 }, (_, index) => `line ${index + 1}`);

    view.subject.start(lines.join("\n"), 1, "guide");

    expect(view.scheduler.scheduled).toBe(0);
    expect(view.activeLine.textContent).toBe("line 8");
    expect(
      view.activeLine.children[0]?.children.every((word) =>
        word.classList.contains("is-visible"),
      ),
    ).toBe(true);
    expect(view.history.children).toHaveLength(6);
    expect(view.history.children[0]?.textContent).toBe("line 7");
    expect(view.history.children.at(-1)?.textContent).toBe("line 2");
  });
});
