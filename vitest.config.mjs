import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // `obsidian` has no runtime code outside the app; DOM tests get a stub.
    alias: { obsidian: fileURLToPath(new URL("./test/stubs/obsidian.ts", import.meta.url)) },
  },
});
