import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@udaan/shared": new URL("../shared/src/index.ts", import.meta.url).pathname,
      "@udaan/contracts": new URL("../contracts/src/index.ts", import.meta.url).pathname,
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});