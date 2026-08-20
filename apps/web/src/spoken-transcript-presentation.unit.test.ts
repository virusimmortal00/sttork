import { describe, expect, it } from "vitest";

import {
  SpokenTranscriptPresentation,
  spokenNarrationLines,
  spokenWordIntervalMs,
} from "./spoken-transcript-presentation.js";

interface FakeElement {
  readonly dataset: Record<string, string>;
  readonly children: FakeElement[];
  readonly classList: {
    add(name: string): void;
    contains(name: string): boolean;
  };
  readonly ownerDocument: { createElement(tag: string): FakeElement };
  readonly lastElementChild: FakeElement | null;
  className: string;
  hidden: boolean;
  scrollTop: number;
  textContent: string;
  attachTo(parent: FakeElement | undefined): void;
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

  public readonly schedule = (callback: () => void): number => {
    const handle = ++this.#nextHandle;
    this.#tasks.set(handle, callback);
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

function fixture(options: { readonly reducedMotion?: boolean } = {}) {
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
      schedule: scheduler.schedule,
      cancelScheduled: scheduler.cancel,
    },
  );
  return { subject, scheduler, region, activeLine, history };
}

describe("spoken transcript presentation", () => {
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

  it("reveals faster and slower voices at a bounded rate-aware cadence", () => {
    expect(spokenWordIntervalMs(0.75)).toBeGreaterThan(spokenWordIntervalMs(1));
    expect(spokenWordIntervalMs(1)).toBeGreaterThan(spokenWordIntervalMs(1.25));
    expect(spokenWordIntervalMs(Number.NaN)).toBe(spokenWordIntervalMs(1));
  });

  it("keeps one active callback for maximum-length narration", () => {
    const view = fixture();
    const maximumText = "word ".repeat(800).trim();
    expect(maximumText).toHaveLength(3_999);

    view.subject.start(maximumText, 1, "narrator");

    expect(view.scheduler.active).toBe(1);
    expect(view.scheduler.maximumActive).toBe(1);
    expect(view.activeLine.children).toHaveLength(800);
    view.scheduler.runAll();
    expect(view.scheduler.maximumActive).toBe(1);
    expect(view.scheduler.scheduled).toBe(800);
    expect(
      view.activeLine.children.every((word) =>
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

    expect(view.scheduler.active).toBe(0);
    expect(view.scheduler.cancelled).toBe(1);
    expect(view.activeLine.textContent).toBe("one two three");
    expect(view.activeLine.children).toEqual([]);
    expect(view.region.dataset.playbackState).toBe("settled");
  });

  it("cancels stale work and archives only the revealed prefix on rapid replacement", () => {
    const view = fixture();
    view.subject.start("old one two three", 1, "guide");
    view.scheduler.runNext();
    view.scheduler.runNext();

    view.subject.start("new alpha beta", 1, "narrator");

    expect(view.scheduler.active).toBe(1);
    expect(view.scheduler.maximumActive).toBe(1);
    expect(view.scheduler.cancelled).toBe(1);
    expect(view.history.children[0]?.textContent).toBe("old one");
    expect(view.history.children[0]?.dataset.role).toBe("guide");
    view.scheduler.runAll();
    expect(view.activeLine.textContent).toBe("new alpha beta");
    expect(view.activeLine.dataset.role).toBe("narrator");
  });

  it("cleans up the sole timer when playback fails before the first reveal", () => {
    const view = fixture();
    view.subject.start("nothing should remain", 1);

    view.subject.finish("failed");

    expect(view.scheduler.active).toBe(0);
    expect(view.scheduler.cancelled).toBe(1);
    expect(view.activeLine.textContent).toBe("");
  });

  it("reveals reduced-motion narration immediately with six history lines", () => {
    const view = fixture({ reducedMotion: true });
    const lines = Array.from({ length: 8 }, (_, index) => `line ${index + 1}`);

    view.subject.start(lines.join("\n"), 1, "guide");

    expect(view.scheduler.scheduled).toBe(0);
    expect(view.activeLine.textContent).toBe("line 8");
    expect(
      view.activeLine.children.every((word) =>
        word.classList.contains("is-visible"),
      ),
    ).toBe(true);
    expect(view.history.children).toHaveLength(6);
    expect(view.history.children[0]?.textContent).toBe("line 7");
    expect(view.history.children.at(-1)?.textContent).toBe("line 2");
  });
});
