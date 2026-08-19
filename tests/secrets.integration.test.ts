import { writeFile, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { describe, expect, it } from "vitest";

const run = promisify(execFile);
const root = resolve(import.meta.dirname, "..");

describe("secret policy", () => {
  it("permits a local credential file only when Git confirms it is ignored", async () => {
    const path = resolve(root, ".env.integration-local");
    await writeFile(path, "OPENAI_API_KEY=synthetic-local-fixture\n", {
      mode: 0o600,
      flag: "wx",
    });
    try {
      const ignored = await run(
        "git",
        ["check-ignore", "--quiet", "--", ".env.integration-local"],
        { cwd: root },
      );
      expect(ignored.stderr).toBe("");
      const checked = await run("node", ["scripts/check-secrets.mjs"], {
        cwd: root,
      });
      expect(checked.stdout).toContain(
        "No high-confidence credential patterns found.",
      );
    } finally {
      await unlink(path);
    }
  });
});
