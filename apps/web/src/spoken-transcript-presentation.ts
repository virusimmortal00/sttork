const BASE_WORDS_PER_MINUTE = 170;
const MIN_WORD_INTERVAL_MS = 180;
const MAX_WORD_INTERVAL_MS = 560;
const LINE_SETTLE_MS = 260;
const HISTORY_LIMIT = 6;
export type SpokenTranscriptRole = "guide" | "narrator";

type ScheduledHandle = number;

export interface SpokenTranscriptElements {
  readonly region: HTMLElement;
  readonly activeLine: HTMLElement;
  readonly history: HTMLOListElement;
}

export interface SpokenTranscriptOptions {
  readonly reducedMotion?: boolean;
  readonly schedule?: (
    callback: () => void,
    delayMs: number,
  ) => ScheduledHandle;
  readonly cancelScheduled?: (handle: ScheduledHandle) => void;
}

export function spokenNarrationLines(text: string): readonly string[] {
  return text
    .split(/\r?\n/u)
    .map((line) => line.trim().replace(/\s+/gu, " "))
    .filter((line) => line.length > 0);
}

export function spokenWordIntervalMs(rate: number): number {
  const safeRate = Number.isFinite(rate)
    ? Math.min(1.25, Math.max(0.75, rate))
    : 1;
  return Math.min(
    MAX_WORD_INTERVAL_MS,
    Math.max(
      MIN_WORD_INTERVAL_MS,
      Math.round(60_000 / (BASE_WORDS_PER_MINUTE * safeRate)),
    ),
  );
}

export class SpokenTranscriptPresentation {
  readonly #elements: SpokenTranscriptElements;
  readonly #reducedMotion: boolean;
  readonly #schedule: (
    callback: () => void,
    delayMs: number,
  ) => ScheduledHandle;
  readonly #cancelScheduled: (handle: ScheduledHandle) => void;
  #handles: ScheduledHandle[] = [];
  #lines: readonly string[] = [];
  #lineIndex = -1;
  #activeWords: readonly string[] = [];
  #revealedWords = 0;
  #role: SpokenTranscriptRole = "narrator";

  public constructor(
    elements: SpokenTranscriptElements,
    options: SpokenTranscriptOptions = {},
  ) {
    this.#elements = elements;
    this.#reducedMotion = options.reducedMotion ?? false;
    this.#schedule =
      options.schedule ??
      ((callback, delayMs) => window.setTimeout(callback, delayMs));
    this.#cancelScheduled =
      options.cancelScheduled ?? ((handle) => window.clearTimeout(handle));
  }

  public start(
    text: string,
    rate: number,
    role: SpokenTranscriptRole = "narrator",
  ): void {
    const lines = spokenNarrationLines(text);
    if (lines.length === 0) return;
    this.#cancelTimers();
    this.#archiveActive();
    this.#lines = lines;
    this.#role = role;
    this.#lineIndex = 0;
    this.#elements.region.hidden = false;
    this.#elements.region.dataset.role = role;
    this.#elements.region.dataset.playbackState = "active";
    this.#elements.activeLine.dataset.role = role;
    this.#showLine(spokenWordIntervalMs(rate));
  }

  public finish(outcome: "complete" | "interrupted" | "failed"): void {
    this.#cancelTimers();
    if (this.#lineIndex < 0) return;
    this.#elements.region.dataset.playbackState = "settled";
    if (outcome !== "complete") {
      this.#removeUnrevealedWords();
      return;
    }
    this.#revealActiveLine();
    while (this.#lineIndex < this.#lines.length - 1) {
      this.#archiveActive();
      this.#lineIndex += 1;
      this.#renderActiveLine(this.#lines[this.#lineIndex] ?? "", true);
    }
  }

  #showLine(intervalMs: number): void {
    const line = this.#lines[this.#lineIndex];
    if (line === undefined) return;
    this.#renderActiveLine(line, this.#reducedMotion);
    if (!this.#reducedMotion) {
      for (let index = 0; index < this.#activeWords.length; index += 1) {
        const handle = this.#schedule(
          () => this.#revealWord(index),
          index * intervalMs,
        );
        this.#handles.push(handle);
      }
    }
    if (this.#lineIndex < this.#lines.length - 1) {
      const handle = this.#schedule(
        () => {
          this.#revealActiveLine();
          this.#archiveActive();
          this.#lineIndex += 1;
          this.#showLine(intervalMs);
        },
        this.#activeWords.length * intervalMs + LINE_SETTLE_MS,
      );
      this.#handles.push(handle);
    }
  }

  #renderActiveLine(line: string, revealImmediately: boolean): void {
    this.#activeWords = line.split(/\s+/u);
    this.#revealedWords = revealImmediately ? this.#activeWords.length : 0;
    this.#elements.activeLine.replaceChildren(
      ...this.#activeWords.map((word, index) => {
        const span = document.createElement("span");
        span.className = "spoken-word";
        if (revealImmediately) span.classList.add("is-visible");
        span.dataset.wordIndex = String(index);
        span.textContent = word;
        return span;
      }),
    );
  }

  #revealWord(index: number): void {
    const word = this.#elements.activeLine.querySelector<HTMLElement>(
      `[data-word-index="${index}"]`,
    );
    word?.classList.add("is-visible");
    this.#revealedWords = Math.max(this.#revealedWords, index + 1);
  }

  #revealActiveLine(): void {
    for (const word of this.#elements.activeLine.querySelectorAll(
      ".spoken-word",
    )) {
      word.classList.add("is-visible");
    }
    this.#revealedWords = this.#activeWords.length;
  }

  #removeUnrevealedWords(): void {
    const visibleText = this.#activeWords
      .slice(0, this.#revealedWords)
      .join(" ");
    this.#activeWords = visibleText.length === 0 ? [] : visibleText.split(" ");
    this.#elements.activeLine.textContent = visibleText;
  }

  #archiveActive(): void {
    const text = this.#activeWords.slice(0, this.#revealedWords).join(" ");
    if (text.length > 0) {
      const row = document.createElement("li");
      row.dataset.role = this.#role;
      row.textContent = text;
      this.#elements.history.prepend(row);
      while (this.#elements.history.children.length > HISTORY_LIMIT) {
        this.#elements.history.lastElementChild?.remove();
      }
      this.#elements.history.scrollTop = 0;
    }
    this.#elements.activeLine.replaceChildren();
    this.#activeWords = [];
    this.#revealedWords = 0;
  }

  #cancelTimers(): void {
    for (const handle of this.#handles) this.#cancelScheduled(handle);
    this.#handles = [];
  }
}
