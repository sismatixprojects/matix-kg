import { defineConfig } from "vite";

// Relative base so the build can be served from any path (e.g. https://bridge.matix.one/web/).
export default defineConfig({
  base: "./",
  build: { target: "es2022", sourcemap: true },
  server: { host: true },
});
