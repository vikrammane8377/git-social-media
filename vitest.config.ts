import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@bix/config": r("./packages/config/src/index.ts"),
      "@bix/storage": r("./packages/storage/src/index.ts"),
      "@bix/video": r("./packages/video/src/index.ts"),
      "@bix/higgsfield": r("./packages/higgsfield/src/index.ts"),
      "@bix/youtube": r("./packages/youtube/src/index.ts"),
      "@bix/events": r("./packages/events/src/index.ts"),
      "@bix/competitors": r("./packages/competitors/src/index.ts"),
      "@bix/scripts": r("./packages/scripts/src/index.ts"),
      "@bix/server": r("./packages/server/src/index.ts"),
      "@bix/brand": r("./packages/brand/src/index.ts"),
    },
  },
  test: {
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
    exclude: ["apps/web/**", "**/node_modules/**"],
    environment: "node",
  },
});
