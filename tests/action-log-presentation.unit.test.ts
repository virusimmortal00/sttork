import { describe, expect, it } from "vitest";

import { applyActionLogPresentation } from "../apps/web/src/action-log-presentation.js";
import type {
  ActionLogItemProjection,
  CommandCueProjection,
} from "../packages/experience/src/index.js";

interface FakeElement {
  className: string;
  readonly dataset: Record<string, string>;
  readonly attributes: Map<string, string>;
  readonly children: FakeElement[];
  textContent: string | null;
  hidden: boolean;
  scrollTop: number;
  replaceWrites: number;
  readonly ownerDocument: { createElement(tag: string): FakeElement };
  setAttribute(name: string, value: string): void;
  append(...children: FakeElement[]): void;
  replaceChildren(...children: FakeElement[]): void;
}

function fakeElement(): FakeElement {
  const document = {
    createElement: (): FakeElement => create(document),
  };
  return create(document);
}

function create(document: FakeElement["ownerDocument"]): FakeElement {
  const children: FakeElement[] = [];
  return {
    className: "",
    dataset: {},
    attributes: new Map(),
    children,
    textContent: null,
    hidden: false,
    scrollTop: 0,
    replaceWrites: 0,
    ownerDocument: document,
    setAttribute(name, value) {
      this.attributes.set(name, value);
    },
    append(...nextChildren) {
      children.push(...nextChildren);
    },
    replaceChildren(...nextChildren) {
      this.replaceWrites += 1;
      children.splice(0, children.length, ...nextChildren);
    },
  };
}

function action(
  requestId: string,
  command: string,
  throughSequence: number,
): ActionLogItemProjection {
  return {
    requestId,
    correlationId: `correlation-${requestId}`,
    command,
    phase: "committed",
    sourceEventIds: [`event-${throughSequence}`],
    throughSequence,
  };
}

function requestedCommand(): CommandCueProjection {
  return {
    requestId: "request-3",
    correlationId: "correlation-request-3",
    command: "read leaflet",
    phase: "requested",
    sourceEventIds: ["event-5"],
    throughSequence: 5,
  };
}

describe("action log presentation", () => {
  it("renders one bright requested row over muted committed history", () => {
    const element = fakeElement();
    const actions = [
      action("request-2", "open mailbox", 4),
      action("request-1", "look", 2),
    ];
    const requested = requestedCommand();

    applyActionLogPresentation(
      actions,
      requested,
      element as unknown as HTMLOListElement,
    );

    expect(element.hidden).toBe(false);
    expect(element.replaceWrites).toBe(1);
    expect(element.children).toHaveLength(3);
    expect(
      element.children.some((row) => row.attributes.has("aria-current")),
    ).toBe(false);
    expect(element.children[0]?.dataset.state).toBe("requested");
    expect(element.children[0]?.attributes.get("role")).toBe("listitem");
    expect(element.children[0]?.children[0]?.textContent).toBe("read leaflet");
    expect(element.children[0]?.children).toHaveLength(1);
    expect(element.children[1]?.dataset.state).toBe("committed");
    expect(element.children[1]?.children[0]?.textContent).toBe("open mailbox");
    expect(element.children[1]?.children).toHaveLength(1);

    element.scrollTop = 24;
    applyActionLogPresentation(
      actions,
      requested,
      element as unknown as HTMLOListElement,
    );
    expect(element.replaceWrites).toBe(1);
    expect(element.scrollTop).toBe(24);

    applyActionLogPresentation(
      [action("request-3", "read leaflet", 6), ...actions],
      { ...requested, phase: "committed", throughSequence: 6 },
      element as unknown as HTMLOListElement,
    );
    expect(element.replaceWrites).toBe(2);
    expect(element.scrollTop).toBe(0);
    expect(element.children).toHaveLength(3);
    expect(element.children[0]?.dataset.state).toBe("committed");
    expect(element.children[0]?.children[0]?.textContent).toBe("read leaflet");
    expect(element.children[0]?.children).toHaveLength(1);
  });

  it("hides an empty history", () => {
    const element = fakeElement();
    applyActionLogPresentation(
      [],
      undefined,
      element as unknown as HTMLOListElement,
    );
    expect(element.hidden).toBe(true);
    expect(element.children).toEqual([]);
  });
});
