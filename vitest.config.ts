import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    exclude: ["**/*.live.test.ts", "**/node_modules/**", "vendor/**"],
    passWithNoTests: false,
    sequence: { concurrent: false },
  },
});
