import { readFile } from "node:fs/promises";

import { canonicalizeCommand } from "@sttork/contracts";
import * as gameEnginePublicApi from "../packages/game-engine/src/index.js";
import {
  DorkCandidateSession,
  DorkCandidateSessionStateError,
} from "../spikes/dork-worker/dork-candidate-session.js";
import {
  decodeDorkCheckpointEnvelope,
  encodeDorkCheckpointEnvelope,
} from "../spikes/dork-worker/checkpoint-envelope.js";
import { describe, expect, it } from "vitest";

const minimalStoryUrl = new URL(
  "../fixtures/stories/minimal/artifact/minimal.z3",
  import.meta.url,
);
const zorkStoryUrl = new URL("../vendor/zork1/zork1.z3", import.meta.url);

async function story(url: URL): Promise<Uint8Array> {
  return new Uint8Array(await readFile(url));
}

describe("pinned Dork candidate turn seam", () => {
  it("stays outside the production game-engine public API", () => {
    expect(gameEnginePublicApi).not.toHaveProperty("DorkCandidateSession");
  });

  it("keeps boot, commands, parser errors, and termination in separate turns", async () => {
    const session = new DorkCandidateSession(await story(minimalStoryUrl), {
      seed: 7,
    });

    const boot = await session.boot();
    expect(boot.boundary).toBe("input-requested");
    expect(boot.output).toContain("Minimal Fixture");
    expect(boot.output).toContain("South Room");
    expect(boot.output).toMatch(/> $/u);

    const look = await session.execute(canonicalizeCommand("look"));
    expect(look.boundary).toBe("input-requested");
    expect(look.output).toBe(
      "South Room\nA plain room with an exit north.\nA brass token rests on the floor.\n\n> ",
    );

    const rejected = await session.execute(canonicalizeCommand("sing loudly"));
    expect(rejected.boundary).toBe("input-requested");
    expect(rejected.output).toBe("I do not understand that command.\n\n> ");

    const terminated = await session.execute(canonicalizeCommand("quit"));
    expect(terminated).toEqual({
      output: "Session ended.\n",
      turnComplete: true,
      boundary: "terminated",
    });
    await expect(
      session.execute(canonicalizeCommand("look")),
    ).rejects.toBeInstanceOf(DorkCandidateSessionStateError);
    await expect(session.snapshot()).rejects.toThrow(
      "can only snapshot at an input boundary",
    );
  });

  it("does not consume the pending input boundary when a command is too long", async () => {
    const session = new DorkCandidateSession(await story(minimalStoryUrl));
    await session.boot();

    await expect(
      session.execute(canonicalizeCommand("x".repeat(60))),
    ).rejects.toThrow("exceeds the story input limit 59");

    const recovered = await session.execute(canonicalizeCommand("look"));
    expect(recovered.boundary).toBe("input-requested");
    expect(recovered.output).toContain("South Room");
  });

  it("persists the securely generated reseed stream when none is supplied", async () => {
    const storyBytes = await story(minimalStoryUrl);
    const session = new DorkCandidateSession(storyBytes);
    await session.boot();
    const checkpoint = await session.snapshot();
    const reseedState =
      decodeDorkCheckpointEnvelope(checkpoint).machine.reseedState;
    expect(reseedState).toBeGreaterThanOrEqual(0);
    expect(reseedState).toBeLessThanOrEqual(0xffff_ffff);

    const restored = await DorkCandidateSession.restoreFromSnapshot(
      storyBytes,
      checkpoint,
    );
    expect(
      decodeDorkCheckpointEnvelope(await restored.snapshot()).machine
        .reseedState,
    ).toBe(reseedState);
  });

  it("keeps fifty alternating movement turns complete and non-leaking", async () => {
    const session = new DorkCandidateSession(await story(minimalStoryUrl), {
      seed: 11,
    });
    await session.boot();

    for (let index = 0; index < 50; index += 1) {
      const goingNorth = index % 2 === 0;
      const turn = await session.execute(
        canonicalizeCommand(goingNorth ? "north" : "south"),
      );
      expect(turn.boundary).toBe("input-requested");
      expect(turn.output).toBe(
        goingNorth
          ? "North Room\nA quiet room with an exit south.\n\n> "
          : "South Room\nA plain room with an exit north.\nA brass token rests on the floor.\n\n> ",
      );
    }

    const terminated = await session.execute(canonicalizeCommand("quit"));
    expect(terminated.boundary).toBe("terminated");
  });

  it("rejects non-version-3 stories before construction", async () => {
    const unsupported = await story(minimalStoryUrl);
    unsupported[0] = 4;

    expect(() => new DorkCandidateSession(unsupported)).toThrow(
      "accepts only version 3 stories",
    );
  });

  it("boots and executes the separately licensed Zork I Release 119 story", async () => {
    const session = new DorkCandidateSession(await story(zorkStoryUrl), {
      seed: 42,
    });

    const boot = await session.boot();
    expect(boot.boundary).toBe("input-requested");
    expect(boot.output).toContain("ZORK I");

    const look = await session.execute(canonicalizeCommand("look"));
    expect(look.boundary).toBe("input-requested");
    expect(look.output).toContain("West of House");

    const quitPrompt = await session.execute(canonicalizeCommand("quit"));
    expect(quitPrompt.boundary).toBe("input-requested");
    expect(quitPrompt.output).toMatch(/leave the game/iu);

    const terminated = await session.execute(canonicalizeCommand("y"));
    expect(terminated.boundary).toBe("terminated");
  });

  it("cold-restores one bounded Zork I turn without restore-boundary prose", async () => {
    const storyBytes = await story(zorkStoryUrl);
    const uninterrupted = new DorkCandidateSession(storyBytes, { seed: 53 });
    await uninterrupted.boot();
    const look = await uninterrupted.execute(canonicalizeCommand("look"));
    const checkpoint = await uninterrupted.snapshot();
    const expected = await uninterrupted.execute(
      canonicalizeCommand("inventory"),
    );

    const restored = await DorkCandidateSession.restoreFromSnapshot(
      storyBytes,
      checkpoint,
    );
    expect(restored.inspectPublicState().lastOutput).toBe(look.output);
    const actual = await restored.execute(canonicalizeCommand("inventory"));
    expect(actual).toEqual(expected);
  });

  it("captures boot and post-command boundaries without issuing a game SAVE", async () => {
    const storyBytes = await story(minimalStoryUrl);
    const session = new DorkCandidateSession(storyBytes, { seed: 31 });
    const boot = await session.boot();

    const bootSnapshot = await session.snapshot();
    expect(bootSnapshot.byteLength).toBeGreaterThan(0);
    expect(boot.output).not.toMatch(/save|restore/iu);

    const north = await session.execute(canonicalizeCommand("north"));
    const northSnapshot = await session.snapshot();
    expect(northSnapshot.byteLength).toBeGreaterThan(0);
    expect(north.output).not.toMatch(/save|restore/iu);

    const bootRestored = await DorkCandidateSession.restoreFromSnapshot(
      storyBytes,
      bootSnapshot,
    );
    const bootLook = await bootRestored.execute(canonicalizeCommand("look"));
    expect(bootLook.output).toContain("South Room");

    const northRestored = await DorkCandidateSession.restoreFromSnapshot(
      storyBytes,
      northSnapshot,
    );
    const northLook = await northRestored.execute(canonicalizeCommand("look"));
    expect(northLook.output).toBe(
      "North Room\nA quiet room with an exit south.\n\n> ",
    );
  });

  it("returns detached snapshots without aliasing live machine state", async () => {
    const storyBytes = await story(minimalStoryUrl);
    const session = new DorkCandidateSession(storyBytes, {
      seed: 37,
    });
    await session.boot();

    const first = await session.snapshot();
    const pristine = new Uint8Array(first);
    first.fill(0);
    const second = await session.snapshot();

    expect(second).toEqual(pristine);
    expect(second).not.toBe(first);

    const restoration = DorkCandidateSession.restoreFromSnapshot(
      storyBytes,
      second,
    );
    second.fill(0);
    const restored = await restoration;
    expect(
      (await restored.execute(canonicalizeCommand("look"))).output,
    ).toContain("South Room");

    const look = await session.execute(canonicalizeCommand("look"));
    expect(look.output).toContain("South Room");
  });

  it("continues a cold restored session exactly like the uninterrupted branch", async () => {
    const storyBytes = await story(minimalStoryUrl);
    const uninterrupted = new DorkCandidateSession(storyBytes, { seed: 41 });
    await uninterrupted.boot();
    await uninterrupted.execute(canonicalizeCommand("take token"));
    const checkpoint = await uninterrupted.snapshot();

    const expected = await uninterrupted.execute(canonicalizeCommand("north"));
    const restored = await DorkCandidateSession.restoreFromSnapshot(
      storyBytes,
      checkpoint,
    );
    const actual = await restored.execute(canonicalizeCommand("north"));

    expect(actual).toEqual(expected);
    const inventory = await restored.execute(canonicalizeCommand("inventory"));
    expect(inventory.output).toBe("You are carrying a brass token.\n\n> ");
  });

  it("keeps the active session usable after malformed, truncated, and mismatched restores", async () => {
    const storyBytes = await story(minimalStoryUrl);
    const active = new DorkCandidateSession(storyBytes, { seed: 43 });
    await active.boot();
    await active.execute(canonicalizeCommand("north"));
    const valid = await active.snapshot();

    const corrupt = new Uint8Array(valid);
    corrupt[0]! ^= 0x01;
    await expect(active.restore(corrupt)).rejects.toThrow();
    expect((await active.execute(canonicalizeCommand("look"))).output).toBe(
      "North Room\nA quiet room with an exit south.\n\n> ",
    );

    await expect(
      active.restore(new Uint8Array(1024 * 1024 + 1)),
    ).rejects.toThrow("exceeds the 1048576-byte limit");
    expect((await active.execute(canonicalizeCommand("look"))).output).toBe(
      "North Room\nA quiet room with an exit south.\n\n> ",
    );

    await expect(active.restore(valid.slice(0, -1))).rejects.toThrow();
    expect((await active.execute(canonicalizeCommand("look"))).output).toBe(
      "North Room\nA quiet room with an exit south.\n\n> ",
    );

    const envelope = decodeDorkCheckpointEnvelope(valid);
    const malformedDynamicMemory = new Uint8Array(
      envelope.machine.dynamicMemory,
    );
    malformedDynamicMemory[2]! ^= 0x01;
    const malformedMachine = encodeDorkCheckpointEnvelope({
      ...envelope,
      machine: {
        ...envelope.machine,
        dynamicMemory: malformedDynamicMemory,
      },
    });
    await expect(active.restore(malformedMachine)).rejects.toThrow(
      "structural story header",
    );
    expect((await active.execute(canonicalizeCommand("look"))).output).toBe(
      "North Room\nA quiet room with an exit south.\n\n> ",
    );

    const incompatibleConfig = encodeDorkCheckpointEnvelope({
      ...envelope,
      machine: {
        ...envelope.machine,
        config: {
          ...envelope.machine.config,
          maxInstructionsPerTurn:
            envelope.machine.config.maxInstructionsPerTurn + 1,
        },
      },
    });
    await expect(active.restore(incompatibleConfig)).rejects.toThrow(
      "runtime configuration does not match the active session",
    );
    expect((await active.execute(canonicalizeCommand("look"))).output).toBe(
      "North Room\nA quiet room with an exit south.\n\n> ",
    );

    const zork = new DorkCandidateSession(await story(zorkStoryUrl), {
      seed: 43,
    });
    await zork.boot();
    const mismatched = await zork.snapshot();
    await expect(active.restore(mismatched)).rejects.toThrow(
      "does not match the supplied story artifact",
    );
    expect((await active.execute(canonicalizeCommand("look"))).output).toBe(
      "North Room\nA quiet room with an exit south.\n\n> ",
    );
  });

  it("restores repeatedly without engine prose or duplicate prompts", async () => {
    const storyBytes = await story(minimalStoryUrl);
    const session = new DorkCandidateSession(storyBytes, { seed: 47 });
    await session.boot();
    const prior = await session.execute(canonicalizeCommand("north"));
    const checkpoint = await session.snapshot();

    expect(await session.restore(checkpoint)).toEqual({
      output: "",
      turnComplete: true,
      boundary: "input-requested",
    });
    expect(session.inspectPublicState()).toEqual({
      revision: 1,
      lastOutput: prior.output,
      boundary: "input-requested",
    });

    expect(await session.restore(checkpoint)).toEqual({
      output: "",
      turnComplete: true,
      boundary: "input-requested",
    });
    expect(session.inspectPublicState().lastOutput).toBe(prior.output);
    expect(await session.snapshot()).toEqual(checkpoint);

    const look = await session.execute(canonicalizeCommand("look"));
    expect(look.output).toBe(
      "North Room\nA quiet room with an exit south.\n\n> ",
    );
    expect(look.output.match(/> /gu)).toHaveLength(1);
  });

  it("does not route the retired machine failure into one restored session", async () => {
    const session = new DorkCandidateSession(await story(minimalStoryUrl), {
      seed: 59,
    });
    await session.boot();
    const checkpoint = await session.snapshot();

    await session.restore(checkpoint);
    await Promise.resolve();
    await Promise.resolve();

    expect((await session.execute(canonicalizeCommand("look"))).output).toBe(
      "South Room\nA plain room with an exit north.\nA brass token rests on the floor.\n\n> ",
    );
  });

  it("disposes a staged replacement when the active lifecycle ends", async () => {
    const session = new DorkCandidateSession(await story(minimalStoryUrl), {
      seed: 61,
    });
    await session.boot();
    const checkpoint = await session.snapshot();

    const restoration = session.restore(checkpoint);
    session.dispose();

    await expect(restoration).rejects.toThrow(
      "lifecycle changed while restore was staged",
    );
    await expect(session.execute(canonicalizeCommand("look"))).rejects.toThrow(
      "Dork candidate session is disposed",
    );
  });
});
