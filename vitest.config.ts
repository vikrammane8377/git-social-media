import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@bix/config": r("./packages/config/src/index.ts"),
      "@bix/storage": r("./packages/storage/src/index.ts"),
      "@bix/video": r("./packages/video/src/index.ts"),
      "@bix/events": r("./packages/events/src/index.ts"),
    },
  },
  test: {
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
    environment: "node",
  },
});
