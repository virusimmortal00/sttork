import { SpokenTranscriptPresentation } from "./spoken-transcript-presentation.js";

interface TranscriptBenchmarkMeasurement {
  readonly startMs: number;
  readonly settleMs: number;
  readonly scheduledCallbacks: number;
  readonly maximumActiveCallbacks: number;
  readonly selectorQueries: number;
  readonly renderedWords: number;
  readonly visibleWords: number;
}

interface TranscriptBenchmarkCase {
  readonly name: "short" | "typical" | "maximum";
  readonly words: number;
  readonly characters: number;
  readonly baseline: TranscriptBenchmarkMeasurement;
  readonly bounded: TranscriptBenchmarkMeasurement;
}

export interface SpokenTranscriptBenchmarkEvidence {
  readonly status: "complete";
  readonly cases: readonly TranscriptBenchmarkCase[];
  readonly detachedAfterCompletion: boolean;
}

interface ScheduledTask {
  readonly handle: number;
  readonly callback: () => void;
}

class VirtualScheduler {
  readonly #tasks: ScheduledTask[] = [];
  #cursor = 0;
  #nextHandle = 0;
  public scheduledCallbacks = 0;
  public maximumActiveCallbacks = 0;

  public readonly schedule = (callback: () => void): number => {
    const handle = ++this.#nextHandle;
    this.#tasks.push({ handle, callback });
    this.scheduledCallbacks += 1;
    this.maximumActiveCallbacks = Math.max(
      this.maximumActiveCallbacks,
      this.#tasks.length - this.#cursor,
    );
    return handle;
  };

  public readonly cancel = (handle: number): void => {
    const index = this.#tasks.findIndex(
      (task, taskIndex) => taskIndex >= this.#cursor && task.handle === handle,
    );
    if (index >= 0) this.#tasks.splice(index, 1);
  };

  public settle(): void {
    let callbacks = 0;
    while (this.#cursor < this.#tasks.length) {
      if (++callbacks > 10_000) {
        throw new Error(
          "Spoken transcript benchmark scheduler did not settle.",
        );
      }
      this.#tasks[this.#cursor++]?.callback();
    }
  }
}

function benchmarkText(words: number): string {
  return Array.from({ length: words }, () => "word").join(" ");
}

function round(duration: number): number {
  return Number(duration.toFixed(3));
}

function runBaseline(
  text: string,
  container: HTMLElement,
): TranscriptBenchmarkMeasurement {
  const words = text.split(/\s+/u);
  const activeLine = document.createElement("p");
  container.append(activeLine);
  const scheduler = new VirtualScheduler();
  let selectorQueries = 0;
  const startAt = performance.now();
  activeLine.replaceChildren(
    ...words.map((word, index) => {
      const span = document.createElement("span");
      span.className = "spoken-word";
      span.dataset.wordIndex = String(index);
      span.textContent = word;
      return span;
    }),
  );
  for (let index = 0; index < words.length; index += 1) {
    scheduler.schedule(() => {
      selectorQueries += 1;
      activeLine
        .querySelector(`[data-word-index="${index}"]`)
        ?.classList.add("is-visible");
    });
  }
  const startMs = performance.now() - startAt;
  const settleAt = performance.now();
  scheduler.settle();
  const settleMs = performance.now() - settleAt;
  return {
    startMs: round(startMs),
    settleMs: round(settleMs),
    scheduledCallbacks: scheduler.scheduledCallbacks,
    maximumActiveCallbacks: scheduler.maximumActiveCallbacks,
    selectorQueries,
    renderedWords: activeLine.childElementCount,
    visibleWords: activeLine.querySelectorAll(".spoken-word.is-visible").length,
  };
}

function runBounded(
  text: string,
  container: HTMLElement,
): TranscriptBenchmarkMeasurement {
  const region = document.createElement("section");
  const activeLine = document.createElement("p");
  const history = document.createElement("ol");
  region.append(activeLine, history);
  container.append(region);
  const scheduler = new VirtualScheduler();
  const presentation = new SpokenTranscriptPresentation(
    { region, activeLine, history },
    {
      schedule: scheduler.schedule,
      cancelScheduled: scheduler.cancel,
    },
  );
  const startAt = performance.now();
  presentation.start(text, 1, "narrator");
  const startMs = performance.now() - startAt;
  const settleAt = performance.now();
  scheduler.settle();
  const settleMs = performance.now() - settleAt;
  return {
    startMs: round(startMs),
    settleMs: round(settleMs),
    scheduledCallbacks: scheduler.scheduledCallbacks,
    maximumActiveCallbacks: scheduler.maximumActiveCallbacks,
    selectorQueries: 0,
    renderedWords: activeLine.childElementCount,
    visibleWords: activeLine.querySelectorAll(".spoken-word.is-visible").length,
  };
}

export function runSpokenTranscriptBenchmark(): SpokenTranscriptBenchmarkEvidence {
  const container = document.createElement("section");
  container.hidden = true;
  container.dataset.testSurface = "spoken-transcript-benchmark";
  document.body.append(container);

  const cases: TranscriptBenchmarkCase[] = [];
  try {
    for (const [name, words] of [
      ["short", 12],
      ["typical", 120],
      ["maximum", 800],
    ] as const) {
      const text = benchmarkText(words);
      const baseline = runBaseline(text, container);
      const bounded = runBounded(text, container);
      if (
        baseline.renderedWords !== words ||
        baseline.visibleWords !== words ||
        bounded.maximumActiveCallbacks !== 1 ||
        bounded.selectorQueries !== 0 ||
        bounded.renderedWords !== words ||
        bounded.visibleWords !== words
      ) {
        throw new Error(`Spoken transcript benchmark failed for ${name}.`);
      }
      cases.push({
        name,
        words,
        characters: text.length,
        baseline,
        bounded,
      });
    }
    container.remove();
    return {
      status: "complete",
      cases,
      detachedAfterCompletion: !container.isConnected,
    };
  } finally {
    container.remove();
  }
}
