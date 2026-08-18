import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");

describe("minimal story fixture", () => {
  it("matches its deterministic artifact manifest and Z-machine header", () => {
    const result = spawnSync(
      process.execPath,
      ["scripts/verify-minimal-story.mjs"],
      { cwd: root, encoding: "utf8" },
    );

    expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
    expect(result.stdout).toContain(
      "Verified fixtures/stories/minimal/artifact/minimal.z3",
    );
  });

  it("decodes parser dictionary addresses as bytes and clears absent words", async () => {
    const source = await readFile(
      resolve(root, "fixtures/stories/minimal/source/minimal.inf"),
      "utf8",
    );

    expect(source).not.toContain("parse_buffer-->");
    expect(source).toMatch(
      /return \(parse_buffer->byte_offset \* 256\) \+ parse_buffer->\(byte_offset \+ 1\);/u,
    );
    expect(source).toMatch(
      /first_word = ParsedWordAddress\(1\);\s+second_word = 0;\s+if \(parse_buffer->1 > 1\) second_word = ParsedWordAddress\(2\);/u,
    );
  });
});
