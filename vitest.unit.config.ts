import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["packages/**/*.unit.test.ts", "tests/**/*.unit.test.ts"],
    passWithNoTests: false,
    sequence: { concurrent: false },
  },
});
