/// <reference types="vitest/config" />

import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  clearScreen: false,
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
  },
  envPrefix: ["VITE_", "TAURI_"],
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
      "@mupdf-wasm?url": `${new URL(
        "./node_modules/mupdf/dist/mupdf-wasm.wasm",
        import.meta.url,
      ).pathname}?url`,
    },
  },
  optimizeDeps: {
    include: ["mupdf"],
  },
  worker: {
    format: "es",
  },
  build: {
    target: "esnext",
    minify: process.env.TAURI_ENV_DEBUG ? false : "esbuild",
    sourcemap: Boolean(process.env.TAURI_ENV_DEBUG),
  },
  test: {
    setupFiles: ["./src/test/setup.ts"],
  },
});
