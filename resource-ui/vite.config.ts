import { defineConfig } from "vite";

export default defineConfig({
  root: "resource-ui",
  base: "/resource/",
  esbuild: { jsx: "automatic" },
  build: { outDir: "../dist/resource-ui", emptyOutDir: true },
});
