import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    include: ["tests/**/*.test.ts"],
    environment: "node",
    env: {
      API_TOKEN: process.env.API_TOKEN || "dev-token-1234567890abcdef-test-only",
      DATABASE_URL:
        process.env.DATABASE_URL || "postgresql://toyota:toyota@localhost:5432/toyota_backend?schema=public",
    },
  },
});
