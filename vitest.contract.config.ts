import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["packages/**/*.contract.test.ts"],
    passWithNoTests: false,
    sequence: { concurrent: false },
  },
});
