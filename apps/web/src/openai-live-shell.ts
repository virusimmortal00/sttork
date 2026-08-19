import {
  ScriptedNarrationPort,
  VoiceAudioController,
  type VoiceAudioState,
} from "../../../packages/audio/src/index.js";
import type { SemanticEvent } from "../../../packages/contracts/src/index.js";
import { EventSequence } from "../../../packages/events/src/index.js";
import {
  initialExperienceProjection,
  reduceExperienceProjection,
  type ExperienceProjectionState,
} from "../../../packages/experience/src/index.js";
import { SemanticTurnCoordinator } from "../../../packages/session/src/index.js";
import {
  BrowserDorkWorkerFactory,
  type DorkBrowserWorkerLike,
} from "../../../spikes/dork-worker/browser-worker-transport.js";
import { DORK_WORKER_BINDING } from "../../../spikes/dork-worker/dork-worker-binding.js";
import { DorkWorkerEngine } from "../../../spikes/dork-worker/dork-worker-engine.js";

import {
  BrowserMicrophoneCapturePort,
  InMemoryCapturedAudioStore,
  OpenAiLiveGuideModel,
  OpenAiLivePlaybackPort,
  OpenAiLiveTranscriber,
} from "./openai-live-audio.js";

const STORY_ID = "zork1-release-119";
const STORY_SHA256 =
  "37084966477dff679282de42974b2077156b1bd68fad92a65d4ea94d8eb64d79";
const STORY_URL = "/vendor/zork1/zork1.z3";

interface LiveSmokeEvidence {
  status: "starting" | "ready" | "failed";
  turns: number;
  finalRevision: number;
  eventTypes: readonly string[];
  transcriptHidden: boolean;
  debugHidden: boolean;
  workerEnvironment?: {
    readonly workerGlobalScope: boolean;
    readonly documentAbsent: boolean;
    readonly windowAbsent: boolean;
  };
  errorCode?: string;
}

declare global {
  interface Window {
    __OPENAI_LIVE_SMOKE__?: LiveSmokeEvidence;
  }
}

function required<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`Missing element #${id}`);
  return element as T;
}

function sessionToken(): string {
  const token = document
    .querySelector<HTMLMetaElement>('meta[name="zork-voice-live-session"]')
    ?.content.trim();
  if (
    token === undefined ||
    token.length < 32 ||
    token.length > 160 ||
    !/^[A-Za-z0-9_-]+$/u.test(token)
  ) {
    throw new Error("Live session initialization failed.");
  }
  return token;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function run(): Promise<void> {
  const token = sessionToken();
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

  function publishEvidence(evidence: LiveSmokeEvidence): void {
    window.__OPENAI_LIVE_SMOKE__ = evidence;
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
        name: `openai-live-dork-${workerCount}`,
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
  const capturedAudio = new InMemoryCapturedAudioStore();
  const capture = new BrowserMicrophoneCapturePort({ store: capturedAudio });
  const transcriber = new OpenAiLiveTranscriber({
    store: capturedAudio,
    sessionToken: token,
  });
  const guide = new OpenAiLiveGuideModel({ sessionToken: token });
  const playback = new OpenAiLivePlaybackPort({ sessionToken: token });

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

  const coordinator = new SemanticTurnCoordinator({
    engine,
    guide,
    narrator: narration,
    events: new EventSequence({
      sessionId: "openai-live-session",
      now: () => new Date(Date.now()).toISOString(),
      nextId: () => `event-${++eventId}`,
    }),
    nextRequestId: () => `request-${++requestId}`,
    nextNarrationId: () => `narration-${++narrationId}`,
    publish,
  });

  const controller = new VoiceAudioController({
    turns: coordinator,
    capture,
    transcriber,
    narration,
    playback,
    nextInteractionId: () => `interaction-${++interactionId}`,
    nextCaptureId: () => `capture-${++captureId}`,
    // These nouns are explicit in the authenticated opening output of the
    // bundled Release 119 story. No hidden map or puzzle state is exposed.
    observedObjects: () => ["mailbox", "house", "door"],
    onState: (state: VoiceAudioState) => {
      captureButton.textContent =
        state === "listening" ? "Finish speaking" : "Start speaking";
      captureButton.setAttribute("aria-pressed", String(state === "listening"));
      captureButton.disabled =
        state === "requesting-microphone" ||
        state === "processing" ||
        state === "guide-speaking" ||
        state === "narrator-speaking" ||
        state === "paused";
      pauseButton.textContent = state === "paused" ? "Resume" : "Pause";
      if (state === "ready") status.textContent = "Ready";
      if (state === "requesting-microphone") {
        status.textContent = "Requesting microphone";
      }
      if (state === "listening") status.textContent = "Listening";
      if (state === "processing") status.textContent = "Processing";
      if (state === "guide-speaking") status.textContent = "Guide speaking";
      if (state === "narrator-speaking") status.textContent = "Narrating";
      if (state === "recoverable-error") {
        status.textContent = "Try again or use text input";
        transcriptPanel.hidden = false;
        transcriptButton.setAttribute("aria-expanded", "true");
        textInput.focus();
      }
    },
    onTurn: () => {
      turns += 1;
    },
  });

  async function updateEvidence(): Promise<void> {
    const state = await engine.inspectPublicState();
    publishEvidence({
      status: "ready",
      turns,
      finalRevision: state.revision,
      eventTypes: canonicalEvents.map((event) => event.type),
      transcriptHidden: transcriptPanel.hidden !== false,
      debugHidden: debugPanel.hidden !== false,
      ...(factory.lastEnvironment === undefined
        ? {}
        : { workerEnvironment: factory.lastEnvironment }),
    });
  }

  async function toggleCapture(): Promise<void> {
    if (controller.state === "listening") {
      await controller.finishCapture();
      await updateEvidence();
    } else if (
      controller.state === "ready" ||
      controller.state === "recoverable-error"
    ) {
      await controller.startCapture();
    }
  }

  function runControl(operation: () => Promise<unknown>): void {
    void operation().catch(() => {
      status.textContent = "Try again";
    });
  }

  captureButton.addEventListener("click", () => runControl(toggleCapture));
  stopButton.addEventListener("click", () =>
    runControl(async () => {
      await controller.stop();
      await updateEvidence();
    }),
  );
  pauseButton.addEventListener("click", () =>
    runControl(async () => {
      if (controller.state === "paused") await controller.resume();
      else await controller.pause();
      await updateEvidence();
    }),
  );
  repeatButton.addEventListener("click", () =>
    runControl(async () => {
      await controller.repeat();
      await updateEvidence();
    }),
  );
  transcriptButton.addEventListener("click", () => {
    transcriptPanel.hidden = !transcriptPanel.hidden;
    transcriptButton.setAttribute(
      "aria-expanded",
      String(!transcriptPanel.hidden),
    );
    runControl(updateEvidence);
  });
  debugButton.addEventListener("click", () => {
    debugPanel.hidden = !debugPanel.hidden;
    debugButton.setAttribute("aria-expanded", String(!debugPanel.hidden));
    runControl(updateEvidence);
  });
  textForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = textInput.value;
    textInput.value = "";
    runControl(async () => {
      await controller.submitText(text);
      await updateEvidence();
    });
  });
  document.addEventListener("keydown", (event) => {
    if (
      event.code === "KeyV" &&
      !event.repeat &&
      event.target === document.body
    ) {
      event.preventDefault();
      runControl(toggleCapture);
    }
    if (event.code === "Escape") runControl(() => controller.stop());
  });

  projection = { ...projection, displayState: "ready", statusText: "Ready" };
  renderProjection();
  captureButton.disabled = false;
  await updateEvidence();
}

void run().catch(() => {
  const status = document.getElementById("status");
  if (status !== null) status.textContent = "Unable to start";
  const evidence: LiveSmokeEvidence = {
    status: "failed",
    turns: 0,
    finalRevision: 0,
    eventTypes: [],
    transcriptHidden: true,
    debugHidden: true,
    errorCode: "startup-failed",
  };
  window.__OPENAI_LIVE_SMOKE__ = evidence;
  document.body.dataset.smokeEvidence = JSON.stringify(evidence);
});
