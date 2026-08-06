import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    setupFiles: ["./test/helpers/setup.ts"],
    // Integration suites share one real PostgreSQL database and truncate it in
    // beforeAll; files must not interleave.
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
