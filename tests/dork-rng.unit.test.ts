import { describe, expect, it } from "vitest";

import {
  advanceDorkRandomState,
  advanceDorkReseedState,
  applyDorkRandom,
  drawDorkRandomState,
  reseedDorkRng,
} from "../vendor/dork/src/zmachine/index.js";

describe("Dork candidate RNG", () => {
  it("advances the checkpointed reseed stream with stable vectors", () => {
    let reseed = advanceDorkReseedState(0);
    expect(reseed).toEqual({ state: 0x9e37_79b9, gameplayState: 0x92ca_2f0e });

    reseed = advanceDorkReseedState(reseed.state);
    expect(reseed).toEqual({ state: 0x3c6e_f372, gameplayState: 0x3cd6_e3f3 });

    reseed = advanceDorkReseedState(reseed.state);
    expect(reseed).toEqual({ state: 0xdaa6_6d2b, gameplayState: 0x1b14_7dcc });

    expect(advanceDorkReseedState(0xdead_beef)).toEqual({
      state: 0x7ce5_38a8,
      gameplayState: 0xd3ce_9097,
    });
  });

  it("rejects incomplete uint32 buckets instead of biasing the requested range", () => {
    const maximum = advanceDorkRandomState(0x26f5_b720);
    expect(maximum).toBe(0xffff_ffff);
    expect(drawDorkRandomState(0x26f5_b720, 1)).toEqual({
      gameplayState: 0xffff_ffff,
      result: 1,
    });
    expect(drawDorkRandomState(0x26f5_b720, 10)).toEqual({
      gameplayState: 0x3c55_8d52,
      result: 3,
    });
    expect(drawDorkRandomState(0x26f5_b720, 100)).toEqual({
      gameplayState: 0x3c55_8d52,
      result: 24,
    });
    expect(drawDorkRandomState(0x26f5_b720, 0x7fff)).toEqual({
      gameplayState: 0x3c55_8d52,
      result: 7723,
    });

    expect(drawDorkRandomState(0, 10)).toEqual({
      gameplayState: 0x3c6e_f35f,
      result: 3,
    });
  });

  it("keeps RANDOM reseeding separate from predictable gameplay state", () => {
    const initial = {
      rngMode: 0 as const,
      gameplayState: 123,
      reseedState: 0,
    };
    const firstReseed = reseedDorkRng(initial);
    const secondReseed = reseedDorkRng(firstReseed);
    expect(firstReseed).toEqual({
      rngMode: 0,
      gameplayState: 0x92ca_2f0e,
      reseedState: 0x9e37_79b9,
    });
    expect(secondReseed.gameplayState).not.toBe(firstReseed.gameplayState);

    const predictable = applyDorkRandom(firstReseed, (-7 & 0xffff) >>> 0);
    expect(predictable).toEqual({
      state: {
        rngMode: 1,
        gameplayState: 7,
        reseedState: firstReseed.reseedState,
      },
      result: 0,
    });
    const predictableDraw = applyDorkRandom(predictable.state, 10);
    expect(predictableDraw.result).toBeGreaterThanOrEqual(1);
    expect(predictableDraw.result).toBeLessThanOrEqual(10);
    expect(predictableDraw.state.rngMode).toBe(1);
    expect(predictableDraw.state.reseedState).toBe(firstReseed.reseedState);

    const randomAgain = applyDorkRandom(predictableDraw.state, 0);
    expect(randomAgain.result).toBe(0);
    expect(randomAgain.state.rngMode).toBe(0);
    expect(randomAgain.state.reseedState).toBe(secondReseed.reseedState);
    expect(randomAgain.state.gameplayState).toBe(secondReseed.gameplayState);
  });
});
