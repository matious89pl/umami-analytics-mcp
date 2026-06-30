import { defineConfig } from "tsup";

export default defineConfig({
  // Two entrypoints share the same core:
  //  - cli:    the stdio binary invoked by `npx umami-analytics-mcp`
  //  - server: the registration core, re-exported for consumers (e.g. the Vercel route)
  entry: {
    cli: "src/bin/cli.ts",
    http: "src/bin/http.ts",
    server: "src/server.ts",
  },
  format: ["esm"],
  target: "node20",
  platform: "node",
  // sdk + zod stay external (declared as runtime dependencies); only our source is bundled.
  dts: { entry: { server: "src/server.ts" } },
  clean: true,
  sourcemap: false,
  minify: false,
  splitting: false,
  // The shebang lives at the top of src/bin/cli.ts; esbuild preserves it on that entry only.
});
