import {
  ScriptedCapturePort,
  ScriptedNarrationPort,
  ScriptedPlaybackPort,
  ScriptedTranscriber,
  VirtualAudioClock,
  VoiceAudioController,
  type ScriptedClip,
  type VoiceAudioState,
} from "../../../packages/audio/src/index.js";
import type { SemanticEvent } from "../../../packages/contracts/src/index.js";
import { EventSequence } from "../../../packages/events/src/index.js";
import {
  initialExperienceProjection,
  reduceExperienceProjection,
  type ExperienceProjectionState,
} from "../../../packages/experience/src/index.js";
import { FakeGuideModel } from "../../../packages/guide-core/src/index.js";
import { SemanticTurnCoordinator } from "../../../packages/session/src/index.js";
import {
  BrowserDorkWorkerFactory,
  type DorkBrowserWorkerLike,
} from "../../../spikes/dork-worker/browser-worker-transport.js";
import { DORK_WORKER_BINDING } from "../../../spikes/dork-worker/dork-worker-binding.js";
import { DorkWorkerEngine } from "../../../spikes/dork-worker/dork-worker-engine.js";

const STORY_ID = "minimal-zmachine-story";
const STORY_SHA256 =
  "67d3a47a48227988a29b2f4111da4cf5cd0efec4a8873d717c9e610984fb7389";
const STORY_URL = "/fixtures/stories/minimal/artifact/minimal.z3";

const clips: readonly ScriptedClip[] = [
  {
    clipId: "north",
    durationMs: 720,
    transcript: { text: "please head north", confidence: 0.99 },
  },
  {
    clipId: "ambiguous",
    durationMs: 560,
    transcript: { text: "open it", confidence: 0.96 },
  },
  {
    clipId: "help",
    durationMs: 610,
    transcript: { text: "what can I do?", confidence: 0.98 },
  },
  { clipId: "silence", durationMs: 500 },
];

interface SmokeEvidence {
  status: "starting" | "ready" | "failed";
  turns: number;
  finalRevision: number;
  eventTypes: readonly string[];
  playback: readonly { readonly role: string; readonly text: string }[];
  transcriptHidden: boolean;
  debugHidden: boolean;
  workerEnvironment?: {
    readonly workerGlobalScope: boolean;
    readonly documentAbsent: boolean;
    readonly windowAbsent: boolean;
  };
  error?: string;
}

declare global {
  interface Window {
    __VOICE_SHELL_SMOKE__?: SmokeEvidence;
  }
}

function required<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`Missing element #${id}`);
  return element as T;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function run(): Promise<void> {
  const status = required<HTMLElement>("status");
  const captureButton = required<HTMLButtonElement>("capture");
  const stopButton = required<HTMLButtonElement>("stop");
  const pauseButton = required<HTMLButtonElement>("pause");
  const repeatButton = required<HTMLButtonElement>("repeat");
  const transcriptButton = required<HTMLButtonElement>("toggle-transcript");
  const debugButton = required<HTMLButtonElement>("toggle-debug");
  const transcriptPanel = required<HTMLElement>("transcript-panel");
  const transcriptList = required<HTMLOListElement>("transcript-list");
  const debugPanel = required<HTMLElement>("debug-panel");
  const textForm = required<HTMLFormElement>("text-form");
  const textInput = required<HTMLInputElement>("text-input");

  function publishEvidence(evidence: SmokeEvidence): void {
    window.__VOICE_SHELL_SMOKE__ = evidence;
    document.body.dataset.smokeEvidence = JSON.stringify(evidence);
  }

  const storyResponse = await fetch(STORY_URL, { cache: "no-store" });
  if (!storyResponse.ok) throw new Error("Story fetch failed.");
  const storyBytes = new Uint8Array(await storyResponse.arrayBuffer());
  if ((await sha256(storyBytes)) !== STORY_SHA256) {
    throw new Error("Story authentication failed.");
  }

  let workerCount = 0;
  let initialization = 0;
  let message = 0;
  const factory = new BrowserDorkWorkerFactory({
    createWorker: () => {
      workerCount += 1;
      return new Worker("/worker/spikes/dork-worker/browser-worker-entry.js", {
        type: "module",
        name: `voice-shell-dork-${workerCount}`,
      }) as unknown as DorkBrowserWorkerLike;
    },
    nextInitializationId: () => `initialize-${++initialization}`,
  });
  const engine = new DorkWorkerEngine({
    factory,
    storyBytes,
    binding: DORK_WORKER_BINDING,
    nextMessageId: () => `message-${++message}`,
  });
  await engine.boot({ storyId: STORY_ID, artifactSha256: STORY_SHA256 });

  let projection: ExperienceProjectionState = initialExperienceProjection();
  const canonicalEvents: SemanticEvent[] = [];
  let turns = 0;
  let eventId = 0;
  let requestId = 0;
  let narrationId = 0;
  let interactionId = 0;
  let captureId = 0;
  const narration = new ScriptedNarrationPort();
  const clock = new VirtualAudioClock();
  const playback = new ScriptedPlaybackPort(clock);

  function renderProjection(): void {
    status.textContent = projection.statusText;
    transcriptList.replaceChildren(
      ...projection.transcript.map((item) => {
        const row = document.createElement("li");
        row.dataset.role = item.role;
        row.textContent = `${item.role}: ${item.text}`;
        return row;
      }),
    );
    debugPanel.textContent = JSON.stringify(
      {
        throughSequence: projection.throughSequence,
        events: projection.debug,
      },
      null,
      2,
    );
  }

  function publish(event: SemanticEvent): void {
    canonicalEvents.push(event);
    projection = reduceExperienceProjection(projection, event);
    renderProjection();
  }

  const guide = new FakeGuideModel((input) => {
    const utterance = input.playerUtterance.toLocaleLowerCase("en-US");
    if (utterance.includes("what can")) {
      return {
        kind: "explain",
        response: "provider prose is replaced",
        basis: "command-help",
        sourceIds: ["grammar.look", "grammar.direction.north"],
      };
    }
    if (utterance.includes("open it")) {
      return {
        kind: "clarify",
        question: "What would you like me to open?",
        ambiguity: "The pronoun has no unique observed referent.",
      };
    }
    return {
      kind: "execute",
      command: "north",
      intentSummary: "Move north",
      confidence: 0.99,
    };
  });

  const coordinator = new SemanticTurnCoordinator({
    engine,
    guide,
    narrator: narration,
    events: new EventSequence({
      sessionId: "voice-shell-session",
      now: () => new Date(1_787_081_400_000 + eventId).toISOString(),
      nextId: () => `event-${++eventId}`,
    }),
    nextRequestId: () => `request-${++requestId}`,
    nextNarrationId: () => `narration-${++narrationId}`,
    publish,
  });

  const controller = new VoiceAudioController({
    turns: coordinator,
    capture: new ScriptedCapturePort(clips),
    transcriber: new ScriptedTranscriber(clips),
    narration,
    playback,
    nextInteractionId: () => `interaction-${++interactionId}`,
    nextCaptureId: () => `capture-${++captureId}`,
    observedObjects: () => ["token"],
    onState: (state: VoiceAudioState) => {
      captureButton.textContent =
        state === "listening" ? "Finish speaking" : "Start speaking";
      captureButton.setAttribute("aria-pressed", String(state === "listening"));
      const busy =
        state === "processing" ||
        state === "guide-speaking" ||
        state === "narrator-speaking" ||
        state === "paused";
      captureButton.disabled = busy;
      pauseButton.textContent = state === "paused" ? "Resume" : "Pause";
      if (state === "ready") status.textContent = "Ready";
      if (state === "listening") status.textContent = "Listening";
      if (state === "processing") status.textContent = "Processing";
    },
    onTurn: () => {
      turns += 1;
    },
  });

  function updateEvidence(): void {
    void engine.inspectPublicState().then((state) => {
      publishEvidence({
        status: "ready",
        turns,
        finalRevision: state.revision,
        eventTypes: canonicalEvents.map((event) => event.type),
        playback: playback.records.map(({ role, text }) => ({ role, text })),
        transcriptHidden: transcriptPanel.hidden !== false,
        debugHidden: debugPanel.hidden !== false,
        ...(factory.lastEnvironment === undefined
          ? {}
          : { workerEnvironment: factory.lastEnvironment }),
      });
    });
  }

  async function toggleCapture(): Promise<void> {
    if (controller.state === "listening") {
      await controller.finishCapture();
      updateEvidence();
    } else if (controller.state === "ready") {
      await controller.startCapture();
    }
  }

  captureButton.addEventListener("click", () => void toggleCapture());
  stopButton.addEventListener("click", () => {
    void controller.stop().then(updateEvidence);
  });
  pauseButton.addEventListener("click", () => {
    void (
      controller.state === "paused" ? controller.resume() : controller.pause()
    ).then(updateEvidence);
  });
  repeatButton.addEventListener("click", () => {
    void controller.repeat().then(updateEvidence);
  });
  transcriptButton.addEventListener("click", () => {
    transcriptPanel.hidden = !transcriptPanel.hidden;
    transcriptButton.setAttribute(
      "aria-expanded",
      String(!transcriptPanel.hidden),
    );
    updateEvidence();
  });
  debugButton.addEventListener("click", () => {
    debugPanel.hidden = !debugPanel.hidden;
    debugButton.setAttribute("aria-expanded", String(!debugPanel.hidden));
    updateEvidence();
  });
  textForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = textInput.value;
    textInput.value = "";
    void controller.submitText(text).then(updateEvidence);
  });
  document.addEventListener("keydown", (event) => {
    if (
      event.code === "KeyV" &&
      !event.repeat &&
      event.target === document.body
    ) {
      event.preventDefault();
      void toggleCapture();
    }
    if (event.code === "Escape") void controller.stop();
  });

  projection = { ...projection, displayState: "ready", statusText: "Ready" };
  renderProjection();
  captureButton.disabled = false;
  publishEvidence({
    status: "ready",
    turns: 0,
    finalRevision: 0,
    eventTypes: [],
    playback: [],
    transcriptHidden: true,
    debugHidden: true,
    ...(factory.lastEnvironment === undefined
      ? {}
      : { workerEnvironment: factory.lastEnvironment }),
  });
}

void run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown failure";
  const status = document.getElementById("status");
  if (status !== null) status.textContent = "Unable to start";
  const evidence: SmokeEvidence = {
    status: "failed",
    turns: 0,
    finalRevision: 0,
    eventTypes: [],
    playback: [],
    transcriptHidden: true,
    debugHidden: true,
    error: message,
  };
  window.__VOICE_SHELL_SMOKE__ = evidence;
  document.body.dataset.smokeEvidence = JSON.stringify(evidence);
});
