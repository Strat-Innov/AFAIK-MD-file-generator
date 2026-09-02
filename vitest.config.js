import { defineConfig } from "vitest/config";

// Separate from vite.config.js on purpose: the tests exercise pure
// generator/extraction modules and need no React plugin. jsdom is
// required because masterMd.js decodeOnce() resolves HTML entities
// through a textarea element — see the note in that file.
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["test/**/*.test.js"],
  },
});
