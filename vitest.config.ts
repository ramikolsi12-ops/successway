import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { fileParallelism: false, projects: [
    { extends: true, test: { name: "unit", include: ["tests/unit/**/*.test.ts"], testTimeout: 20000 } },
    { extends: true, test: { name: "integration", include: ["tests/integration/**/*.test.ts"], testTimeout: 30000, hookTimeout: 60000, globalSetup: ["./tests/setup-integration.ts"] } },
  ] },
});
