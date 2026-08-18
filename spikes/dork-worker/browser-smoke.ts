import { canonicalizeCommand } from "../../packages/contracts/src/index.js";

import {
  BrowserDorkWorkerFactory,
  type DorkBrowserWorkerLike,
} from "./browser-worker-transport.js";
import { DORK_WORKER_BINDING } from "./dork-worker-binding.js";
import { DorkWorkerEngine } from "./dork-worker-engine.js";

const STORY_ID = "minimal-zmachine-story";
const STORY_SHA256 =
  "67d3a47a48227988a29b2f4111da4cf5cd0efec4a8873d717c9e610984fb7389";
const STORY_URL = "/fixtures/stories/minimal/artifact/minimal.z3";

interface SmokeResult {
  readonly status: "passed" | "failed";
  readonly workerCount?: number;
  readonly environment?: {
    readonly workerGlobalScope: boolean;
    readonly documentAbsent: boolean;
    readonly windowAbsent: boolean;
  };
  readonly snapshotSha256?: string;
  readonly finalRevision?: number;
  readonly userAgent?: string;
  readonly error?: string;
}

interface SmokeHost {
  __DORK_WORKER_SMOKE__?: SmokeResult;
  readonly document: {
    getElementById(id: string): { textContent: string | null } | null;
  };
}

const host = globalThis as unknown as SmokeHost;

function updateStatus(value: string): void {
  const status = host.document.getElementById("status");
  if (status !== null) status.textContent = value;
}

function publishResult(result: SmokeResult): void {
  host.__DORK_WORKER_SMOKE__ = result;
  const evidence = host.document.getElementById("evidence");
  if (evidence !== null) evidence.textContent = JSON.stringify(result);
}

async function digestSha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function run(): Promise<void> {
  const response = await fetch(STORY_URL, { cache: "no-store" });
  if (!response.ok) throw new Error(`story fetch failed: ${response.status}`);
  const storyBytes = new Uint8Array(await response.arrayBuffer());
  if ((await digestSha256(storyBytes)) !== STORY_SHA256) {
    throw new Error("story SHA-256 mismatch");
  }

  let workerCount = 0;
  let initializationId = 0;
  let messageId = 0;
  const factory = new BrowserDorkWorkerFactory({
    createWorker: () => {
      workerCount += 1;
      return new globalThis.Worker(
        new URL("./browser-worker-entry.js", import.meta.url),
        {
          type: "module",
          name: `dork-worker-smoke-${workerCount}`,
        },
      ) as unknown as DorkBrowserWorkerLike;
    },
    nextInitializationId: () => `initialize-${++initializationId}`,
  });
  const engine = new DorkWorkerEngine({
    factory,
    storyBytes,
    binding: DORK_WORKER_BINDING,
    nextMessageId: () => `message-${++messageId}`,
  });

  try {
    const boot = await engine.boot({
      storyId: STORY_ID,
      artifactSha256: STORY_SHA256,
    });
    if (
      boot.boundary !== "input-requested" ||
      !boot.output.includes("Minimal Fixture")
    ) {
      throw new Error("unexpected boot boundary or output");
    }

    const look = await engine.execute({
      requestId: "smoke-look",
      expectedRevision: 0,
      command: canonicalizeCommand("look"),
    });
    const expectedLook =
      "South Room\nA plain room with an exit north.\nA brass token rests on the floor.\n\n> ";
    if (look.status !== "committed" || look.output !== expectedLook) {
      throw new Error("unexpected LOOK result");
    }

    const snapshot = await engine.snapshot();
    const uninterruptedNorth = await engine.execute({
      requestId: "smoke-north",
      expectedRevision: 1,
      command: canonicalizeCommand("north"),
    });
    const restore = await engine.restore(snapshot);
    if (restore.status !== "restored" || restore.output !== "") {
      throw new Error("replacement restore was not silent");
    }

    const replayedLook = await engine.execute({
      requestId: "smoke-look",
      expectedRevision: 0,
      command: canonicalizeCommand("look"),
    });
    if (JSON.stringify(replayedLook) !== JSON.stringify(look)) {
      throw new Error("restored receipt did not replay exactly");
    }
    const restoredNorth = await engine.execute({
      requestId: "smoke-north",
      expectedRevision: 1,
      command: canonicalizeCommand("north"),
    });
    if (JSON.stringify(restoredNorth) !== JSON.stringify(uninterruptedNorth)) {
      throw new Error("cold-restored NORTH diverged from uninterrupted play");
    }

    const corruptBytes = new Uint8Array(snapshot.bytes);
    corruptBytes[0] = corruptBytes[0]! ^ 0xff;
    const rejected = await engine.restore({ ...snapshot, bytes: corruptBytes });
    if (
      rejected.status !== "rejected" ||
      rejected.rejection !== "corrupt_snapshot"
    ) {
      throw new Error("corrupt snapshot was not rejected");
    }
    const south = await engine.execute({
      requestId: "smoke-south",
      expectedRevision: 2,
      command: canonicalizeCommand("south"),
    });
    if (south.status !== "committed" || south.revision !== 3) {
      throw new Error("active worker was not usable after rejected restore");
    }

    const environment = factory.lastEnvironment;
    if (
      environment === undefined ||
      !environment.workerGlobalScope ||
      !environment.documentAbsent ||
      !environment.windowAbsent
    ) {
      throw new Error("Dedicated Worker isolation evidence is incomplete");
    }
    const state = await engine.inspectPublicState();
    publishResult({
      status: "passed",
      workerCount,
      environment,
      snapshotSha256: snapshot.sha256,
      finalRevision: state.revision,
      userAgent: navigator.userAgent,
    });
    updateStatus("PASS");
  } finally {
    engine.dispose();
  }
}

void run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "unknown failure";
  publishResult({ status: "failed", error: message });
  updateStatus(`FAIL: ${message}`);
});
